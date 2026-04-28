import { spawn } from "node:child_process";
import { createServer } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const vite = await createServer({ configFile: path.join(root, "vite.config.ts") });
await vite.listen();

const urls = vite.resolvedUrls?.local ?? [];
const viteUrl = urls[0] ?? `http://localhost:${vite.config.server.port}`;
console.log(`[vite] ${viteUrl}`);

const electronProc = spawn("pnpm", ["exec", "electron", "."], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    VITE_DEV_SERVER_URL: viteUrl,
  },
});

electronProc.on("close", async (code) => {
  await vite.close();
  process.exit(code ?? 0);
});

process.on("SIGINT", () => {
  electronProc.kill("SIGINT");
});
