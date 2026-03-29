/**
 * Injected as the first line of Next standalone server.js.
 * Runs even when the container entrypoint is overridden (e.g. Coolify → `node server.js`).
 * Loads /app/.env.runtime and removes Clerk Edge middleware before Next boots.
 */
"use strict";

// stderr so it appears before Next’s banner in `docker logs` (helps verify patched server.js).
console.error(
  "[GENEGEN-BOOT] loading .env.runtime + stripping Edge middleware (if this line is missing, Coolify is not running patched server.js)",
);

const fs = require("fs");
const path = require("path");

const appRoot = __dirname;

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (key) process.env[key] = val;
  }
}

loadEnvFile(path.join(appRoot, ".env.runtime"));
process.chdir(appRoot);

require(path.join(appRoot, "scripts", "strip-edge-middleware.cjs"));
