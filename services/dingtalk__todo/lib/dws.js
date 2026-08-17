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

function failure(errorCode, { write = false, business = false } = {}) {
  return {
    success: false,
    data: null,
    error: write && !business
      ? "DingTalk todo write result is uncertain"
      : "DingTalk todo operation failed",
    errorCode,
    outcomeUncertain: write && !business,
  };
}

export async function runDws(ctx, args, { write = false, confirmed = false } = {}) {
  const config = ctx.config ?? {};
  const dwsPath = config.dwsPath || process.env.DWS_PATH || "dws";
  const rawTimeout = Number(config.timeoutMs || process.env.DWS_TIMEOUT || DEFAULT_TIMEOUT_MS);
  const timeout = Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : DEFAULT_TIMEOUT_MS;
  const dwsArgs = [...args];
  if (confirmed) dwsArgs.push("--yes");
  dwsArgs.push("--format", "json");

  return new Promise((resolve) => {
    execFile(dwsPath, dwsArgs, {
      timeout,
      maxBuffer: 10 * 1024 * 1024,
    }, (error, stdout) => {
      const raw = String(stdout || "").trim();
      let data = null;
      try {
        data = raw ? JSON.parse(raw) : null;
      } catch {
        data = raw;
      }

      const status = data && typeof data === "object" ? String(data.status || "").toLowerCase() : "";
      const errorEnvelope = data?.error && typeof data.error === "object" ? data.error : {};
      const errorCategory = String(errorEnvelope.category || "").toLowerCase();
      const businessFailed = data && typeof data === "object"
        && (
          data.success === false
          || status === "error"
          || status === "failed"
          || errorCategory === "validation"
          || errorCategory === "business"
          || String(errorEnvelope.reason || "").toLowerCase() === "business_error"
        );
      if (businessFailed) {
        const nestedError = data?.error && typeof data.error === "object" ? data.error : {};
        const rawCode = String(data?.errorCode ?? data?.code ?? nestedError.code ?? "").toUpperCase();
        resolve(failure(rawCode === "NOT_FOUND" ? rawCode : "DWS_BUSINESS_ERROR", {
          write,
          business: true,
        }));
        return;
      }
      if (error) {
        const timedOut = error.killed === true || error.signal === "SIGTERM" || error.code === "ETIMEDOUT";
        resolve(failure(timedOut ? "DWS_TIMEOUT" : "DWS_TRANSPORT_ERROR", { write }));
        return;
      }
      if (data === null || typeof data === "string") {
        resolve(failure("DWS_INVALID_RESPONSE", { write }));
        return;
      }

      resolve({ success: true, data, error: "", errorCode: "", outcomeUncertain: false });
    });
  });
}
