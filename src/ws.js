// src/ws.js
const WebSocket = require("ws");
const pty = require("node-pty");
const { getSession, touchSession } = require("./sessions");

function attachTerminalWs(server) {
  const wss = new WebSocket.Server({ noServer: true });

  // HTTP → WS upgrade for /terminal/ws
  server.on("upgrade", (req, socket, head) => {
    let url;
    try {
      url = new URL(req.url, "http://localhost");
    } catch (err) {
      console.error("[ws] invalid URL in upgrade:", err.message);
      socket.destroy();
      return;
    }

    if (url.pathname !== "/terminal/ws") {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req, url);
    });
  });

  wss.on("connection", (ws, req, url) => {
    const sessionId = url.searchParams.get("sessionId");
    const secret = url.searchParams.get("secret");

    const session = getSession(sessionId);
    if (!session || session.status !== "active" || session.secret !== secret) {
      console.log("[ws] invalid session or secret", sessionId);
      ws.close(1008, "Invalid session");
      return;
    }

    console.log(
      "[ws] connection for session",
      sessionId,
      "container",
      session.containerId
    );

    // Default size; can be updated via JSON resize messages.
    let cols = 80;
    let rows = 24;

    // Real PTY running docker exec / bash
    const shell = pty.spawn(
      "docker",
      ["exec", "-it", session.containerId, "/bin/bash"],
      {
        name: "xterm-color",
        cols,
        rows,
        cwd: "/",
        env: {
          ...process.env,
          TERM: "xterm-256color",
        },
      }
    );

    // Shell → browser
    shell.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    shell.onExit(({ exitCode, signal }) => {
      console.log("[ws] shell exit", { sessionId, exitCode, signal });
      if (ws.readyState === WebSocket.OPEN) {
        const msg =
          exitCode === 0
            ? "\r\n[shell] session ended\r\n"
            : `\r\n[shell] shell exited (code=${exitCode}, signal=${
                signal || "none"
              })\r\n`;
        try {
          ws.send(msg);
        } catch {
          /* ignore */
        }
        ws.close(1000, "Shell exited");
      }
    });

    // Browser → shell
    ws.on("message", (raw) => {
      // Decode message into a string
      let text;
      if (Buffer.isBuffer(raw)) {
        text = raw.toString("utf8");
      } else if (typeof raw === "string") {
        text = raw;
      } else {
        text = String(raw);
      }

      const trimmed = text.trim();

      // Try to interpret as a JSON control message first
      if (trimmed.startsWith("{")) {
        try {
          const msg = JSON.parse(trimmed);
          if (
            msg &&
            msg.type === "resize" &&
            typeof msg.cols === "number" &&
            typeof msg.rows === "number"
          ) {
            cols = msg.cols;
            rows = msg.rows;
            console.log("[ws] resize", { sessionId, cols, rows });
            shell.resize(cols, rows);
            // IMPORTANT: do NOT send this JSON to bash
            return;
          }
        } catch {
          // Not valid JSON (or not our control message) → fall through to shell
        }
      }

      // Normal input: forward to shell
      shell.write(text);
      touchSession(sessionId);
    });

    ws.on("close", () => {
      console.log("[ws] client disconnected", sessionId);
      try {
        shell.kill();
      } catch {
        /* ignore */
      }
    });

    ws.on("error", (err) => {
      console.error("[ws] ws error", sessionId, err.message);
    });
  });
}

module.exports = {
  attachTerminalWs,
};
