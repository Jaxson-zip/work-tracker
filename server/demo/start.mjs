import { spawn } from "node:child_process";
const child = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "5174", "--strictPort"], {
  stdio: "inherit",
  env: { ...process.env, VITE_WORK_TRACKER_DEMO: "1" },
  windowsHide: true,
});
child.on("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
