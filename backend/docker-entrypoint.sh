#!/bin/sh
set -e

# Fix ownership of the data directory.
# The bind mount (./backend/data:/app/data) overrides the Dockerfile's
# chown — the mounted directory keeps the host's ownership (often root).
# We fix it here at startup so the forge user can write the SQLite DB.
chown -R forge:forge /app/data

# Drop privileges and exec the original CMD as the forge user.
# gosu is a lightweight, non-TTY su replacement used by official
# Docker images (postgres, redis, etc.) for privilege dropping.
exec gosu forge "$@"
