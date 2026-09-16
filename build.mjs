import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const src = path.join(root, "src");
const dist = path.join(root, "dist");
const api = (process.env.HERITAGETUNE_API_URL || "").replace(/\/+$/, "");

if (!api || !/^https:\/\//i.test(api)) {
  console.error("\nERROR: Chua cau hinh HERITAGETUNE_API_URL.");
  console.error("Hay dat bien moi truong Netlify, vi du:");
  console.error("HERITAGETUNE_API_URL=https://heritagetune-then-api.onrender.com\n");
  process.exit(1);
}

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
for (const name of fs.readdirSync(src)) {
  fs.cpSync(path.join(src, name), path.join(dist, name), { recursive: true });
}

// Netlify rewrite/proxy: trinh duyet chi goi /api/* tren cung ten mien Netlify.
// Netlify se chuyen tiep request den FastAPI tren Render.
const redirects = `/api/*  ${api}/api/:splat  200\n`;
fs.writeFileSync(path.join(dist, "_redirects"), redirects, "utf8");

console.log(`HeritageTune frontend 1.1.3 built. API proxy -> ${api}`);
