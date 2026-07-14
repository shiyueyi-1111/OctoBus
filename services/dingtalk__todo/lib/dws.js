import { execFile } from "node:child_process";

const DEFAULT_TIMEOUT_MS = 60000;

export function requireValue(value, name) {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error(`${name} is required`);
  }
  return String(value).trim();
}

export function addFlag(args, name, value) {
  if (value === undefined || value === null || value === "" || value === 0) return args;
  args.push(name, String(value));
  return args;
}

export async function runDws(ctx, args) {
  const config = ctx.config ?? {};
  const dwsPath = config.dwsPath || process.env.DWS_PATH || "dws";
  const rawTimeout = Number(config.timeoutMs || process.env.DWS_TIMEOUT || DEFAULT_TIMEOUT_MS);
  const timeout = Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : DEFAULT_TIMEOUT_MS;

  return new Promise((resolve) => {
    execFile(dwsPath, [...args, "--yes", "--format", "json"], {
      timeout,
      maxBuffer: 10 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      const raw = String(stdout || "").trim();
      let data = null;
      try {
        data = raw ? JSON.parse(raw) : null;
      } catch {
        data = raw;
      }

      const status = data && typeof data === "object" ? String(data.status || "").toLowerCase() : "";
      const businessFailed = data && typeof data === "object" && data.success === false;
      if (error || businessFailed || status === "error" || status === "failed") {
        const message = data?.summary || data?.message || data?.error?.message || data?.error || String(stderr || error?.message || "dws command failed").trim();
        resolve({ success: false, data, error: typeof message === "string" ? message : JSON.stringify(message) });
        return;
      }

      resolve({ success: true, data, error: "" });
    });
  });
}
