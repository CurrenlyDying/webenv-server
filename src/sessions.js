// src/sessions.js
const { v4: uuidv4 } = require("uuid");
const { allocateContainer, markContainerTerminating } = require("./pool");
const { killContainer } = require("./docker");
const {
  SESSION_IDLE_TIMEOUT_MS,
  MAX_CONCURRENT_SESSIONS,
  MAX_SESSIONS_PER_IP
} = require("./config");

/**
 * Session:
 * {
 *   sessionId,
 *   containerId,
 *   status: "active" | "terminating",
 *   lastHeartbeatAt,
 *   ip,
 *   secret  // random secret so WS can't be hijacked by just guessing id
 * }
 */

const sessions = new Map();

function countActiveSessions() {
  let n = 0;
  for (const s of sessions.values()) {
    if (s.status === "active") n++;
  }
  return n;
}

function countSessionsForIp(ip) {
  let n = 0;
  for (const s of sessions.values()) {
    if (s.status === "active" && s.ip === ip) n++;
  }
  return n;
}

async function createSessionForIp(ip) {
  // Check limits
  const total = countActiveSessions();
  if (total >= MAX_CONCURRENT_SESSIONS) {
    throw new Error("max_concurrent_sessions_reached");
  }

  const perIp = countSessionsForIp(ip);
  if (perIp >= MAX_SESSIONS_PER_IP) {
    throw new Error("max_sessions_per_ip_reached");
  }

  const containerId = await allocateContainer();
  const sessionId = uuidv4();
  const secret = uuidv4();

  const session = {
    sessionId,
    containerId,
    status: "active",
    lastHeartbeatAt: Date.now(),
    ip,
    secret
  };

  sessions.set(sessionId, session);

  return session;
}

function getSession(sessionId) {
  return sessions.get(sessionId);
}

function touchSession(sessionId) {
  const s = sessions.get(sessionId);
  if (!s || s.status !== "active") return;
  s.lastHeartbeatAt = Date.now();
}

async function terminateSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return;

  if (session.status === "terminating") return;
  session.status = "terminating";
  sessions.set(sessionId, session);

  markContainerTerminating(session.containerId);
  console.log("[session] terminating", sessionId, "container", session.containerId);

  await killContainer(session.containerId);
  sessions.delete(sessionId);
}

function startIdleCleanupLoop() {
  setInterval(() => {
    const now = Date.now();
    for (const s of sessions.values()) {
      if (s.status !== "active") continue;
      const idle = now - s.lastHeartbeatAt;
      if (idle > SESSION_IDLE_TIMEOUT_MS) {
        console.log("[session] idle timeout", s.sessionId);
        terminateSession(s.sessionId).catch((err) => {
          console.error("[session] terminate error:", err.message);
        });
      }
    }
  }, 60_000);
}

function exportSessionsMap() {
  return sessions;
}

module.exports = {
  createSessionForIp,
  getSession,
  touchSession,
  terminateSession,
  startIdleCleanupLoop,
  exportSessionsMap
};
