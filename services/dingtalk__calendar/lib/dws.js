import { execFile } from "node:child_process";

const DEFAULT_TIMEOUT_MS = 60000;

export function requireValue(value, name) {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error(`${name} is required`);
  }
  return String(value).trim();
}

function failure(errorCode, { write = false, business = false } = {}) {
  const outcomeUncertain = write && !business;
  return {
    success: false,
    data: null,
    error: outcomeUncertain
      ? "DingTalk calendar write result is uncertain"
      : "DingTalk calendar operation failed",
    errorCode,
    outcomeUncertain,
  };
}

function parseJson(stdout) {
  const raw = String(stdout ?? "").trim();
  if (!raw) return { parsed: false, data: null };
  try {
    return { parsed: true, data: JSON.parse(raw) };
  } catch {
    return { parsed: false, data: null };
  }
}

function isBusinessFailure(data) {
  if (data == null || typeof data !== "object") return false;
  const status = String(data.status ?? "").toLowerCase();
  const nestedError = data.error && typeof data.error === "object" ? data.error : {};
  return data.success === false
    || status === "error"
    || status === "failed"
    || String(nestedError.reason ?? "").toLowerCase() === "business_error";
}

function stableBusinessErrorCode(data) {
  const nestedError = data?.error && typeof data.error === "object" ? data.error : {};
  const raw = String(data?.errorCode ?? data?.code ?? nestedError.code ?? "").toUpperCase();
  return raw === "NOT_FOUND" ? raw : "DWS_BUSINESS_ERROR";
}

export async function runDws(ctx, args, { write = false } = {}) {
  const config = ctx?.config ?? {};
  const dwsPath = config.dwsPath || process.env.DWS_PATH || "dws";
  const configuredTimeout = Number(config.timeoutMs || process.env.DWS_TIMEOUT || DEFAULT_TIMEOUT_MS);
  const timeout = Number.isFinite(configuredTimeout) && configuredTimeout > 0
    ? configuredTimeout
    : DEFAULT_TIMEOUT_MS;

  return new Promise((resolve) => {
    execFile(
      dwsPath,
      [...args, "--yes", "--format", "json"],
      { timeout, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout) => {
        const { parsed, data } = parseJson(stdout);
        if (isBusinessFailure(data)) {
          resolve(failure(stableBusinessErrorCode(data), { write, business: true }));
          return;
        }
        if (error) {
          const timedOut = error.killed === true || error.signal === "SIGTERM" || error.code === "ETIMEDOUT";
          resolve(failure(timedOut ? "DWS_TIMEOUT" : "DWS_TRANSPORT_ERROR", { write }));
          return;
        }
        if (!parsed) {
          resolve(failure("DWS_INVALID_RESPONSE", { write }));
          return;
        }
        resolve({ success: true, data, error: "", errorCode: "", outcomeUncertain: false });
      },
    );
  });
}
