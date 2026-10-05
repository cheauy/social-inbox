// One command for local work: the TENH web app and, when it is set up, the
// Telegram Personal worker. Ctrl+C stops both.
//   npm run dev:all
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const workerDir = join(root, "workers", "telegram-personal");
const children = [];

function run(name, command, args, cwd) {
  const child = spawn(command, args, { cwd, shell: process.platform === "win32", stdio: ["ignore", "pipe", "pipe"] });
  const prefix = (chunk) => chunk.toString().split(/\r?\n/).filter(Boolean).map((line) => `[${name}] ${line}`).join("\n") + "\n";
  child.stdout.on("data", (chunk) => process.stdout.write(prefix(chunk)));
  child.stderr.on("data", (chunk) => process.stderr.write(prefix(chunk)));
  child.on("exit", (code) => console.log(`[${name}] stopped${code ? ` (exit ${code})` : ""}`));
  children.push(child);
}

run("web", "npm", ["run", "dev"], root);
if (existsSync(join(workerDir, ".env"))) {
  run("telegram", "npm", ["start"], workerDir);
} else {
  console.log("[telegram] not started: workers/telegram-personal/.env is missing (see .env.example there).");
}

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  // SIGINT lets the worker close Telegram sessions cleanly.
  for (const child of children) child.kill("SIGINT");
  setTimeout(() => process.exit(0), 25_000).unref();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
