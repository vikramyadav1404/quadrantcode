# syntax=docker/dockerfile:1.7
# Both build arguments are intentionally required. Production builds must pass
# digest-pinned image references; a mutable tag is rejected by the verifier.
ARG BASE_IMAGE
ARG NODE_IMAGE

FROM ${NODE_IMAGE} AS node_runtime
FROM ${BASE_IMAGE}

ARG DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      ca-certificates \
      gcc-13 \
      g++-13 \
      libc6-dev \
      openjdk-21-jdk-headless \
      python3.12 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10001 quadrant \
    && useradd --system --uid 10001 --gid quadrant --home-dir /home/quadrant --create-home quadrant \
    && mkdir -p /opt/quadrant /vercel/sandbox \
    && chown quadrant:quadrant /vercel/sandbox \
    && chmod 0755 /opt/quadrant /vercel/sandbox

COPY --from=node_runtime /usr/local/bin/node /usr/local/bin/node
COPY sandbox/runner/quadrant-exec.c /tmp/quadrant-exec.c
COPY sandbox/runner/write-toolchain-runtime.sh /tmp/write-toolchain-runtime.sh

RUN gcc-13 -std=c11 -O2 -Wall -Wextra -Werror -D_GNU_SOURCE \
      /tmp/quadrant-exec.c -o /usr/local/bin/quadrant-exec \
    && chown root:root /usr/local/bin/quadrant-exec \
    && chmod 0755 /usr/local/bin/quadrant-exec \
    && chmod 0755 /tmp/write-toolchain-runtime.sh \
    && /tmp/write-toolchain-runtime.sh \
    && rm -f /tmp/quadrant-exec.c /tmp/write-toolchain-runtime.sh

USER quadrant:quadrant
WORKDIR /vercel/sandbox
