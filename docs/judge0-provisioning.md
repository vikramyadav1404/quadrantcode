# Judge0 provisioning and first real run

`Judge0Provider` has never run against a Judge0 instance. This is the procedure
for standing one up and proving it works — written for someone who has not
deployed Judge0 before.

**Nothing in this document is provisioned yet.** It is a checklist, not a record.

---

## ⚠️ Read this before you start

**A default Judge0 deployment is open to the internet and runs untrusted code
with network access.** That is not a warning about carelessness; it is what the
shipped defaults do, verified against `judge0.conf`:

| Setting                | Default                | What the default means                                                 |
| ---------------------- | ---------------------- | ---------------------------------------------------------------------- |
| `AUTHN_TOKEN`          | **empty**              | Authentication **disabled**. Anyone who finds the URL can submit code. |
| `ALLOW_ENABLE_NETWORK` | **true**               | A submission may request network access.                               |
| `ENABLE_NETWORK`       | `false`                | Submissions have no network _unless they ask_.                         |
| `POSTGRES_PASSWORD`    | `YourPasswordHere1234` | A published default.                                                   |
| `REDIS_PASSWORD`       | none — must be set     | Refuses to start without one.                                          |

Those first three combined are
[GHSA-q7vg-26pg-v5hr](https://github.com/judge0/judge0/security/advisories/GHSA-q7vg-26pg-v5hr),
CVSS 9.0: a submission enables networking, connects to Judge0's own PostgreSQL
on the default password, alters the submission table so a numeric column becomes
text, and injects a shell payload that the isolate runner executes **as root,
outside the sandbox**.

Affected `<= 1.13.0`, fixed in **1.13.1**, which is the current release
(published 18 April 2024). Install that or later — not a copy of the compose
file from a blog post.

This is also why nothing in this codebase calls the execution path a sandbox
(**D24**). The isolation is whatever the instance provides, and the instance's
defaults do not provide it.

---

## 1 · Provision the VM

Judge0 needs a Linux host with Docker and **cgroup v1** — it will not run on a
host booted with cgroup v2 only, which is the single most common first failure.

1. Azure Portal → **Virtual machines** → Create → Ubuntu Server **22.04 LTS**.
2. Size: 2 vCPU / 4 GB is enough for one user (`Standard_B2s`). Judge0 runs a
   PostgreSQL, a Redis, a server and workers.
3. Authentication: **SSH public key**. Not a password.
4. Inbound ports: **SSH (22) only.** Do not open 2358 here — step 4 does it
   deliberately and narrowly.
5. Note the public IP.

## 2 · Enable cgroup v1

```bash
sudo sed -i 's/GRUB_CMDLINE_LINUX_DEFAULT="/GRUB_CMDLINE_LINUX_DEFAULT="systemd.unified_cgroup_hierarchy=0 systemd.legacy_systemd_cgroup_controller /' /etc/default/grub
sudo update-grub
sudo reboot
```

After the reboot, `stat -fc %T /sys/fs/cgroup/` should print `tmpfs`, not
`cgroup2fs`. If it still says `cgroup2fs`, Judge0's workers will start and then
fail every submission — loudly, but confusingly.

## 3 · Install Judge0

```bash
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2 unzip
sudo usermod -aG docker $USER && newgrp docker
```

```bash
wget https://github.com/judge0/judge0/releases/download/v1.13.1/judge0-v1.13.1.zip
unzip judge0-v1.13.1.zip && cd judge0-v1.13.1
```

**Now edit `judge0.conf` before starting anything.** Four changes, all required:

```ini
# Authentication — WITHOUT THIS THE INSTANCE IS PUBLIC
AUTHN_TOKEN=<generate: openssl rand -hex 32>

# Close the hole from the advisory
ALLOW_ENABLE_NETWORK=false

# Both of these refuse a default or blank value in a sane deployment
POSTGRES_PASSWORD=<generate: openssl rand -hex 24>
REDIS_PASSWORD=<generate: openssl rand -hex 24>
```

Leave `AUTHZ_TOKEN` **empty**. Judge0's authorization header is `X-Auth-User`
and `Judge0Provider` does not send it — enabling it makes every call fail with 401. That failure is loud, but it is an hour you do not need to spend.

Our submitted limits sit under Judge0's ceilings, so no other change is needed:

| We send                | Judge0 max            | Default |
| ---------------------- | --------------------- | ------- |
| `cpu_time_limit: 2`    | `MAX_CPU_TIME_LIMIT`  | 15      |
| `wall_time_limit: 5`   | `MAX_WALL_TIME_LIMIT` | 20      |
| `memory_limit: 256000` | `MAX_MEMORY_LIMIT`    | 512000  |

If you lower any of those maxima below our values, Judge0 rejects the submission
with a validation error. That surfaces as `ProviderUnavailableError` — a 503 and
"your code was not executed", never a verdict.

```bash
docker compose up -d db redis
sleep 10
docker compose up -d
sleep 5
```

The two-stage start is Judge0's own instruction, not superstition: the server
migrates on boot and needs the database already accepting connections.

## 4 · Lock the network path

Judge0 listens on **2358**. Do not expose it to the internet.

**Preferred** — no public exposure at all. Put Judge0 behind Azure's private
network and reach it only from Vercel via a tunnel or a VPN. This is more setup
than a portfolio deployment usually justifies.

**Acceptable** — expose 2358, but only with `AUTHN_TOKEN` set (step 3) and with
an NSG rule restricted as narrowly as you can. Vercel's egress IPs are not
fixed on Hobby, so a source-IP allowlist is not available to you; the token is
doing the real work. Put HTTPS in front of it — a bare `http://` URL sends the
auth token in clear text on every request, and `JUDGE0_URL` is validated as a
URL but not as an HTTPS one.

> **The token is the only thing between a public 2358 and arbitrary code
> execution on your VM.** Treat it like a database password.

## 5 · Prove Judge0 works, before touching the app

From your machine, against the instance directly. `$T` is your `AUTHN_TOKEN`.

```bash
curl -s -H "X-Auth-Token: $T" https://<host>:2358/languages | head -c 300
```

> A JSON array of `{id, name}`. **If this works without the header, your
> `AUTHN_TOKEN` did not take** — stop and fix it.

```bash
curl -s -H "X-Auth-Token: $T" -H "content-type: application/json" \
  -d '{"language_id":71,"source_code":"print(2**100)"}' \
  "https://<host>:2358/submissions?base64_encoded=false&wait=true"
```

> `stdout` must be `1267650600228229401496703205376`. That number cannot be
> echoed, guessed, or produced by a fake — it has to have been computed. Use the
> `id` your `/languages` call actually returned for Python 3, not 71 from this
> page.

**The three probes that prove the limits are real**, each replacing
`source_code`:

| Probe       | Source                                                                                         | Expected                              |
| ----------- | ---------------------------------------------------------------------------------------------- | ------------------------------------- |
| Wall clock  | `import time; time.sleep(10)`                                                                  | status 5 (TLE), **not** a 10s success |
| Memory      | `x = bytearray(400*1024*1024)`                                                                 | killed — signal or NZEC, not success  |
| **Network** | `import urllib.request; print(urllib.request.urlopen("http://example.com", timeout=5).status)` | **must fail**                         |

That last one is the one to care about. If it prints `200`, `ALLOW_ENABLE_NETWORK`
did not take and you are running the advisory's configuration.

## 6 · Point the app at it

Vercel → Project → Settings → Environment Variables. **Production** scope.

| Variable            | Value                 | Why                                                                                                                            |
| ------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `JUDGE0_URL`        | `https://<host>:2358` | **No trailing slash** — the provider concatenates paths directly, so a slash yields `//submissions`                            |
| `JUDGE0_API_KEY`    | your `AUTHN_TOKEN`    | Sent as `X-Auth-Token`                                                                                                         |
| `EXECUTION_BACKEND` | `judge0`              | Explicit. Without it, `JUDGE0_URL` alone also infers judge0, but relying on inference is how backends get selected by accident |
| `FEATURE_EXECUTION` | `true`                | Otherwise both solve and assessment actions throw before reaching the provider                                                 |

Redeploy. Environment variables are read at build and boot; setting them without
a redeploy changes nothing.

> `readiness.ts` treats `FEATURE_EXECUTION` on + `EXECUTION_BACKEND=judge0` +
> `JUDGE0_URL` set as ready. It does **not** call Judge0, so
> `/api/health/ready` going green means the variables are present, not that the
> instance answers.

## 7 · Prove the whole path

Sign in, open a problem's solve screen, run a program whose output must be
computed:

```python
print(sum(i*i for i in range(1000)))
```

> `332833500`. Then check the attempt row: `stdout` is that number, and
> **`compiler_runtime_version` is populated** — that field can only be filled by
> a successful `/languages` round trip, so it is the tell that a real provider
> answered.
>
> A fake would have returned `(not executed) echo of stdin:` and a null runtime
> version. That difference is the smallest reliable proof.

Then **run `npm run executions:sweep`** — five jobs stuck at `running` lock a
user out of execution entirely, and the first real run is exactly when one gets
stuck.

---

## What is still unverified after all this

Passing step 7 proves one language, one program, one path. It does not prove:

- **The other four languages.** `selectJudge0Language` matches by name regex and
  takes the highest id. `python3` uses `/^Python \(/i`, which matches
  `Python (2.7.17)` as well as `Python (3.x)` — on the stock list the highest id
  is Python 3, but that is an accident of ordering rather than a rule. Run the
  `2**100` probe in each of the five before trusting any of them; Python 2 would
  report a syntax error that reads as the user's fault.
- **`expected_output` comparison.** We send it and let Judge0 decide
  `wrong_answer`. Whitespace and trailing-newline semantics are the instance's,
  not ours, and a correct program can be marked wrong by a trailing newline.
  Test one deliberately-correct submission against a known expected output
  before trusting native problem verdicts.
- **The `mle` inference.** `Judge0Provider` reports `mle` when reported memory
  is at or above our ceiling, because Judge0 signals allocation failure the same
  way it signals a segfault. Confirm the memory probe in step 5 lands as `mle`
  rather than `runtime_error` in a real attempt row.
- **Non-UTF-8 output.** We submit with `base64_encoded=false`. A program
  emitting invalid UTF-8 may come back null or mangled.
- **`languageIds` cannot be configured.** `Judge0Provider` accepts a
  `languageIds` override for instances with non-standard runtime names, but
  `resolveProvider` never passes it and no environment variable feeds it. If
  name matching fails on your instance, it needs a code change, not a setting.
