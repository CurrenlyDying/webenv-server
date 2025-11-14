# WebEnv Terminal Server – Backend Setup

This document explains how to deploy the **terminal backend** for WebEnv on a Linux server, including:

* Building the sandbox Docker image
* Running the Node.js backend
* Managing it with `systemd`
* Exposing it via Caddy / HTTPS

All commands assume a **Debian/Ubuntu**-like host, with:

* Docker installed and working (`docker ps` succeeds)
* Node.js ≥ 18 (`node -v`)
* Caddy (or another reverse proxy) for HTTPS

Adjust paths / domains to your own setup.

---

## 1. Get the code onto the server

Clone or copy the backend repo to your home directory:

```bash
cd ~
git clone https://github.com/<you>/webenv-server.git
# or scp/rsync if you're copying from another machine
```

From here we’ll assume the backend lives at:

```bash
~/webenv-server
```

---

## 2. Build the sandbox Docker image

The terminal runs each user session inside an **ephemeral Docker container** built from the `sandbox/Dockerfile`.

1. Go to the sandbox directory:

```bash
cd ~/webenv-server/sandbox
```

2. Build the image:

```bash
sudo docker build -t webenv-sandbox .
```

3. Verify it exists:

```bash
sudo docker images | grep webenv-sandbox
```

You should see something like:

```text
webenv-sandbox   latest   <image_id>   <size>
```

This image contains:

* common CLI tools (bash, coreutils, git, htop, etc.)
* editors (`nano`, `vim-tiny`, `micro`)
* compilers / runtimes (gcc, Python, Node.js, Go, Ruby)
* all running later in **air-gapped**, **read-only-root** containers with `/root` and `/tmp` in **tmpfs (RAM)**.

---

## 3. Install backend dependencies

Now install Node.js dependencies for the terminal server.

1. Move the project to `/opt`:

```bash
sudo mkdir -p /opt/webenv
sudo cp -r ~/webenv-server /opt/webenv/
```

2. Install dependencies:

```bash
cd /opt/webenv/webenv-server
npm install
```

This installs `express`, `ws`, `uuid`, `node-pty`, and other dependencies used by the backend.

> You can test-run the server manually at this point:
>
> ```bash
> node src/index.js
> ```
>
> You should see:
>
> ```text
> [server] listening on http://localhost:4000
> [pool] created fresh container ...
> ```
>
> Stop it with `Ctrl+C` before proceeding to the service setup.

---

## 4. Create a dedicated system user & Docker access

To avoid running the backend as your main user, create a dedicated account:

```bash
# System user without login shell
sudo useradd -r -m -d /var/lib/webenv-terminal -s /usr/sbin/nologin webenv-terminal

# Allow this user to talk to the Docker daemon
sudo usermod -aG docker webenv-terminal
```

> If you also want *your* user to run Docker without `sudo`, do:
>
> ```bash
> sudo usermod -aG docker "$USER"
> newgrp docker
> ```

---

## 5. Optional: Environment configuration

You can control limits and CORS origins via environment variables.
Create an env file (optional but recommended):

```bash
sudo tee /etc/webenv-terminal.env >/dev/null <<'EOF'
NODE_ENV=production

# Listen port for backend HTTP server
PORT=4000

# Docker image name for terminal sandbox
SANDBOX_IMAGE=webenv-sandbox

# Pool of pre-warmed containers
TARGET_FRESH_POOL_SIZE=3

# Session timeouts (ms)
SESSION_IDLE_TIMEOUT_MS=300000  # 5 minutes

# Limits
MAX_CONCURRENT_SESSIONS=20
MAX_SESSIONS_PER_IP=2

# CORS: allowed frontend origins (comma-separated)
# During dev you can use "*"
ALLOWED_ORIGINS=*
EOF
```

You can tighten `ALLOWED_ORIGINS` later (e.g. `https://webenv.your-domain.com`).

---

## 6. Create the systemd service

Create a `systemd` unit so the backend:

* starts at boot
* restarts on failure
* runs with some extra sandboxing

```bash
sudo tee /etc/systemd/system/webenv-terminal.service >/dev/null <<'EOF'
[Unit]
Description=WebEnv Terminal Backend (ephemeral sandbox shells)
After=network-online.target docker.service
Wants=network-online.target docker.service

[Service]
Type=simple
User=webenv-terminal
Group=webenv-terminal
WorkingDirectory=/opt/webenv/webenv-server

# Environment
Environment=NODE_ENV=production
EnvironmentFile=-/etc/webenv-terminal.env

ExecStart=/usr/bin/node src/index.js
Restart=on-failure
RestartSec=2

# --- Extra service-level protections ---
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=full
ProtectHome=true
ProtectControlGroups=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectHostname=yes
RestrictRealtime=yes
LockPersonality=yes
RestrictSUIDSGID=yes
CapabilityBoundingSet=
AmbientCapabilities=
SystemCallArchitectures=native

[Install]
WantedBy=multi-user.target
EOF
```

Reload `systemd` and start the service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now webenv-terminal.service
```

Check status:

```bash
systemctl status webenv-terminal.service
```

You should see something like:

```text
Active: active (running)
Main PID: <pid> (node)
[server] listening on http://localhost:4000
[pool] created fresh container ...
```

---

## 7. Sanity checks

### 7.1. Health endpoint

From the server:

```bash
curl http://localhost:4000/healthz
```

Expected response:

```json
{"ok":true}
```

### 7.2. Docker pool

Check the pre-warmed containers:

```bash
docker ps
```

You should see several `webenv-sandbox` containers running `sleep infinity`.

Each web terminal session will:

* take a fresh container from this pool,
* attach a PTY (`/bin/bash`),
* and destroy the container when the session ends / times out.

---

## 8. Expose the backend via Caddy (HTTPS)

The terminal backend listens on `localhost:4000`.
Use Caddy to expose it as `https://term.your-domain.com` (with automatic TLS).

Edit `/etc/caddy/Caddyfile` and add:

```caddy
# Default static site (optional)
:80 {
    root * /usr/share/caddy
    file_server
}

# Terminal backend
term.your-domain.com {
    reverse_proxy 127.0.0.1:4000
}
```

Validate and reload Caddy:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Now from your machine you should be able to hit:

```bash
curl https://term.your-domain.com/healthz
```

and get:

```json
{"ok":true}
```

Your frontend should configure the terminal app to:

* `POST https://term.your-domain.com/terminal/session` to create a session
* Connect a WebSocket to `wss://term.your-domain.com/terminal/ws?...` with the returned query params
* Send periodic `POST /terminal/heartbeat` to keep the session alive
* `POST /terminal/close` on window close / shutdown

---

## 9. What this setup guarantees (yeah i flex sometimes)

Each terminal session runs in an **ephemeral hardened container**:

* `--network=none` → no LAN / internet access (fully air-gapped)
* `--cap-drop=ALL` + `--security-opt=no-new-privileges` → least-privilege root
* `--read-only` root filesystem
* `/root` and `/tmp` as **tmpfs (RAM)** (`64m` each), wiped when the container is removed
* Per-session containers are **created on demand** and **destroyed on exit**

Users can run compilers, editors, debuggers, and even destructive commands (e.g. `rm -rf /` inside the sandbox) without any impact on the host or other users.
