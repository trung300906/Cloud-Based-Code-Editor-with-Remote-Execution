FROM python:3.12-slim-bookworm

ARG SANDBOX_UID=10001
ARG SANDBOX_GID=10001

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOME=/home/sandbox_user \
    WORKSPACE=/workspace \
    TMPDIR=/tmp

RUN apt-get update \
    && apt-get install -y --no-install-recommends procps tini g++ \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid ${SANDBOX_GID} sandbox_user \
    && useradd --uid ${SANDBOX_UID} --gid ${SANDBOX_GID} --create-home --home-dir /home/sandbox_user --shell /usr/sbin/nologin sandbox_user \
    && mkdir -p /workspace \
    && chown -R ${SANDBOX_UID}:${SANDBOX_GID} /workspace /home/sandbox_user

WORKDIR /workspace
USER ${SANDBOX_UID}:${SANDBOX_GID}
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sleep", "infinity"]