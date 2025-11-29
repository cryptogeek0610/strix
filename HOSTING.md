# 🏠 Self-Hosting Strix

This guide provides instructions on how to self-host Strix, allowing you to run the AI security agent and its web interface on your own infrastructure.

## Prerequisites

Before you begin, ensure you have the following:

- **Python 3.12+**: Strix requires a modern Python version.
- **Docker**: Required for the sandboxed environment where agents execute code.
- **LLM API Key**: Access to a supported LLM provider (e.g., OpenAI, Anthropic) or a local LLM setup.

## 🛠️ Installation

You can install Strix directly from PyPI or from the source code.

### Option 1: Install via pipx (Recommended)

`pipx` installs Strix in an isolated environment, keeping your system clean.

```bash
pipx install strix-agent
```

### Option 2: Install from Source

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/usestrix/strix.git
    cd strix
    ```

2.  **Install dependencies:**
    Using Poetry (recommended):
    ```bash
    poetry install
    ```
    Or using pip:
    ```bash
    pip install .
    ```

## ⚙️ Configuration

Set up the necessary environment variables. You can add these to your shell profile (e.g., `.bashrc`, `.zshrc`) or a `.env` file.

```bash
# Required: LLM Provider
export STRIX_LLM="openai/gpt-5"  # or "anthropic/claude-3-5-sonnet-20240620"
export LLM_API_KEY="sk-..."

# Optional: Local LLM (e.g., Ollama)
# export LLM_API_BASE="http://localhost:11434"

# Optional: Search Capabilities
# export PERPLEXITY_API_KEY="pplx-..."
```

## 🌐 Running the Web Interface

Strix comes with a built-in web interface for managing scans and viewing results.

To start the web server:

```bash
strix --web
```

This will launch the server at `http://localhost:8000`. You can access the dashboard in your browser to:

- Start new scans
- Monitor active agents
- View vulnerability reports
- Review logs

## 🚀 Running as a Service (Linux)

To keep Strix running permanently on a server, you can set it up as a systemd service.

1.  **Create a service file** at `/etc/systemd/system/strix.service`:

    ```ini
    [Unit]
    Description=Strix Security Agent Web Interface
    After=network.target docker.service
    Requires=docker.service

    [Service]
    Type=simple
    User=your-username
    Group=your-group
    WorkingDirectory=/path/to/strix
    Environment="STRIX_LLM=openai/gpt-5"
    Environment="LLM_API_KEY=your-api-key"
    Environment="PATH=/usr/local/bin:/usr/bin:/bin"
    ExecStart=/usr/local/bin/strix --web
    Restart=always
    RestartSec=10

    [Install]
    WantedBy=multi-user.target
    ```

2.  **Enable and start the service:**

    ```bash
    sudo systemctl daemon-reload
    sudo systemctl enable strix
    sudo systemctl start strix
    ```

3.  **Check status:**

    ```bash
    sudo systemctl status strix
    ```

## 🐳 Docker Support

Strix uses Docker internally to create secure sandboxes for its agents. When you run `strix`, it automatically pulls the `strix-sandbox` image.

- **Sandbox Image**: The agents execute potentially dangerous commands inside a container derived from Kali Linux.
- **Host System**: The main Strix process (orchestrator/web server) runs on your host machine to manage these containers.

> [!IMPORTANT]
> Ensure the user running Strix has permission to access the Docker daemon (e.g., is in the `docker` group).

## 🔒 Security Considerations

- **Access Control**: The default web interface does not have built-in authentication. If hosting publicly, **you must put it behind a reverse proxy** (like Nginx, Traefik, or Cloudflare Tunnel) with Basic Auth or OAuth.
- **Resource Usage**: AI agents can be resource-intensive. Monitor your CPU and memory usage, especially when running multiple concurrent scans.
- **Cost Management**: Self-hosting uses your own API keys. Set usage limits with your LLM provider to avoid unexpected costs.
