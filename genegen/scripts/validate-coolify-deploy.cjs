/**
 * Fails the Docker build if coolify-deploy.env has common mistakes (wrong variable slots).
 */
const fs = require("fs");

function parseEnvFile(filePath) {
  const out = {};
  if (!fs.existsSync(filePath)) {
    console.error("Missing", filePath);
    process.exit(1);
  }
  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (k) out[k] = v;
  }
  return out;
}

const env = parseEnvFile("coolify-deploy.env");
const api = (env.NEXT_PUBLIC_API_URL || "").trim();
const npk = (env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || "").trim();
const cpk = (env.CLERK_PUBLISHABLE_KEY || "").trim();
const sk = (env.CLERK_SECRET_KEY || "").trim();

const isInternalDockerApi =
  /^https?:\/\/backend(?::\d+)?(?:\/|$)/i.test(api) ||
  /^https?:\/\/127\.0\.0\.1(?::\d+)?(?:\/|$)/i.test(api);

if (!/^https?:\/\//i.test(api)) {
  console.error(
    "[validate] NEXT_PUBLIC_API_URL must be your FastAPI base URL starting with http:// or https://",
  );
  console.error(
    "[validate] Do NOT put CLERK_SECRET_KEY (sk_...) here — that breaks the build and runtime.",
  );
  process.exit(1);
}

if (/^sk_(test|live)_/i.test(api) || /^pk_(test|live)_/i.test(api)) {
  console.error(
    "[validate] NEXT_PUBLIC_API_URL looks like a Clerk key. Put the backend URL here (e.g. https://api.yourdomain.com).",
  );
  process.exit(1);
}

if (!isInternalDockerApi && /CHANGE_ME|REPLACE-WITH|your-api\.example/i.test(api)) {
  console.error(
    "[validate] Replace NEXT_PUBLIC_API_URL with your real API base (no trailing slash).",
  );
  console.error(
    "[validate] For Docker Compose on one host, use http://backend:8000",
  );
  process.exit(1);
}

if (!/^pk_(test|live)_/.test(npk) || npk.includes("CHANGE_ME")) {
  console.error(
    "[validate] NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY must start with pk_test_ or pk_live_.",
  );
  console.error(
    "[validate] Coolify: add it under Environment Variables and enable 'Available at Buildtime'.",
  );
  console.error(
    "[validate] Or commit coolify-deploy.env in genegen/ (private repo) with keys filled in.",
  );
  process.exit(1);
}

if (!/^pk_(test|live)_/.test(cpk) || cpk.includes("CHANGE_ME")) {
  console.error(
    "[validate] CLERK_PUBLISHABLE_KEY must match your publishable key (pk_test_... or pk_live_...).",
  );
  process.exit(1);
}

if (!/^sk_(test|live)_/.test(sk) || sk.includes("CHANGE_ME")) {
  console.error(
    "[validate] CLERK_SECRET_KEY must start with sk_test_ or sk_live_ (from Clerk Dashboard).",
  );
  process.exit(1);
}

console.log("[validate] coolify-deploy.env looks structurally OK.");
