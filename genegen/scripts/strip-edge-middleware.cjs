/**
 * Coolify health checks hit /. Clerk's Edge middleware throws without NEXT_PUBLIC_* at build time.
 * This removes compiled Edge middleware and clears manifests so requests never enter that bundle.
 */
const fs = require("fs");
const path = require("path");

const root = process.cwd();

function walk(dir, onFile) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules") continue;
      walk(full, onFile);
    } else {
      onFile(full, e.name);
    }
  }
}

let removed = 0;
walk(path.join(root, ".next"), (full, name) => {
  if (name !== "middleware.js") return;
  if (!full.endsWith(`${path.sep}server${path.sep}middleware.js`)) return;
  fs.unlinkSync(full);
  removed += 1;
  console.log("[strip-edge-middleware] removed", path.relative(root, full));
});

walk(path.join(root, ".next"), (full, name) => {
  if (name !== "middleware-manifest.json") return;
  if (full.includes(`${path.sep}node_modules${path.sep}`)) return;
  try {
    const j = JSON.parse(fs.readFileSync(full, "utf8"));
    j.middleware = {};
    j.functions = {};
    j.sortedMiddleware = [];
    fs.writeFileSync(full, JSON.stringify(j));
    console.log("[strip-edge-middleware] cleared", path.relative(root, full));
  } catch (err) {
    console.warn("[strip-edge-middleware] skip", full, err.message);
  }
});

console.log(
  "[strip-edge-middleware] done (removed %s server/middleware.js file(s))",
  removed,
);
