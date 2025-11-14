// src/http.js
const express = require("express");
const {
  ALLOWED_ORIGINS,
  SESSION_IDLE_TIMEOUT_MS
} = require("./config");
const {
  createSessionForIp,
  getSession,
  touchSession,
  terminateSession
} = require("./sessions");

function originAllowed(origin) {
  if (!origin) return true; // CLI / curl
  if (ALLOWED_ORIGINS.includes("*")) return true;
  return ALLOWED_ORIGINS.includes(origin);
}

function makeApp() {
  const app = express();
  app.use(express.json());

  // CORS
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (originAllowed(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin || "*");
      res.setHeader("Access-Control-Allow-Credentials", "true");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.sendStatus(200);
    next();
  });

  app.get("/healthz", (req, res) => {
    res.json({ ok: true });
  });

  // Helper to get client IP (may adapt if behind proxy)
  const getIp = (req) => {
    return (
      req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
      req.socket.remoteAddress ||
      "unknown"
    );
  };

  app.post("/terminal/session", async (req, res) => {
    const ip = getIp(req);
    try {
      const session = await createSessionForIp(ip);
      const wsUrl = `/terminal/ws?sessionId=${session.sessionId}&secret=${session.secret}`;
      res.json({
        sessionId: session.sessionId,
        wsUrl,
        expiresInSeconds: Math.floor(SESSION_IDLE_TIMEOUT_MS / 1000)
      });
    } catch (err) {
      console.error("[http] /terminal/session error:", err.message);
      if (err.message === "max_concurrent_sessions_reached") {
        return res.status(503).json({ error: err.message });
      }
      if (err.message === "max_sessions_per_ip_reached") {
        return res.status(429).json({ error: err.message });
      }
      return res.status(500).json({ error: "session_creation_failed" });
    }
  });

  app.post("/terminal/heartbeat", (req, res) => {
    const { sessionId } = req.body || {};
    if (!sessionId) {
      return res.status(400).json({ error: "missing_session_id" });
    }
    const session = getSession(sessionId);
    if (!session || session.status !== "active") {
      return res.status(404).json({ error: "session_not_found" });
    }
    touchSession(sessionId);
    res.json({ ok: true });
  });

  app.post("/terminal/close", async (req, res) => {
    const { sessionId } = req.body || {};
    if (!sessionId) {
      return res.status(400).json({ error: "missing_session_id" });
    }
    const session = getSession(sessionId);
    if (!session) {
      return res.status(404).json({ error: "session_not_found" });
    }
    await terminateSession(sessionId);
    res.json({ ok: true });
  });

  return app;
}

module.exports = {
  makeApp
};
