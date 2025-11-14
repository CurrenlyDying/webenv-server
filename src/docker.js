// src/docker.js
const { spawn } = require("child_process");
const { SANDBOX_IMAGE } = require("./config");

/**
 * Run a docker CLI command and resolve with stdout (trimmed) on success.
 */
function runDocker(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn("docker", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(
          new Error(
            `docker ${args.join(" ")} failed with code ${code}: ${stderr}`
          )
        );
      }
    });

    proc.on("error", (err) => {
      reject(err);
    });
  });
}

/**
 * Create a new sandbox container for a terminal session.
 * - No network (air-gapped)
 * - Root filesystem read-only
 * - /tmp and /root as tmpfs in RAM (64MB each)
 * - All kernel capabilities dropped, no-new-privileges
 * - CPU, memory, and PID limits
 */
async function createSandboxContainer() {
  const image = SANDBOX_IMAGE || process.env.SANDBOX_IMAGE || "webenv-sandbox";

  const args = [
    "run",
    "-d",

    // Full network isolation: the container cannot reach LAN, host, or internet.
    "--network=none",

    // Privilege hardening: even root inside the container is heavily restricted.
    "--security-opt=no-new-privileges",
    "--cap-drop=ALL",

    // Resource limits: prevent abuse / accidental DoS.
    "--cpus=0.5",
    "--memory=256m",
    "--pids-limit=128",

    // Avoid growing docker logs for each sandbox container.
    "--log-driver=none",

    // Immutable base filesystem.
    "--read-only",

    // Writable RAM-backed areas for user data and tools that expect /tmp and a home.
    "--tmpfs",
    "/tmp:rw,exec,nosuid,size=64m",
    "--tmpfs",
    "/root:rw,exec,nosuid,size=64m",

    // Image and command
    image,
    "sleep",
    "infinity",
  ];

  const id = await runDocker(args);
  console.log("[docker] created sandbox container", id);
  return id;
}

/**
 * Force-remove a sandbox container.
 * Any tmpfs data (/tmp, /root) vanishes with it.
 */
async function killContainer(containerId) {
  if (!containerId) return;
  try {
    await runDocker(["rm", "-f", containerId]);
    console.log("[docker] removed sandbox container", containerId);
  } catch (err) {
    // Not critical; container may already be gone.
    console.error("[docker] rm failed", containerId, err.message);
  }
}

module.exports = {
  runDocker,
  createSandboxContainer,
  killContainer,
};
