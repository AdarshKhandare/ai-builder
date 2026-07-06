# syntax=docker/dockerfile:1.6
FROM python:3.12-slim

# Don't write .pyc files, don't buffer stdout/stderr (so logs flush)
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Install gosu for privilege dropping in the entrypoint.
# gosu is the standard tool used by official Docker images (postgres,
# redis, mysql) to drop from root to a non-root user without the PAM
# overhead of su/sudo. We need it because the entrypoint runs as root
# to fix the bind-mounted data directory's ownership, then drops to forge.
RUN apt-get update \
    && apt-get install -y --no-install-recommends gosu \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first (better layer caching)
COPY requirements.txt ./
RUN pip install -r requirements.txt

# Copy application code
COPY app/ ./app/

# Create the data directory for SQLite (mounted as a volume in compose)
RUN mkdir -p /app/data

RUN useradd --create-home --shell /bin/bash forge
RUN chown -R forge:forge /app

# Entrypoint: fixes bind-mount permissions as root, then drops to forge.
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 8000

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
