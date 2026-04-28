import { spawn } from "node:child_process";
import { createServer } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

// Start Vite dev server
const vite = await createServer({ configFile: path.join(root, "vite.config.ts") });
await vite.listen();
const viteUrl = `http://localhost:${vite.config.server.port}`;
console.log(`[vite] ${viteUrl}`);

// Start Node.js API server
const serverProc = spawn("node", [path.join(root, "server.mjs")], {
  stdio: "inherit",
  env: { ...process.env },
});

serverProc.on("close", (code) => {
  if (code) console.log(`[server] exited with code ${code}`);
  process.exit(code ?? 0);
});
