# Use an official Python runtime as a parent image
FROM python:3.12-slim

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    POETRY_VERSION=1.8.2 \
    POETRY_HOME="/opt/poetry" \
    POETRY_VIRTUALENVS_IN_PROJECT=true \
    POETRY_NO_INTERACTION=1

# Install system dependencies
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
    curl \
    tar \
    && rm -rf /var/lib/apt/lists/*

# Install Docker Client (Static Binary)
RUN curl -fsSL https://download.docker.com/linux/static/stable/x86_64/docker-27.3.1.tgz -o docker.tgz \
    && tar xzvf docker.tgz \
    && mv docker/docker /usr/local/bin/ \
    && rm -rf docker docker.tgz

# Install Poetry
RUN curl -sSL https://install.python-poetry.org | python3 -
ENV PATH="$POETRY_HOME/bin:$PATH"

# Set work directory
WORKDIR /app

# Copy project files
COPY pyproject.toml poetry.lock ./
COPY README.md ./
COPY strix ./strix

# Install dependencies
RUN poetry install --without dev --no-root

# Expose the port the app runs on
EXPOSE 8000

# Command to run the application
ENTRYPOINT ["poetry", "run", "strix", "--web"]
