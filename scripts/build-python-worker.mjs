import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const python = process.env.OCP_PYTHON_COMMAND || (process.platform === "win32" ? "python" : "python3");
const outputDir = join(root, "python-dist");
const workDir = join(root, "build", "python-worker");

for (const directory of [outputDir, workDir]) {
  if (existsSync(directory)) rmSync(directory, { recursive: true, force: true });
}

function run(args) {
  const result = spawnSync(python, args, { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(["-m", "pip", "install", "-r", "python/requirements.txt", "pyinstaller"]);
run([
  "-m", "PyInstaller", "--clean", "--onefile",
  "--name", "option-chain-pandas-worker",
  "--distpath", outputDir, "--workpath", workDir, "--specpath", workDir,
  "python/worker.py",
]);