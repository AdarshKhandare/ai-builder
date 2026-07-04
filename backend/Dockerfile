# syntax=docker/dockerfile:1.6
FROM python:3.12-slim

# Don't write .pyc files, don't buffer stdout/stderr (so logs flush)
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

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
USER forge

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
