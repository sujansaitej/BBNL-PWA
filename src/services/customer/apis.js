// API services
import logger from "../../utils/logger";
import perfMonitor from "../../utils/apiPerfMonitor";

function getBaseUrl() {
    // return import.meta.env.VITE_API_BASE_URL;
    if (import.meta.env.PROD) return import.meta.env.VITE_API_BASE_URL; // Use this in production
    return '/api/'; // Use proxy in development
}

const API_TIMEOUT = 15000; // 15 seconds

/** Fetch with AbortController timeout, perf monitoring, and structured logging */
async function apiFetchWithTimeout(url, options, label = "Customer") {
    const method = options.method || "POST";
    const endPerf = perfMonitor.start(method, url, "Customer", label);
    logger.debug("Customer", `${label} → ${method} ${url}`);

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT);
    try {
        const resp = await fetch(url, { ...options, signal: ctrl.signal });
        const entry = endPerf({ status: resp.status });
        logger.api(method, url, resp.status, entry.duration);
        return resp;
    } catch (err) {
        const isTimeout = err.name === "AbortError";
        const errMsg = isTimeout ? "timeout" : `network error: ${err.message}`;
        endPerf({ status: 0, error: errMsg });
        logger.error("Customer", `${label} ${errMsg}`, { method, url });
        if (isTimeout) throw new Error("Request timed out. Please check your network and try again.");
        throw err;
    } finally {
        clearTimeout(timer);
    }
}

function getHeadersJson() {
  return {
    Authorization: import.meta.env.VITE_API_AUTH_KEY,
    username: import.meta.env.VITE_API_USERNAME,
    password: import.meta.env.VITE_API_PASSWORD,
    appkeytype: localStorage.getItem('loginType') == "franchisee" ? import.meta.env.VITE_API_APP_USER_TYPE : import.meta.env.VITE_API_APP_USER_TYPE_CUST,
    appversion: import.meta.env.VITE_API_APP_VERSION,
    "X-App-Package": "com.bbnl.smartphone",
    "Content-Type": "application/json",
  };
}

function getHeadersForm() {
    return {
        Authorization: import.meta.env.VITE_API_AUTH_KEY,
        username: import.meta.env.VITE_API_USERNAME,
        password: import.meta.env.VITE_API_PASSWORD,
        appkeytype: localStorage.getItem('loginType') == "franchisee" ? import.meta.env.VITE_API_APP_USER_TYPE : import.meta.env.VITE_API_APP_USER_TYPE_CUST,
        appversion: import.meta.env.VITE_API_APP_VERSION,
        "X-App-Package": "com.bbnl.smartphone",
    };
}

export async function ads(type) {
  const url = `${getBaseUrl()}apis/webads`;
  const headers = getHeadersForm();
  
  const formData = new FormData();
  formData.append("type", type);

  const resp = await apiFetchWithTimeout(url, {
    method: "POST",
    headers,
    body: formData,
  }, "ads");

  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`);
  }

  const data = await resp.json();
  return data;
}

