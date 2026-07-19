/**
 * transport-smoke — READ-ONLY probe of the PWA's TRANSPORT prerequisites.
 *
 * Usage:  node tools/transport-smoke.cjs
 *         node tools/transport-smoke.cjs --json
 *
 * WHY THIS EXISTS (different job from contract-smoke.cjs)
 * ------------------------------------------------------
 * contract-smoke asks "does the backend return the shape we expect?".
 * This asks the question that broke Data Usage: "can a BROWSER even reach
 * this endpoint from our origin?" — which is invisible to unit tests and to
 * the Android app, because native HTTP has no CORS and no mixed-content rule.
 *
 * Three failure modes it detects, none of which a contract test can see:
 *   1. A same-origin proxy path we depend on is not configured in production
 *      (returns the PWA host's own Apache 404 instead of the upstream).
 *   2. A cross-origin host does not send Access-Control-Allow-Origin, so the
 *      browser blocks the response even though curl sees a 200.
 *   3. An upstream sends a STATIC ACAO for someone else's origin — which
 *      looks like working CORS until you check the value.
 *
 * SAFETY — READ-ONLY. Nothing here debits a wallet, creates an order, or
 * mutates state. The Easebuzz probe is a bare GET on initiateLink, which the
 * gateway rejects with 400 before any transaction exists. Do NOT add a POST
 * with real payment params to this file.
 */

const JSON_OUT = process.argv.includes("--json");

const PWA_ORIGIN = "https://bbnlnetmon.bbnl.in";
// Proxy seams live UNDER the app base so they route like the app itself
// (see easebuzz.getInitiateUrl / serviceHome.DATA_USAGE_URL). Probing the
// ROOT-relative path instead would report a false failure.
const APP_PATH = "/smartphone/crm/";
const PWA_BASE = `${PWA_ORIGIN}${APP_PATH}`;
const TIMEOUT_MS = 25000;

const results = [];
const c = {
  reset: "\x1b[0m", red: "\x1b[31m", green: "\x1b[32m",
  yellow: "\x1b[33m", dim: "\x1b[2m", bold: "\x1b[1m",
};

function record(r) {
  results.push(r);
  if (JSON_OUT) return;
  const tag = r.status === "PASS" ? `${c.green}PASS${c.reset}`
    : r.status === "FAIL" ? `${c.red}FAIL${c.reset}`
    : r.status === "EXPECTED" ? `${c.dim}EXPECTED${c.reset}`
    : `${c.yellow}WARN${c.reset}`;
  console.log(`  [${tag}] ${r.name}`);
  console.log(`         ${c.dim}${r.detail}${c.reset}`);
  if (r.affects) console.log(`         ${c.dim}affects: ${r.affects}${c.reset}`);
}

async function req(url, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(url, { ...opts, redirect: "manual", signal: ctrl.signal });
    const text = await resp.text().catch(() => "");
    return { ok: true, status: resp.status, headers: resp.headers, text };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A proxied path must NOT be answered by the PWA's own Apache. That server
 * identifies itself distinctively, so we can tell "proxy missing" apart from
 * "upstream returned 404" — which a bare status code cannot.
 */
function servedByPwaHost(headers) {
  const server = (headers.get("server") || "").toLowerCase();
  return server.includes("apache") && !!headers.get("set-cookie")?.includes("SERVERUSED");
}

/**
 * Because these paths sit UNDER the app base, an unconfigured proxy does NOT
 * 404 — the SPA rewrite serves index.html with HTTP 200. So a bare status
 * check reports a false PASS. The reliable signal is the response BODY: HTML
 * means we got the app shell instead of the gateway's JSON.
 * (PAYMENT-PROXY-REQUEST.txt §8 documents exactly this.)
 */
async function checkProxyPath({ name, path, affects, upstreamNote }) {
  const r = await req(`${PWA_ORIGIN}${path}`);
  if (!r.ok) {
    return record({ name, status: "FAIL", affects, detail: `request failed: ${r.error}` });
  }

  const ctype = (r.headers.get("content-type") || "").toLowerCase();
  const looksLikeSpaShell = ctype.includes("text/html") || /^\s*<!doctype html|^\s*<html/i.test(r.text);

  if (looksLikeSpaShell) {
    return record({
      name, status: "FAIL", affects,
      detail: `HTTP ${r.status} but the body is the SPA shell (HTML), not the upstream — `
        + `reverse proxy NOT configured. Add the rule for ${path} `
        + `(see PAYMENT-PROXY-REQUEST.txt §6/§7). ${upstreamNote || ""}`,
    });
  }
  if (servedByPwaHost(r.headers) && r.status === 404) {
    return record({
      name, status: "FAIL", affects,
      detail: `HTTP 404 from the PWA host's OWN Apache — reverse proxy NOT configured. ${upstreamNote || ""}`,
    });
  }
  return record({
    name, status: "PASS", affects,
    detail: `HTTP ${r.status}, content-type ${ctype || "?"} — reached the upstream, proxy is live.`,
  });
}

/**
 * `expectBlocked: true` marks a check whose failure is the DOCUMENTED REASON a
 * proxy exists. It still prints, so the evidence stays visible, but it is not
 * an action item and does not fail the run — otherwise the signal that matters
 * (a proxy actually missing) gets lost in permanent red.
 */
async function checkCors({ name, url, method = "GET", body, headers = {}, affects, expectBlocked = false }) {
  const bad = expectBlocked ? "EXPECTED" : "FAIL";
  const r = await req(url, { method, body, headers: { ...headers, Origin: PWA_ORIGIN } });
  if (!r.ok) return record({ name, status: bad, affects, detail: `request failed: ${r.error}` });

  const acao = r.headers.get("access-control-allow-origin");
  if (!acao) {
    return record({
      name, status: bad, affects,
      detail: `HTTP ${r.status} but NO Access-Control-Allow-Origin header. `
        + `curl succeeds; a browser blocks reading this response.`
        + (r.status === 403 || r.status === 404
          ? ` (Probed a directory/miss — pass a real asset path for a 200-response check.)`
          : ""),
    });
  }
  if (acao !== "*" && acao !== PWA_ORIGIN) {
    return record({
      name, status: bad, affects,
      detail: `ACAO is "${acao}" — a STATIC value for a different origin, not ours (${PWA_ORIGIN}). `
        + `Browsers from our origin are blocked. Must be proxied same-origin.`,
    });
  }
  return record({ name, status: "PASS", affects, detail: `ACAO: ${acao} — readable from our origin.` });
}

(async () => {
  if (!JSON_OUT) {
    console.log(`\n${c.bold}transport-smoke${c.reset} — can a browser at ${PWA_ORIGIN} reach these?\n`);
    console.log(`${c.dim}Read-only. Detects CORS + missing-proxy failures that unit tests cannot see.${c.reset}\n`);
    console.log(`${c.bold}── Same-origin proxy paths (must exist in production) ──${c.reset}`);
  }

  await checkProxyPath({
    name: `${APP_PATH}usage-api → payurbills.co.in/best2/General/`,
    path: `${APP_PATH}usage-api/overallAvgUsageReport/`,
    affects: "Customer Data Usage report (/cust/internet/usage)",
    upstreamNote: "Until then the screen shows 'Network error: Failed to fetch'.",
  });

  await checkProxyPath({
    name: `${APP_PATH}ezpay-prod → pay.easebuzz.in`,
    path: `${APP_PATH}ezpay-prod/payment/initiateLink`,
    affects: "ALL Easebuzz payment initiation (customer renew/upgrade/pay-bill)",
    upstreamNote: "Payments cannot obtain an access_key while this is missing.",
  });

  if (!JSON_OUT) console.log(`\n${c.bold}── Cross-origin hosts (need CORS headers) ──${c.reset}`);

  // The upstream behind /usage-api. Proves WHY the proxy is required.
  await checkCors({
    name: "payurbills.co.in (direct, unproxied)",
    url: "https://payurbills.co.in/best2/General/overallAvgUsageReport/",
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "apiopid=&apiuserid=&fromdt=1-7-2026&todt=1-7-2026",
    affects: "Data Usage — this is why DATA_USAGE_URL must stay a relative path",
    expectBlocked: true,   // blocked BY DESIGN; the /usage-api proxy is the fix
  });

  await checkCors({
    name: "cdn1.bbnl.in (channel logos)",
    url: "https://cdn1.bbnl.in/cable/",
    affects: "Logo prefetch/offline cache (logoCache.js, iptvPrefetch.js). "
      + "Logos still DISPLAY via native <img>; only caching is dead.",
  });

  if (!JSON_OUT) console.log(`\n${c.bold}── App reachability ──${c.reset}`);

  const app = await req(PWA_BASE);
  record({
    name: "PWA app root",
    status: app.ok && app.status === 200 ? "PASS" : "FAIL",
    detail: app.ok ? `HTTP ${app.status}` : `unreachable: ${app.error}`,
    affects: "everything",
  });

  const failed = results.filter((r) => r.status === "FAIL");
  if (JSON_OUT) {
    console.log(JSON.stringify({ results, failed: failed.length }, null, 2));
  } else {
    console.log(`\n${c.bold}── Summary ──${c.reset}`);
    console.log(`  ${results.length} checks, ${failed.length} failing\n`);
    for (const f of failed) console.log(`  ${c.red}✗${c.reset} ${f.name}\n    ${c.dim}${f.affects}${c.reset}`);
    console.log("");
  }
  process.exit(failed.length ? 1 : 0);
})();
