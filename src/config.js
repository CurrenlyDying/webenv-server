// src/config.js

const parseIntOr = (value, def) => {
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? def : n;
};

module.exports = {
  PORT: parseIntOr(process.env.PORT, 4000),

  // Docker image that holds the sandbox shell
  SANDBOX_IMAGE: process.env.SANDBOX_IMAGE || "webenv-sandbox",

  // Target pool size of "fresh" containers
  TARGET_FRESH_POOL_SIZE: parseIntOr(process.env.TARGET_FRESH_POOL_SIZE, 3),

  // Session idle timeout (ms) before auto-termination
  SESSION_IDLE_TIMEOUT_MS: parseIntOr(process.env.SESSION_IDLE_TIMEOUT_MS, 5 * 60 * 1000),

  // Global max concurrent sessions (safety)
  MAX_CONCURRENT_SESSIONS: parseIntOr(process.env.MAX_CONCURRENT_SESSIONS, 20),

  // Max sessions per client IP
  MAX_SESSIONS_PER_IP: parseIntOr(process.env.MAX_SESSIONS_PER_IP, 2),

  // Comma-separated list of allowed origins, or "*" for dev
  ALLOWED_ORIGINS: (process.env.ALLOWED_ORIGINS || "*")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
};
