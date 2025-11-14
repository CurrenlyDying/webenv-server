// src/pool.js
const { createSandboxContainer } = require("./docker");
const { TARGET_FRESH_POOL_SIZE } = require("./config");

// containerId -> { id, status, createdAt }
const containers = new Map();
const freshPool = new Set();

/**
 * status:
 *  - "fresh": never used, in pool
 *  - "assigned": bound to a session
 *  - "terminating": being removed
 */

async function warmPool() {
  while (freshPool.size < TARGET_FRESH_POOL_SIZE) {
    try {
      const id = await createSandboxContainer();
      containers.set(id, {
        id,
        status: "fresh",
        createdAt: Date.now()
      });
      freshPool.add(id);
      console.log("[pool] created fresh container", id);
    } catch (err) {
      console.error("[pool] failed to create container:", err.message);
      break;
    }
  }
}

async function allocateContainer() {
  if (freshPool.size === 0) {
    console.log("[pool] fresh pool empty, creating one on demand");
    try {
      const id = await createSandboxContainer();
      containers.set(id, {
        id,
        status: "fresh",
        createdAt: Date.now()
      });
      freshPool.add(id);
    } catch (err) {
      console.error("[pool] failed to create container:", err.message);
      throw err;
    }
  }

  const id = freshPool.values().next().value;
  freshPool.delete(id);

  const rec = containers.get(id);
  if (!rec) throw new Error("Missing container record after allocation");

  rec.status = "assigned";
  containers.set(id, rec);

  // refill pool in background
  warmPool().catch((err) => {
    console.error("[pool] warmPool error:", err.message);
  });

  console.log("[pool] allocated container", id);
  return id;
}

function markContainerTerminating(containerId) {
  const rec = containers.get(containerId);
  if (!rec) return;
  rec.status = "terminating";
  containers.set(containerId, rec);
  freshPool.delete(containerId);
}

function getAllContainerIds() {
  return Array.from(containers.keys());
}

module.exports = {
  containers,
  freshPool,
  warmPool,
  allocateContainer,
  markContainerTerminating,
  getAllContainerIds
};
