/**
 * Production-safe logger for Fo-Fi CRM.
 *
 * - DEV mode: all levels printed (debug, info, warn, error, security)
 * - PROD mode: only warn, error, and security events are printed;
 *   sensitive fields (passwords, tokens, auth keys) are never logged.
 */

const IS_DEV = import.meta.env.DEV;

const SENSITIVE_KEYS = new Set([
  "password", "passwords", "Authorization", "authorization",
  "x-api-key", "token", "secret", "cookie", "credit_card",
]);

function redact(obj) {
  if (!obj || typeof obj !== "object") return obj;
  const clean = Array.isArray(obj) ? [...obj] : { ...obj };
  for (const key of Object.keys(clean)) {
    if (SENSITIVE_KEYS.has(key)) {
      clean[key] = "***REDACTED***";
    } else if (typeof clean[key] === "object" && clean[key] !== null) {
      clean[key] = redact(clean[key]);
    }
  }
  return clean;
}

function timestamp() {
  return new Date().toISOString();
}

const logger = {
  /** Debug — dev only, never in production */
  debug(tag, message, data) {
    if (!IS_DEV) return;
    console.log(`[${timestamp()}] [DEBUG] [${tag}] ${message}`, data !== undefined ? redact(data) : "");
  },

  /** Info — dev only */
  info(tag, message, data) {
    if (!IS_DEV) return;
    console.info(`[${timestamp()}] [INFO] [${tag}] ${message}`, data !== undefined ? redact(data) : "");
  },

  /** Warn — always printed (dev + prod) */
  warn(tag, message, data) {
    console.warn(`[${timestamp()}] [WARN] [${tag}] ${message}`, data !== undefined ? redact(data) : "");
  },

  /** Error — always printed (dev + prod) */
  error(tag, message, data) {
    console.error(`[${timestamp()}] [ERROR] [${tag}] ${message}`, data !== undefined ? redact(data) : "");
  },

  /** Security events — always printed, auto-redacted */
  security(event, details) {
    console.warn(
      `[${timestamp()}] [SECURITY] ${event}`,
      details ? redact(details) : ""
    );
  },

  /** API request/response — dev: full info, prod: errors only */
  api(method, url, status, duration) {
    const entry = { method, url, status, duration: `${duration}ms` };
    if (status >= 400) {
      console.error(`[${timestamp()}] [API] ${method} ${url} → ${status} (${duration}ms)`);
    } else if (IS_DEV) {
      console.log(`[${timestamp()}] [API] ${method} ${url} → ${status} (${duration}ms)`);
    }
  },
};

export default logger;
