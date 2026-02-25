// API services
function getBaseUrl() {
    // return import.meta.env.VITE_API_BASE_URL;
    if (import.meta.env.PROD) return import.meta.env.VITE_API_BASE_URL; // Use this in production
    return '/api/'; // Use proxy in development
}

const API_TIMEOUT = 15000; // 15 seconds

/** Fetch with AbortController timeout — prevents indefinite hangs on slow networks */
async function apiFetchWithTimeout(url, options) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT);
    try {
        return await fetch(url, { ...options, signal: ctrl.signal });
    } catch (err) {
        if (err.name === "AbortError") throw new Error("Request timed out. Please check your network and try again.");
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
  });

  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`);
  }

  const data = await resp.json();
  return data;
}