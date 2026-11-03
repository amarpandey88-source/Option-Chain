import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import fs from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";

type WorkerRequest = {
  symbol: string; spot: number; pcr: number; indiaVix: number;
  atmStrike?: number; daysToExpiry: number; expiry?: string;
  timestamp: string; chain: unknown[];
};

type WorkerResponse = {
  ok: boolean; error?: string; optionChain?: unknown[];
  signals?: Record<string, unknown>; sampleCount?: number;
};

let worker: ChildProcessWithoutNullStreams | null = null;
let workerReader: ReturnType<typeof createInterface> | null = null;
let nextRequestId = 1;
const pending = new Map<number, { resolve: (value: WorkerResponse) => void; reject: (error: Error) => void }>();

function closeWorker(error?: Error) {
  workerReader?.close();
  workerReader = null;
  worker?.kill();
  worker = null;
  for (const request of pending.values()) request.reject(error ?? new Error("Pandas worker stopped."));
  pending.clear();
}

function ensureWorker() {
  if (worker && worker.stdin.writable) return worker;
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const bundledWorker = process.env.OCP_PYTHON_WORKER || (
    resourcesPath
      ? path.join(resourcesPath, "python", process.platform === "win32" ? "option-chain-pandas-worker.exe" : "option-chain-pandas-worker")
      : ""
  );
  const useBundledWorker = Boolean(bundledWorker && fs.existsSync(bundledWorker));
  const command = useBundledWorker
    ? bundledWorker
    : process.env.OCP_PYTHON_COMMAND || (process.platform === "win32" ? "python" : "python3");
  const args = useBundledWorker ? [] : ["worker.py"];
  worker = spawn(command, args, {
    cwd: useBundledWorker ? undefined : path.join(process.cwd(), "python"),
    stdio: ["pipe", "pipe", "pipe"],
  });
  workerReader = createInterface({ input: worker.stdout });
  workerReader.on("line", (line) => {
    try {
      const response = JSON.parse(line) as WorkerResponse & { requestId?: number };
      if (!response.requestId) return;
      const request = pending.get(response.requestId);
      if (!request) return;
      pending.delete(response.requestId);
      request.resolve(response);
    } catch (error) {
      console.error("[pandas-worker] invalid response:", error);
    }
  });
  worker.stderr.on("data", (chunk) => console.error(`[pandas-worker] ${chunk.toString().trim()}`));
  worker.once("error", (error) => closeWorker(error));
  worker.once("exit", () => closeWorker(new Error("Pandas worker exited.")));
  return worker;
}

export function enrichWithPandas(request: WorkerRequest): Promise<WorkerResponse | null> {
  try {
    const processHandle = ensureWorker();
    const requestId = nextRequestId++;
    return new Promise((resolve) => {
      pending.set(requestId, { resolve, reject: () => resolve(null) });
      processHandle.stdin.write(`${JSON.stringify({ ...request, requestId })}\n`, (error) => {
        if (error) {
          pending.delete(requestId);
          resolve(null);
        }
      });
    });
  } catch (error) {
    console.error("[pandas-worker] unavailable:", error);
    return Promise.resolve(null);
  }
}

process.once("exit", () => closeWorker());