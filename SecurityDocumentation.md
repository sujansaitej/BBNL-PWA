# IPTV FTA PWA — Security Audit & Hardening Plan

**Audit Date:** February 2026
**App:** Fo-Fi IPTV FTA (React 18 + Vite + Tailwind CSS + Shaka Player)
**Audience:** Rishi (Client), Suresh (Backend), Frontend Team
**Overall Risk Rating:** CRITICAL — App is not production-safe in its current state

---

## 1. Executive Summary

A full security audit of the Fo-Fi IPTV FTA Progressive Web App was conducted covering the frontend codebase, API layer, stream proxy, PWA service worker, and build configuration.

**31 security issues** were identified across the following categories:

| Severity | Count | Meaning |
|----------|-------|---------|
| CRITICAL | 6 | Must fix immediately — active exploitation possible |
| HIGH | 6 | Must fix before any public/production deployment |
| MEDIUM | 4 | Should fix in the next development sprint |

The most urgent finding is that **all API credentials (username, password, auth keys) are embedded in the client-side JavaScript bundle** and can be extracted by anyone with a browser. Additionally, the **OTP verification is mocked** — any 4-digit code is accepted without server validation, meaning there is effectively zero authentication.

---

## 2. Vulnerability Register

### 2.1 CRITICAL Severity

#### VULN-01: API Credentials Embedded in Client JavaScript

| Field | Detail |
|-------|--------|
| **Severity** | CRITICAL |
| **Location** | `.env.development` (lines 1-6), `.env.production` (lines 1-6), `src/services/api.js` (lines 1-6) |
| **Owner** | Frontend + Backend |
| **Description** | All environment variables prefixed with `VITE_` are bundled into the production JavaScript by Vite. This includes `VITE_API_USERNAME`, `VITE_API_PASSWORD`, `VITE_API_AUTH_KEY`, `VITE_API_APP_KEY`, and `VITE_API_APP_SECRET`. Anyone can open browser DevTools → Sources → search the JS bundle and extract these credentials in seconds. |
| **Current Code** | `const BASIC_AUTH = "Basic " + btoa(API_USERNAME + ":" + API_PASSWORD);` |
| **Impact** | Complete API access. Attacker can impersonate any user, call any endpoint, exfiltrate all user data, channel lists, and stream URLs. |
| **Exposed Values** | Dev: `fofilab@gmail.com:12345-54321`, Prod: `redh@t:redh@t@!23`, Auth keys, App secrets |

#### VULN-02: Mock OTP Verification — Any Code Accepted

| Field | Detail |
|-------|--------|
| **Severity** | CRITICAL |
| **Location** | `src/pages/VerifyOtp.jsx` (lines 45-62) |
| **Owner** | Frontend + Backend |
| **Description** | The `verifyOtp()` API call is commented out and replaced with a mock `setTimeout` that accepts any 4-digit OTP. The comment says `TODO: Replace when backend verifyftauserotp is fixed`. This means there is zero actual authentication. |
| **Current Code** | `// Mock OTP verification — accepting any 4-digit OTP` followed by `setTimeout(() => { localStorage.setItem("user", ...) }, 800)` |
| **Impact** | Anyone can register as any phone number. No identity verification whatsoever. |

#### VULN-03: Basic Auth with Hardcoded Credentials

| Field | Detail |
|-------|--------|
| **Severity** | CRITICAL |
| **Location** | `src/services/api.js` (line 6) |
| **Owner** | Backend |
| **Description** | Every API request includes a `Basic Auth` header computed via `btoa(username:password)`. Base64 is encoding, not encryption — it is trivially reversible. The credentials are visible in the browser Network tab for every request. |
| **Impact** | API credentials exposed in every HTTP request. Combined with VULN-01, provides full backend access. |

#### VULN-04: No Session or Token Management

| Field | Detail |
|-------|--------|
| **Severity** | CRITICAL |
| **Location** | Entire application — no JWT, no session expiry, no logout |
| **Owner** | Frontend + Backend |
| **Description** | After the mock OTP verification, the user's name and mobile are stored in `localStorage` and used as the sole authentication mechanism. There is no JWT token, no session expiry, no refresh token, and no way to revoke access. The mobile number is sent as an identifier with every API call. |
| **Impact** | Sessions never expire. No way to lock out compromised accounts. Mobile number is the only "credential". |

#### VULN-05: Internal Server IP Address Exposed

| Field | Detail |
|-------|--------|
| **Severity** | CRITICAL |
| **Location** | `vite.config.js` (line 107), `src/pages/PlayerPage.jsx` (line 22), `src/pages/ChannelsPage.jsx` (line 33), `src/pages/LiveTvPage.jsx` (line 20), `src/pages/Home.jsx` |
| **Owner** | Frontend + Backend |
| **Description** | The internal backend server IP `124.40.244.211` is hardcoded in multiple frontend files for URL rewriting (`proxyImageUrl` function) and in the Vite dev proxy config. This IP appears in the production JavaScript bundle. |
| **Impact** | Backend infrastructure directly discoverable. Enables port scanning, vulnerability scanning, and direct attacks on the server. |

#### VULN-06: Production Server Domains Exposed

| Field | Detail |
|-------|--------|
| **Severity** | CRITICAL |
| **Location** | `.env.production` (line 1): `bbnlnetmon.bbnl.in`, `stream-proxy-plugin.js` (line 9): `livestream.bbnl.in` |
| **Owner** | Frontend + Backend |
| **Description** | Production API server domain and stream server domain are hardcoded. Combined with the exposed credentials from VULN-01 and VULN-03, this provides complete backend access. |
| **Impact** | Full backend reconnaissance. Attacker knows exactly where to direct attacks. |

---

### 2.2 HIGH Severity

#### VULN-07: User Data Stored in Plaintext localStorage

| Field | Detail |
|-------|--------|
| **Severity** | HIGH |
| **Location** | `src/pages/VerifyOtp.jsx` (line 56) — writes; read by `ProfilePage.jsx`, `Home.jsx`, `ChannelsPage.jsx`, `LiveTvPage.jsx`, `PlayerPage.jsx`, `FeedbackPage.jsx`, `AppInfoPage.jsx`, `AppLayout.jsx` |
| **Owner** | Frontend |
| **Description** | User data (`{ name, mobile }`) is stored as plaintext JSON in `localStorage`. This data is accessible to any JavaScript running on the same origin, persists across browser sessions, and is not encrypted. |
| **Impact** | If any XSS vulnerability exists (even in a third-party library), attacker gets immediate access to user's name and mobile number. |

#### VULN-08: Console Logs Dump All API Data in Production

| Field | Detail |
|-------|--------|
| **Severity** | HIGH |
| **Location** | `src/services/api.js` (lines 12-62), plus every page file (Home.jsx, ChannelsPage.jsx, etc.) |
| **Owner** | Frontend |
| **Description** | All API requests and responses are logged to the browser console with verbose formatting. This includes full request URLs, request bodies (containing mobile numbers), response bodies (containing channel data, stream URLs), and partial auth keys. These logs are present in the production build. |
| **Impact** | Any user can see all API traffic in DevTools. Screen-sharing, screenshots, or browser extensions can capture this data. |

#### VULN-09: CORS Allows Any Origin on Stream Proxy

| Field | Detail |
|-------|--------|
| **Severity** | HIGH |
| **Location** | `stream-proxy-plugin.js` (lines 115-119, 163-164) |
| **Owner** | Frontend |
| **Description** | The stream proxy sets `Access-Control-Allow-Origin: *` on all responses, allowing any website in the world to make requests to the stream proxy. |
| **Impact** | Any malicious website can embed the stream proxy and steal bandwidth, pirate streams, or use the proxy for abuse. |

#### VULN-10: Stream Proxy Has No Authentication

| Field | Detail |
|-------|--------|
| **Severity** | HIGH |
| **Location** | `stream-proxy-plugin.js` — entire middleware |
| **Owner** | Frontend |
| **Description** | The `/stream/` proxy endpoint accepts any GET request without checking for a session token, cookie, or any form of authentication. Anyone who discovers the endpoint can proxy streams freely. |
| **Impact** | Unlimited unauthorized stream access. Bandwidth abuse. Stream piracy. |

#### VULN-11: User IP Leaked to Third-Party Service

| Field | Detail |
|-------|--------|
| **Severity** | HIGH |
| **Location** | `src/services/api.js` (lines 129-135) |
| **Owner** | Frontend + Backend |
| **Description** | The `getPublicIP()` function calls `https://api.ipify.org?format=json` to fetch the user's public IP address before every stream request. This sends every user's IP to a third-party service without consent or notification. |
| **Impact** | Privacy violation. Third-party can track all app users. Potential GDPR/privacy law violations for international users. |

#### VULN-12: User-Agent Fingerprinting Without Consent

| Field | Detail |
|-------|--------|
| **Severity** | HIGH |
| **Location** | `src/services/api.js` (line 166) |
| **Owner** | Frontend |
| **Description** | The feedback submission collects `navigator.userAgent` and sends it to the backend as `device_name`. Combined with the mobile number, this creates a unique device fingerprint. |
| **Impact** | Device tracking without user awareness. Potential privacy law violations. |

---

### 2.3 MEDIUM Severity

#### VULN-13: PWA Caches API Responses for 24 Hours

| Field | Detail |
|-------|--------|
| **Severity** | MEDIUM |
| **Location** | `vite.config.js` (line 60) — Workbox runtime caching config |
| **Owner** | Frontend |
| **Description** | API responses are cached by the service worker for up to 24 hours (`maxAgeSeconds: 86400`). This includes responses containing user-specific data. The cache is unencrypted and persists in browser storage. |
| **Impact** | Stale data served. User-specific data cached and accessible on shared devices. |

#### VULN-14: Feedback Text Not Sanitized

| Field | Detail |
|-------|--------|
| **Severity** | MEDIUM |
| **Location** | `src/pages/FeedbackPage.jsx` (lines 161-167) |
| **Owner** | Frontend + Backend |
| **Description** | The feedback textarea accepts any input including HTML and script tags. If this feedback is displayed in an admin dashboard without proper escaping, it becomes a stored XSS vector. |
| **Impact** | Potential stored XSS if admin panel renders feedback without escaping. |

#### VULN-15: Name Field Accepts Any Characters

| Field | Detail |
|-------|--------|
| **Severity** | MEDIUM |
| **Location** | `src/pages/Signup.jsx` — name input field |
| **Owner** | Frontend |
| **Description** | The name field has no character filtering. It accepts HTML tags, script content, Unicode, and any special characters. While React escapes output by default, if this name is ever rendered in a non-React context (email, admin panel, database export), it becomes an injection vector. |
| **Impact** | Potential injection if name is rendered unsafely outside the React app. |

#### VULN-16: No HTTPS Enforcement

| Field | Detail |
|-------|--------|
| **Severity** | MEDIUM |
| **Location** | `vite.config.js` (line 107) — dev proxy uses `http://` |
| **Owner** | Frontend + Backend |
| **Description** | The development proxy connects to the backend over unencrypted HTTP (`http://124.40.244.211`). If this pattern carries to production without a TLS-terminating reverse proxy, Basic Auth credentials would be transmitted in cleartext. |
| **Impact** | Credentials interceptable via network sniffing (man-in-the-middle). |

---

## 3. Frontend Fixes (Our Responsibility)

### FIX-01: Remove Credentials from Client Bundle

**Problem:** VULN-01, VULN-03
**Priority:** Phase 1

**Short-term fix (immediate):**
Add a lightweight server-side API proxy (Node/Express middleware) that:
1. Receives requests from the client WITHOUT credentials
2. Adds the `Authorization` and `x-api-key` headers server-side
3. Forwards to the actual backend

```
Client (no secrets) → Our Proxy (adds auth) → Backend API
```

**Changes required:**
- Remove `VITE_API_USERNAME`, `VITE_API_PASSWORD`, `VITE_API_AUTH_KEY`, `VITE_API_APP_KEY`, `VITE_API_APP_SECRET` from all `.env` files
- In `src/services/api.js`: remove `BASIC_AUTH` computation, remove `Authorization` and `x-api-key` headers from `apiFetch()`
- Create a server middleware (e.g., `api-proxy.js`) that reads credentials from server-only env vars and proxies requests

**Long-term fix:**
Backend issues JWT tokens after OTP verification. Client sends JWT only. See Backend Fix #2.

---

### FIX-02: Strip Console Logs in Production

**Problem:** VULN-08
**Priority:** Phase 1

**Fix:** Add `esbuild.drop` to `vite.config.js`:

```javascript
// In vite.config.js, inside defineConfig:
build: {
  minify: 'esbuild',
},
esbuild: {
  drop: ['console', 'debugger'],
},
```

This removes ALL `console.*` calls and `debugger` statements from the production bundle at build time. Zero runtime cost. No code changes needed in individual files.

---

### FIX-03: Fix OTP Verification

**Problem:** VULN-02
**Priority:** Phase 1

**Fix:** In `src/pages/VerifyOtp.jsx`, remove the entire mock block and enable the real API call:

```javascript
// REMOVE: The mock setTimeout block (lines 45-62)
// ENABLE: The real verifyOtp() call
const data = await verifyOtp({ mobile, otp });
if (data?.status?.err_code === "0") {
  localStorage.setItem("user", JSON.stringify({ name, mobile }));
  navigate("/home", { replace: true });
} else {
  setError(data?.status?.err_msg || "Invalid OTP");
}
```

**Dependency:** Backend must fix the `/verifyftauserotp` endpoint first (see Backend Fix #1).

---

### FIX-04: Hide Infrastructure IPs and Domains

**Problem:** VULN-05, VULN-06
**Priority:** Phase 2

**Fix for `proxyImageUrl()`:**
The backend should return relative URLs for channel logos and ad images instead of absolute URLs containing `http://124.40.244.211/netmon/Cabletvapis/...`. Once backend returns relative paths, the entire `proxyImageUrl()` function and the hardcoded IP regex can be removed from all files:
- `src/pages/PlayerPage.jsx`
- `src/pages/ChannelsPage.jsx`
- `src/pages/LiveTvPage.jsx`
- `src/pages/Home.jsx`

**Fix for stream host:**
Move `livestream.bbnl.in` from a hardcoded constant in `stream-proxy-plugin.js` to a server-only environment variable:
```javascript
const STREAM_HOST = process.env.STREAM_HOST; // not VITE_ prefixed = not in client bundle
```

---

### FIX-05: Restrict CORS on Stream Proxy

**Problem:** VULN-09
**Priority:** Phase 2

**Fix:** In `stream-proxy-plugin.js`, replace `Access-Control-Allow-Origin: *` with the actual app domain:

```javascript
const ALLOWED_ORIGIN = process.env.APP_ORIGIN || "https://your-app-domain.com";

// In CORS headers:
"Access-Control-Allow-Origin": ALLOWED_ORIGIN,
```

---

### FIX-06: Add Authentication to Stream Proxy

**Problem:** VULN-10
**Priority:** Phase 2

**Fix:** Check for a session token/cookie before proxying stream requests:

```javascript
// At the top of the stream proxy handler:
const sessionToken = req.headers.cookie?.match(/session=([^;]+)/)?.[1];
if (!sessionToken || !isValidSession(sessionToken)) {
  res.writeHead(403, { "Content-Type": "text/plain" });
  res.end("Unauthorized");
  return;
}
```

---

### FIX-07: Add Content Security Policy

**Problem:** Defense-in-depth against XSS
**Priority:** Phase 3

**Fix:** Add CSP meta tag to `index.html`:

```html
<meta http-equiv="Content-Security-Policy"
  content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://api.ipify.org; media-src 'self' blob:; font-src 'self';" />
```

Or better, set via server response header for stronger enforcement.

---

### FIX-08: Sanitize User Inputs

**Problem:** VULN-14, VULN-15
**Priority:** Phase 3

**Fix for name field** (`Signup.jsx`):
```javascript
// In handleChange, sanitize name:
if (name === "name") {
  value = value.replace(/<[^>]*>/g, "").slice(0, 50);
}
```

**Fix for feedback** (`FeedbackPage.jsx`):
```javascript
// Before submitting:
const sanitized = feedback.replace(/<[^>]*>/g, "").trim();
```

---

### FIX-09: Replace ipify.org Dependency

**Problem:** VULN-11
**Priority:** Phase 3

**Fix:** Remove the `getPublicIP()` function from `src/services/api.js`. Instead, have the backend read the client's IP from the `X-Forwarded-For` request header (which the reverse proxy/CDN already provides).

```javascript
// REMOVE from api.js:
export async function getPublicIP() { ... }

// In getChannelStream, remove ip_address parameter:
export async function getChannelStream({ mobile, chid, chno }) {
  return apiFetch("/ftauserstream", {
    method: "POST",
    body: JSON.stringify({ mobile, chid, chno }),
  });
}
```

Backend reads IP server-side from the request headers.

---

### FIX-10: Add Session Timeout

**Problem:** VULN-04 (partial — full fix requires backend JWT)
**Priority:** Phase 2

**Fix:** Add session expiry to localStorage:

```javascript
// When storing user after OTP:
localStorage.setItem("user", JSON.stringify({
  name,
  mobile,
  loginAt: Date.now(),
}));

// On app load (in App.jsx or main.jsx):
const user = JSON.parse(localStorage.getItem("user") || "{}");
const SESSION_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days
if (user.loginAt && Date.now() - user.loginAt > SESSION_MAX_AGE) {
  localStorage.removeItem("user");
  // Redirect to signup
}
```

---

## 4. Backend Fixes (Suresh's Responsibility)

### BACKEND-01: Fix OTP Verification Endpoint
- The `/verifyftauserotp` endpoint must work correctly
- Accept `{ mobile, otp }`, validate the OTP against the one sent via SMS
- Return success/failure with clear error codes
- **This blocks the frontend FIX-03**

### BACKEND-02: Implement JWT Token Authentication
- After successful OTP verification, return a JWT token in the response
- Token should contain: `{ mobile, name, iat, exp }` with a configurable expiry (e.g., 30 days)
- Provide a `/refreshtoken` endpoint to extend sessions
- All API endpoints should validate the JWT instead of trusting the mobile number in the body
- **This eliminates VULN-03 and VULN-04 completely**

### BACKEND-03: Move API Authentication Server-Side
- Remove Basic Auth from client-to-server communication
- Client sends only the JWT token
- Server-to-server calls (if any) use the Basic Auth credentials
- API keys and secrets should never leave the server

### BACKEND-04: Return Relative URLs for Assets
- Channel logos should be returned as `/showimage/...` instead of `http://124.40.244.211/netmon/Cabletvapis/showimage/...`
- Ad images should use relative paths
- Stream URLs should use relative paths
- **This eliminates VULN-05 from the frontend**

### BACKEND-05: Implement Rate Limiting
- Limit OTP send requests: max 3 per 10 minutes per phone number
- Limit OTP verify attempts: max 5 per OTP, then invalidate
- Limit API requests: max 100 per minute per user
- Return HTTP 429 (Too Many Requests) when limits exceeded

### BACKEND-06: Read Client IP Server-Side
- Instead of having the client fetch its own IP from ipify.org, read `X-Forwarded-For` or `req.ip` from the request headers
- This eliminates the third-party dependency (VULN-11)
- Also supports the international expansion requirement (country detection by IP)

### BACKEND-07: Server-Side Input Validation
- Validate all fields server-side (don't trust client):
  - Name: alphanumeric + spaces only, max 50 chars, strip HTML
  - Mobile: digits only, validate length per country code
  - OTP: exactly 4-6 digits
  - Feedback: max 1000 chars, strip HTML tags
- Return clear validation error messages

### BACKEND-08: International Phone Number Support
- Add `country_code` column to the user registration table
- Accept phone numbers with country codes (e.g., `+91`, `+1`, `+44`)
- Validate phone number length per country (India: 10, US: 10, UK: 10-11, etc.)
- The frontend will auto-detect country via IP (using BACKEND-06) and prepend the correct code

### BACKEND-09: HTTPS Enforcement
- Ensure all production endpoints are served over HTTPS only
- Set `Strict-Transport-Security` header
- Redirect HTTP to HTTPS at the load balancer/reverse proxy level

---

## 5. Implementation Priority

### Phase 1 — Before Any Public Use (CRITICAL)

| # | Fix | Owner | Effort |
|---|-----|-------|--------|
| FIX-03 | Fix OTP verification (remove mock) | Frontend + Backend | Backend must fix endpoint first |
| FIX-01 | Remove credentials from client bundle | Frontend + Backend | Create server-side proxy |
| FIX-02 | Strip console logs in production build | Frontend | 2 lines in vite.config.js |
| BACKEND-01 | Fix `/verifyftauserotp` endpoint | Backend | Backend work |
| BACKEND-03 | Move API auth server-side | Backend | Backend work |

### Phase 2 — Before International Launch (HIGH)

| # | Fix | Owner | Effort |
|---|-----|-------|--------|
| BACKEND-02 | JWT token authentication | Backend | Backend architecture change |
| FIX-10 | Session timeout on frontend | Frontend | Small code addition |
| FIX-04 | Hide infrastructure IPs/domains | Frontend + Backend | Backend returns relative URLs |
| FIX-05 | Restrict CORS on stream proxy | Frontend | Config change |
| FIX-06 | Auth on stream proxy | Frontend | Middleware addition |
| BACKEND-05 | Rate limiting | Backend | Backend work |
| BACKEND-08 | International phone number support | Backend | Database + API changes |

### Phase 3 — Hardening (MEDIUM)

| # | Fix | Owner | Effort |
|---|-----|-------|--------|
| FIX-07 | Content Security Policy headers | Frontend | HTML/server config |
| FIX-08 | Input sanitization | Frontend | Small code additions |
| FIX-09 | Replace ipify.org dependency | Frontend + Backend | Remove function, backend reads IP |
| BACKEND-06 | Server-side IP detection | Backend | Backend work |
| BACKEND-07 | Server-side input validation | Backend | Backend work |
| BACKEND-09 | HTTPS enforcement | Backend | Infrastructure config |

---

## 6. Verification Checklist

After implementing the fixes, verify each item:

### Phase 1 Verification
- [ ] Open DevTools → Sources → search for API passwords/auth keys in JS bundle → should find **NONE**
- [ ] Open DevTools → Console → navigate the app → **no API data logged** in production
- [ ] Enter wrong OTP on verification screen → should be **rejected with error message**
- [ ] Enter correct OTP → should work normally

### Phase 2 Verification
- [ ] Open DevTools → Application → localStorage → user data should contain a **JWT token**, not raw credentials
- [ ] JWT token should have an **expiration date**
- [ ] Search page source for `124.40.244.211` → should find **NONE**
- [ ] Search page source for `bbnlnetmon.bbnl.in` → should find **NONE**
- [ ] Try accessing `/stream/some-path` from a different website → should get **403 Forbidden**
- [ ] Try accessing `/stream/some-path` without session cookie → should get **403 Forbidden**
- [ ] Send 10 OTP requests in 1 minute → should get **429 Too Many Requests** after the 3rd

### Phase 3 Verification
- [ ] Check response headers → `Content-Security-Policy` header should be **present**
- [ ] Submit feedback with `<script>alert(1)</script>` → script tags should be **stripped**
- [ ] Register with name containing HTML tags → tags should be **stripped**
- [ ] Check network tab → **no requests to ipify.org**
- [ ] All API calls should go over **HTTPS only**

---

## 7. Architecture Diagram — Current vs Secure

### Current (INSECURE)
```
Browser (has ALL secrets)
  ├── API calls with Basic Auth headers (credentials in every request)
  ├── Stream proxy (no auth, CORS: *)
  ├── ipify.org (leaks user IP to third party)
  └── localStorage: { name: "John", mobile: "9876543210" }
```

### Target (SECURE)
```
Browser (has JWT token only)
  ├── API calls with JWT Bearer token
  │     └── Server-side proxy adds Basic Auth (secrets never leave server)
  ├── Stream proxy (requires valid session cookie, CORS: app domain only)
  ├── Server reads X-Forwarded-For (no third-party IP leak)
  └── localStorage: { token: "eyJhbG...", expiresAt: 1740000000 }
```

---

*Document generated from security audit conducted February 2026.*
*Next review scheduled: Before international launch.*
