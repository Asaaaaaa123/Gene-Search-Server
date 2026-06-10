/**
 * Writes genegen/coolify-deploy.env from Docker build ARGs / environment.
 * Used when the committed coolify-deploy.env is not copied into the image (see .dockerignore).
 */
const fs = require("fs");
const path = require("path");

const outPath = path.join(__dirname, "..", "genegen", "coolify-deploy.env");

const api = (process.env.NEXT_PUBLIC_API_URL || "http://backend:8000").trim();
const npk = (process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || "").trim();
const cpk = (process.env.CLERK_PUBLISHABLE_KEY || npk).trim();
const sk = (process.env.CLERK_SECRET_KEY || "").trim();

const lines = [
  "# Generated at Docker build — do not commit",
  `NEXT_PUBLIC_API_URL=${api}`,
  `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=${npk}`,
  `CLERK_PUBLISHABLE_KEY=${cpk}`,
  `CLERK_SECRET_KEY=${sk}`,
  "",
];

fs.writeFileSync(outPath, lines.join("\n"), "utf8");
console.log("[generate-docker-frontend-env] wrote", outPath);
