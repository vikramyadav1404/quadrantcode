#!/bin/sh
set -eu

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

c_version="$(gcc-13 --version | head -n 1)"
cpp_version="$(g++-13 --version | head -n 1)"
java_version="$(java -version 2>&1 | head -n 1)"
python_version="$(python3.12 --version 2>&1 | head -n 1)"
node_version="$(node --version 2>&1 | head -n 1)"

printf '{"c11":"%s","cpp17":"%s","java":"%s","python3":"%s","javascript":"%s"}\n' \
  "$(json_escape "$c_version")" \
  "$(json_escape "$cpp_version")" \
  "$(json_escape "$java_version")" \
  "$(json_escape "$python_version")" \
  "$(json_escape "$node_version")" \
  > /opt/quadrant/toolchain-runtime.json

chmod 0444 /opt/quadrant/toolchain-runtime.json
