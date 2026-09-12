#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <ftw.h>
#include <grp.h>
#include <limits.h>
#include <pwd.h>
#include <sched.h>
#include <signal.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mount.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#define STACK_SIZE (1024 * 1024)
#define MAX_ARGS 128
#define CGROUP_ROOT "/sys/fs/cgroup"
#define WORKSPACE_PREFIX "/tmp/quadrant-"
#define WORKSPACE_SIZE "size=67108864,nosuid,nodev,mode=0770"

typedef struct {
  const char *stdin_path;
  const char *stdout_path;
  const char *stderr_path;
  const char *result_path;
  const char *cwd;
  long cpu_ms;
  long wall_ms;
  long memory_kb;
  long output_bytes;
  char **command;
} config_t;

typedef struct {
  config_t *config;
  int stdin_fd;
  int stdout_fd;
  int stderr_fd;
  int sync_fd;
  uid_t uid;
  gid_t gid;
} child_context_t;

static long parse_positive(const char *value, long maximum) {
  char *end = NULL;
  errno = 0;
  long parsed = strtol(value, &end, 10);
  if (errno || !end || *end != '\0' || parsed <= 0 || parsed > maximum) return -1;
  return parsed;
}

static bool valid_workspace(const char *path) {
  size_t prefix = strlen(WORKSPACE_PREFIX);
  if (strncmp(path, WORKSPACE_PREFIX, prefix) != 0 || path[prefix] == '\0') return false;
  for (const char *cursor = path + prefix; *cursor; cursor++) {
    if (!((*cursor >= 'a' && *cursor <= 'z') || (*cursor >= 'A' && *cursor <= 'Z') ||
          (*cursor >= '0' && *cursor <= '9') || *cursor == '-')) return false;
  }
  return true;
}

static int prepare_workspace(const char *path) {
  if (!valid_workspace(path)) return 2;
  struct passwd *user = getpwnam("quadrant");
  if (!user) return 2;
  if (mkdir(path, 0770) != 0 && errno != EEXIST) return 2;
  if (mount("tmpfs", path, "tmpfs", MS_NOSUID | MS_NODEV, WORKSPACE_SIZE) != 0) return 2;
  if (chown(path, user->pw_uid, user->pw_gid) != 0 || chmod(path, 0770) != 0) {
    umount2(path, MNT_DETACH);
    return 2;
  }
  return 0;
}

static int cleanup_workspace(const char *path) {
  if (!valid_workspace(path)) return 2;
  if (umount2(path, MNT_DETACH) != 0 && errno != EINVAL && errno != ENOENT) return 2;
  if (rmdir(path) != 0 && errno != ENOENT) return 2;
  return 0;
}

static int seal_entry(const char *path, const struct stat *info, int type, struct FTW *walk) {
  (void)type;
  (void)walk;
  mode_t mode = S_ISDIR(info->st_mode) ? 0555 : ((info->st_mode & 0111) ? 0555 : 0444);
  if (lchown(path, 0, 0) != 0) return -1;
  if (!S_ISLNK(info->st_mode) && chmod(path, mode) != 0) return -1;
  return 0;
}

static int seal_workspace(const char *path) {
  if (!valid_workspace(path)) return 2;
  return nftw(path, seal_entry, 32, FTW_PHYS) == 0 ? 0 : 2;
}

static bool valid_case(const char *path) {
  const char *separator = strrchr(path, '/');
  if (!separator || strncmp(separator, "/case-", 6) != 0 || separator[6] == '\0') return false;
  for (const char *cursor = separator + 6; *cursor; cursor++) {
    if (*cursor < '0' || *cursor > '9') return false;
  }
  size_t parent_length = (size_t)(separator - path);
  if (parent_length >= PATH_MAX) return false;
  char parent[PATH_MAX];
  memcpy(parent, path, parent_length);
  parent[parent_length] = '\0';
  return valid_workspace(parent);
}

static int remove_entry(const char *path, const struct stat *info, int type, struct FTW *walk) {
  (void)info;
  (void)type;
  (void)walk;
  return remove(path);
}

static int prepare_case(const char *path) {
  if (!valid_case(path)) return 2;
  struct passwd *user = getpwnam("quadrant");
  if (!user || mkdir(path, 0770) != 0 || chown(path, user->pw_uid, user->pw_gid) != 0) return 2;
  return 0;
}

static int cleanup_case(const char *path) {
  if (!valid_case(path)) return 2;
  if (access(path, F_OK) != 0 && errno == ENOENT) return 0;
  return nftw(path, remove_entry, 32, FTW_DEPTH | FTW_PHYS) == 0 ? 0 : 2;
}

static long monotonic_ms(void) {
  struct timespec now;
  if (clock_gettime(CLOCK_MONOTONIC, &now) != 0) return -1;
  return now.tv_sec * 1000L + now.tv_nsec / 1000000L;
}

static int write_text(const char *path, const char *value) {
  int fd = open(path, O_WRONLY | O_CLOEXEC);
  if (fd < 0) return -1;
  size_t length = strlen(value);
  ssize_t written = write(fd, value, length);
  int saved = errno;
  close(fd);
  errno = saved;
  return written == (ssize_t)length ? 0 : -1;
}

static long read_stat_value(const char *path, const char *key) {
  FILE *file = fopen(path, "r");
  if (!file) return -1;
  char name[64];
  long value = 0;
  long found = -1;
  while (fscanf(file, "%63s %ld", name, &value) == 2) {
    if (strcmp(name, key) == 0) {
      found = value;
      break;
    }
  }
  fclose(file);
  return found;
}

static off_t file_size(const char *path) {
  struct stat info;
  return stat(path, &info) == 0 ? info.st_size : 0;
}

static int apply_limit(int resource, rlim_t value) {
  struct rlimit limit = {value, value};
  return setrlimit(resource, &limit);
}

static int child_main(void *opaque) {
  child_context_t *context = opaque;
  char ready = 0;
  if (read(context->sync_fd, &ready, 1) != 1) _exit(125);
  close(context->sync_fd);

  if (mount(NULL, "/", NULL, MS_REC | MS_PRIVATE, NULL) != 0) _exit(125);
  if (chdir(context->config->cwd) != 0) _exit(125);
  if (setpgid(0, 0) != 0 && errno != EACCES) _exit(125);

  rlim_t cpu_seconds = (rlim_t)((context->config->cpu_ms + 999) / 1000 + 1);
  if (apply_limit(RLIMIT_CPU, cpu_seconds) != 0 ||
      apply_limit(RLIMIT_AS, (rlim_t)context->config->memory_kb * 1024) != 0 ||
      apply_limit(RLIMIT_NPROC, 32) != 0 ||
      apply_limit(RLIMIT_NOFILE, 64) != 0 ||
      apply_limit(RLIMIT_FSIZE, (rlim_t)context->config->output_bytes) != 0 ||
      apply_limit(RLIMIT_CORE, 0) != 0) {
    _exit(125);
  }

  if (dup2(context->stdin_fd, STDIN_FILENO) < 0 ||
      dup2(context->stdout_fd, STDOUT_FILENO) < 0 ||
      dup2(context->stderr_fd, STDERR_FILENO) < 0) {
    _exit(125);
  }
  close(context->stdin_fd);
  close(context->stdout_fd);
  close(context->stderr_fd);

  if (setgroups(0, NULL) != 0 || setgid(context->gid) != 0 || setuid(context->uid) != 0) {
    _exit(125);
  }

  clearenv();
  setenv("HOME", "/home/quadrant", 1);
  setenv("PATH", "/usr/local/bin:/usr/bin:/bin", 1);
  setenv("LANG", "C.UTF-8", 1);
  execv(context->config->command[0], context->config->command);
  _exit(errno == ENOENT ? 127 : 126);
}

static int parse_args(int argc, char **argv, config_t *config) {
  memset(config, 0, sizeof(*config));
  int i = 1;
  while (i < argc) {
    if (strcmp(argv[i], "--") == 0) {
      config->command = &argv[i + 1];
      break;
    }
    if (i + 1 >= argc) return -1;
    const char *key = argv[i];
    const char *value = argv[i + 1];
    if (strcmp(key, "--stdin") == 0) config->stdin_path = value;
    else if (strcmp(key, "--stdout") == 0) config->stdout_path = value;
    else if (strcmp(key, "--stderr") == 0) config->stderr_path = value;
    else if (strcmp(key, "--result") == 0) config->result_path = value;
    else if (strcmp(key, "--cwd") == 0) config->cwd = value;
    else if (strcmp(key, "--cpu-ms") == 0) config->cpu_ms = parse_positive(value, 10000);
    else if (strcmp(key, "--wall-ms") == 0) config->wall_ms = parse_positive(value, 10000);
    else if (strcmp(key, "--memory-kb") == 0) config->memory_kb = parse_positive(value, 524288);
    else if (strcmp(key, "--output-bytes") == 0) config->output_bytes = parse_positive(value, 32768);
    else return -1;
    i += 2;
  }
  return config->stdin_path && config->stdout_path && config->stderr_path &&
         config->result_path && config->cwd && config->cpu_ms > 0 &&
         config->wall_ms > 0 && config->memory_kb > 0 && config->output_bytes > 0 &&
         config->command && config->command[0] ? 0 : -1;
}

static int make_output(const char *path, uid_t uid, gid_t gid) {
  int fd = open(path, O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW, 0640);
  if (fd < 0) return -1;
  if (fchown(fd, uid, gid) != 0) {
    close(fd);
    return -1;
  }
  return fd;
}

static int write_result(const config_t *config, const char *status, int exit_code,
                        int signal_number, long cpu_ms, long wall_ms,
                        long memory_kb, bool truncated) {
  int fd = open(config->result_path,
                O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW, 0640);
  if (fd < 0) return -1;
  char exit_value[32];
  char signal_value[32];
  if (exit_code < 0) strcpy(exit_value, "null");
  else snprintf(exit_value, sizeof(exit_value), "%d", exit_code);
  if (signal_number < 0) strcpy(signal_value, "null");
  else snprintf(signal_value, sizeof(signal_value), "%d", signal_number);
  dprintf(fd,
          "{\"version\":1,\"status\":\"%s\",\"exitCode\":%s,"
          "\"signal\":%s,\"cpuMs\":%ld,\"wallMs\":%ld,"
          "\"memoryKb\":%ld,\"outputTruncated\":%s}\n",
          status, exit_value, signal_value,
          cpu_ms < 0 ? 0 : cpu_ms, wall_ms < 0 ? 0 : wall_ms,
          memory_kb < 0 ? 0 : memory_kb, truncated ? "true" : "false");
  return close(fd);
}

int main(int argc, char **argv) {
  if (argc == 3 && strcmp(argv[1], "--prepare-workspace") == 0) {
    return prepare_workspace(argv[2]);
  }
  if (argc == 3 && strcmp(argv[1], "--cleanup-workspace") == 0) {
    return cleanup_workspace(argv[2]);
  }
  if (argc == 3 && strcmp(argv[1], "--seal-workspace") == 0) {
    return seal_workspace(argv[2]);
  }
  if (argc == 3 && strcmp(argv[1], "--prepare-case") == 0) {
    return prepare_case(argv[2]);
  }
  if (argc == 3 && strcmp(argv[1], "--cleanup-case") == 0) {
    return cleanup_case(argv[2]);
  }
  config_t config;
  if (parse_args(argc, argv, &config) != 0 || argc > MAX_ARGS) return 2;

  struct passwd *user = getpwnam("quadrant");
  if (!user) return 2;
  int stdin_fd = open(config.stdin_path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
  if (stdin_fd < 0 || unlink(config.stdin_path) != 0) return 2;
  int stdout_fd = make_output(config.stdout_path, user->pw_uid, user->pw_gid);
  int stderr_fd = make_output(config.stderr_path, user->pw_uid, user->pw_gid);
  if (stdout_fd < 0 || stderr_fd < 0) return 2;

  char cgroup[PATH_MAX];
  snprintf(cgroup, sizeof(cgroup), CGROUP_ROOT "/quadrant-exec-%ld", (long)getpid());
  if (mkdir(cgroup, 0700) != 0) return 2;

  char path[PATH_MAX];
  char value[64];
  snprintf(path, sizeof(path), "%s/memory.max", cgroup);
  snprintf(value, sizeof(value), "%ld", config.memory_kb * 1024);
  if (write_text(path, value) != 0) return 2;
  snprintf(path, sizeof(path), "%s/memory.swap.max", cgroup);
  if (write_text(path, "0") != 0) return 2;
  snprintf(path, sizeof(path), "%s/pids.max", cgroup);
  if (write_text(path, "32") != 0) return 2;
  snprintf(path, sizeof(path), "%s/cpu.max", cgroup);
  if (write_text(path, "100000 100000") != 0) return 2;

  int sync_pipe[2];
  if (pipe2(sync_pipe, O_CLOEXEC) != 0) return 2;
  void *stack = malloc(STACK_SIZE);
  if (!stack) return 2;
  child_context_t context = {
      .config = &config,
      .stdin_fd = stdin_fd,
      .stdout_fd = stdout_fd,
      .stderr_fd = stderr_fd,
      .sync_fd = sync_pipe[0],
      .uid = user->pw_uid,
      .gid = user->pw_gid,
  };
  int clone_flags = CLONE_NEWNET | CLONE_NEWNS | CLONE_NEWPID | CLONE_NEWIPC |
                    CLONE_NEWUTS | SIGCHLD;
  pid_t child = clone(child_main, (char *)stack + STACK_SIZE, clone_flags, &context);
  if (child < 0) return 2;
  close(sync_pipe[0]);
  snprintf(path, sizeof(path), "%s/cgroup.procs", cgroup);
  snprintf(value, sizeof(value), "%ld", (long)child);
  if (write_text(path, value) != 0 || write(sync_pipe[1], "1", 1) != 1) {
    kill(child, SIGKILL);
    return 2;
  }
  close(sync_pipe[1]);
  close(stdin_fd);
  close(stdout_fd);
  close(stderr_fd);

  long started = monotonic_ms();
  int wait_status = 0;
  bool timed_out = false;
  bool output_limit = false;
  struct rusage usage;
  memset(&usage, 0, sizeof(usage));

  for (;;) {
    pid_t waited = wait4(child, &wait_status, WNOHANG, &usage);
    if (waited == child) break;
    if (waited < 0) return 2;

    long elapsed = monotonic_ms() - started;
    snprintf(path, sizeof(path), "%s/cpu.stat", cgroup);
    long cpu_usec = read_stat_value(path, "usage_usec");
    off_t output_size = file_size(config.stdout_path) + file_size(config.stderr_path);
    if (elapsed > config.wall_ms || cpu_usec > config.cpu_ms * 1000L) {
      timed_out = true;
      kill(child, SIGKILL);
    } else if (output_size > config.output_bytes) {
      output_limit = true;
      kill(child, SIGKILL);
    }
    struct timespec pause = {.tv_sec = 0, .tv_nsec = 10 * 1000 * 1000};
    nanosleep(&pause, NULL);
  }

  long wall_ms = monotonic_ms() - started;
  long cpu_ms = usage.ru_utime.tv_sec * 1000L + usage.ru_utime.tv_usec / 1000L +
                usage.ru_stime.tv_sec * 1000L + usage.ru_stime.tv_usec / 1000L;
  snprintf(path, sizeof(path), "%s/memory.peak", cgroup);
  FILE *memory_file = fopen(path, "r");
  long memory_bytes = 0;
  if (memory_file) {
    fscanf(memory_file, "%ld", &memory_bytes);
    fclose(memory_file);
  }
  snprintf(path, sizeof(path), "%s/memory.events", cgroup);
  bool oom = read_stat_value(path, "oom_kill") > 0;

  const char *status = "exited";
  int exit_code = -1;
  int signal_number = -1;
  if (timed_out) status = "timed_out";
  else if (oom) status = "oom";
  else if (output_limit) status = "output_limit";
  else if (WIFSIGNALED(wait_status)) {
    status = "signaled";
    signal_number = WTERMSIG(wait_status);
  } else if (WIFEXITED(wait_status)) {
    exit_code = WEXITSTATUS(wait_status);
  }

  int result = write_result(&config, status, exit_code, signal_number, cpu_ms, wall_ms,
                            memory_bytes / 1024L, output_limit);
  for (int attempts = 0; attempts < 20; attempts++) {
    if (rmdir(cgroup) == 0) break;
    struct timespec pause = {.tv_sec = 0, .tv_nsec = 5 * 1000 * 1000};
    nanosleep(&pause, NULL);
  }
  free(stack);
  return result == 0 ? 0 : 2;
}
