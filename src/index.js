// src/index.js
const http = require("http");
const { makeApp } = require("./http");
const { attachTerminalWs } = require("./ws");
const { warmPool, getAllContainerIds } = require("./pool");
const { killContainer } = require("./docker");
const { startIdleCleanupLoop, exportSessionsMap, terminateSession } = require("./sessions");
const { PORT } = require("./config");

async function main() {
  const app = makeApp();
  const server = http.createServer(app);

  attachTerminalWs(server);

  server.listen(PORT, async () => {
    console.log(`[server] listening on http://localhost:${PORT}`);
    await warmPool();
    startIdleCleanupLoop();
  });

  // Graceful shutdown
  async function shutdown(signal) {
    console.log(`[server] received ${signal}, shutting down...`);

    server.close(() => {
      console.log("[server] HTTP server closed");
    });

    // terminate all sessions
    const sessions = exportSessionsMap();
    const termPromises = [];
    for (const s of sessions.values()) {
      termPromises.push(terminateSession(s.sessionId));
    }
    await Promise.allSettled(termPromises);

    // in case any containers remain (shouldn't, but just in case)
    const containerIds = getAllContainerIds();
    const killPromises = containerIds.map((id) => killContainer(id));
    await Promise.allSettled(killPromises);

    console.log("[server] cleanup done, exiting");
    process.exit(0);
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[server] fatal error", err);
  process.exit(1);
});
