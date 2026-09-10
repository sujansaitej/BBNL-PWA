// Single source of truth for service identity used across the CRM.
//
// Background: order history (custpayhistory) returns ALL payments for
// a customer regardless of service. The legacy Android client filters
// these per-service using fields the backend includes on each order.
// We mirror that here. Until Phase 1 discovery confirms the exact
// field shape, this resolver checks every plausible field name the
// backend uses elsewhere in the API surface (servicekey/servid/
// services_app/srvtype/...) and falls back to plan-name matching only
// as a last resort.

export const SERVICES = {
  FOFI: {
    key: 'fofi',
    servid: '3',
    servicesApp: 3,
    aliases: ['fofi', 'fo-fi', 'fofi-smart-box', 'fo-fi-smart-box', 'fofi_smart_box', 'smartbox', 'smart_box', 'smart-box', 'fofibox', 'fofi_box', 'ott'],
    planNamePatterns: [/\bfo-?fi\b/i, /smart\s*box/i, /fofi\s*box/i, /\bott\b/i],
  },
  INTERNET: {
    key: 'internet',
    servid: null,
    // services_app=1 is ambiguous: Internet and IPTV wallet-debit rows can both use it.
    servicesApp: null,
    aliases: ['internet', 'broadband', 'broad band', 'fiber', 'fibre'],
    planNamePatterns: [/\binternet\b/i, /\bbroadband\b/i, /\bfiber\b/i, /\bfibre\b/i, /\bmbps\b/i],
  },
  CABLETV: {
    key: 'cabletv',
    // ServiceApis/servServiceList, read live 2026-08-31: 1=Cable TV,
    // 3=Fo-Fi Smart Box, 5=Voice Call, 7=Internet. These were left null while
    // orderApis kept its own private {fofi:'3', cabletv:'1'} map — two sources
    // of truth that already disagreed with each other. The ids live here now.
    servid: '1',
    servicesApp: null,
    aliases: ['cabletv', 'iptv', 'iptv service', 'cable_tv', 'cable-tv', 'cable tv', 'cable', 'tv', 'catv', 'dpo', 'fta'],
    planNamePatterns: [/\bcable\s*tv\b/i, /\biptv\b/i, /\bchannel\s*pack\b/i, /\bfta\b/i, /\bdpo\b/i, /free\s*to\s*air/i],
  },
  VOICE: {
    key: 'voice',
    // THE MISSING ONE. Voice orders never reached the screen because
    // getOrderHistoryFor had no servid for them and fell through to the
    // generic custpayhistory endpoint, which does not carry voice rows.
    servid: '5',
    servicesApp: null,
    aliases: ['voice', 'voice_call', 'voicecall', 'voip'],
    planNamePatterns: [/voice\s*call/i, /\bvoip\b/i],
  },
};

export function canonicalServiceKey(value) {
  const normalized = String(value || '').toLowerCase().trim();
  if (!normalized) return '';
  return ALIAS_TO_KEY.get(normalized) || normalized;
}

// Reverse lookup: any alias / servid / services_app → canonical key.
const ALIAS_TO_KEY = (() => {
  const m = new Map();
  for (const svc of Object.values(SERVICES)) {
    for (const a of svc.aliases) m.set(String(a).toLowerCase(), svc.key);
    if (svc.servid != null) m.set(`servid:${String(svc.servid)}`, svc.key);
    if (svc.servicesApp != null) m.set(`services_app:${String(svc.servicesApp)}`, svc.key);
  }
  return m;
})();

// Fields, in priority order, that may carry the service identity on an
// order item returned by /apis/custpayhistory. The first one with a
// non-empty value wins (Layer A — explicit field).
const EXPLICIT_KEY_FIELDS = [
  'servicekey', 'serv_key', 'service_key',
  'srvkey', 'srvtype', 'service_type', 'servicetype',
  'module', 'category', 'apptype', 'app_type',
  'paytype', 'pymt_type', 'serv_name', 'service_name', 'product_type',
];

// Numeric/coded fields (need scheme prefix to map). Order matters —
// servid is the most specific.
const CODED_KEY_FIELDS = [
  ['servid', 'servid'],
  ['serv_id', 'servid'],
  ['service_id', 'servid'],
  ['services_app', 'services_app'],
  ['serviceapp', 'services_app'],
];

/**
 * The backend service id for a service key, or null when it has none.
 *
 * Single source of truth for these ids — orderApis used to keep its own copy
 * and Voice was missing from it, which is what left the Voice Service order
 * history empty.
 */
export function servidForService(serviceKey) {
  const key = canonicalServiceKey(serviceKey);
  if (!key) return null;
  const svc = Object.values(SERVICES).find((s) => s.key === key);
  return svc?.servid ?? null;
}

/**
 * Determine which service an order belongs to.
 *
 * @param {object} order — one item from custpayhistory body
 * @param {object} [planIdMap] — optional { planid → serviceKey } map built
 *   from getMyPlanDetails per service. Used as Layer B when no explicit
 *   field is present.
 * @returns {string|null} canonical service key (`'fofi'`/`'internet'`/
 *   `'cabletv'`/`'voice'`) or `null` if the order cannot be classified.
 *   Callers should INCLUDE null-classified orders rather than drop them
 *   (see PaymentHistory.jsx — never silently hide a legitimate payment).
 */
export function resolveServiceFromOrder(order, planIdMap = null) {
  if (!order || typeof order !== 'object') return null;

  // Layer 0: authoritative service tag. Set by orderApis when a row comes
  // from a dedicated, server-side servid-filtered endpoint (FoFi servid=3 /
  // Cable TV servid=1). These are definitive even when the row carries no
  // recognizable servicekey/servid field or a legacy plan name, so older
  // records are never lost to client-side classification.
  const authoritative = canonicalServiceKey(order._authoritativeService);
  if (authoritative) return authoritative;

  // Layer A: explicit string field
  for (const f of EXPLICIT_KEY_FIELDS) {
    const v = order[f];
    if (v == null) continue;
    const norm = String(v).toLowerCase().trim();
    if (!norm) continue;
    const hit = ALIAS_TO_KEY.get(norm);
    if (hit) return hit;
  }

  // Layer A.5: coded field (servid / services_app)
  for (const [field, scheme] of CODED_KEY_FIELDS) {
    const v = order[field];
    if (v == null) continue;
    const norm = String(v).trim();
    if (!norm) continue;
    const hit = ALIAS_TO_KEY.get(`${scheme}:${norm}`);
    if (hit) return hit;
  }

  // Layer B: planid bridge — if caller built a {planid → serviceKey}
  // map from getMyPlanDetails per service, use it. The same plan is
  // never sold under two services so this is unambiguous.
  if (planIdMap) {
    const planId = order.planid ?? order.plan_id ?? order.priceid ?? order.price_id;
    if (planId != null) {
      const hit = planIdMap[String(planId)];
      if (hit) return hit;
    }
  }

  // Layer C: plan-name regex (last resort, deliberately permissive —
  // returns the FIRST service whose pattern matches).
  const planName = String(
    order.plan_name || order.planname || order.plan || order.serv_name ||
    order.service_name || order.product_name || order.package_name || order.packagename || ''
  ).trim();
  if (planName) {
    for (const svc of Object.values(SERVICES)) {
      if (svc.planNamePatterns.some((re) => re.test(planName))) return svc.key;
    }
  }

  return null;
}

/**
 * Filter an array of orders down to a single service. Orders that
 * cannot be classified are KEPT (better to show a stray than to hide a
 * payment the operator made). Orders classified to a DIFFERENT service
 * are dropped.
 */
export function filterOrdersByService(orders, serviceKey, planIdMap = null, options = {}) {
  if (!serviceKey || !Array.isArray(orders)) return orders || [];
  // CANONICALISE THE TARGET. resolveServiceFromOrder returns canonical keys,
  // so comparing them against a raw caller string silently matches nothing:
  // 'voicecall' — the servicekey the voice API itself uses — would never equal
  // the canonical 'voice', and every voice order would be filtered out. The
  // callers that work today happen to pass canonical keys already; this stops
  // the next one from failing silently.
  const target = canonicalServiceKey(serviceKey);
  const unclassifiedServiceKey = options.unclassifiedServiceKey
    ? canonicalServiceKey(options.unclassifiedServiceKey)
    : null;
  const keepUnclassified = options.keepUnclassified !== undefined
    ? !!options.keepUnclassified
    : true;

  return orders.filter((o) => {
    const detected = resolveServiceFromOrder(o, planIdMap);
    if (detected === target) return true;
    if (detected !== null) return false;
    if (unclassifiedServiceKey) return target === unclassifiedServiceKey;
    return keepUnclassified;
  });
}

export const SERVICE_KEYS = Object.values(SERVICES).map((s) => s.key);
