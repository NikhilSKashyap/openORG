import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const services = [
  ["openorg", root, ["dev"]],
  ["openSWE", new URL("../../openSWE", import.meta.url).pathname, ["dev"]],
  ["openPM", new URL("../../openPM", import.meta.url).pathname, ["dev"]],
  ["openGTM", new URL("../../openGTM", import.meta.url).pathname, ["dev"]]
];
const children = services.map(([name, cwd, args]) => {
  const child = spawn("pnpm", args, {
    cwd,
    stdio: "inherit",
    env: process.env
  });
  child.on("exit", (code) => {
    if (code) console.error(`${name} exited with ${code}`);
  });
  return child;
});
const stop = () => children.forEach((child) => child.kill("SIGTERM"));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
