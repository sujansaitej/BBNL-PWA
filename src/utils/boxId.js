/**
 * boxId.js — Shared cabletv / FoFi box-ID extraction (SINGLE SOURCE OF TRUTH).
 *
 * Different backend user-state classifications nest the same box under
 * different servkey buckets (fofi / multi / voip / internet). The IPTV
 * service page, the FoFi Smart Box page, AND the prefetch warm-up all
 * resolve the box ID through the helpers here so they can never disagree
 * on whether a customer actually has a box.
 *
 * IMPORTANT: box identity is decided ONLY by `extractBoxFromItem` below.
 * There is deliberately NO "any non-empty field" fallback — a plain
 * cabletv smartcard / STB identifier that carries no BBNL/FoFi marker is
 * NOT a FoFi box. A previous loose fallback here caused cabletv-only
 * customers to show a phantom "FoFi Box ID" on the Cable TV overview
 * while the FoFi Smart Box page (which never had that fallback) correctly
 * showed "not opted". Keep this the one place the decision is made.
 */

const _BBNL_BOX_RE = /^(bbnl[-_]andbox[-_]|BBNL[-_]ANDBOX[-_])/i;

/**
 * Does this box id belong to a real FoFi Android box (vs a unicast/ATV device)?
 *
 * Mirrors the backend's chk__fofiboxid gate EXACTLY
 * (CustomerRegistrationValidations.php: substr($boxid,0,11) must equal
 * 'AUG-ANDBOX-' or 'BBNL-ANDBOX'). ServiceApis/upgradeRegistration rejects any
 * other id — notably a unicast/ATV device whose id is 'TV-<hash>' — with
 * "Wrong Fofi box ID!". Verified live that the SAME 'TV-' id is accepted by the
 * cabletv endpoints, so an ATV device must be subscribed via the Cable TV flow,
 * not the FoFi upgrade-registration flow.
 * @param {string} id
 * @returns {boolean}
 */
export function isFofiAndroidBoxId(id) {
    const prefix = String(id || '').slice(0, 11);
    return prefix === 'AUG-ANDBOX-' || prefix === 'BBNL-ANDBOX';
}
const _FOFI_BOX_RE = /\b(fofi|fo-fi|smart\s*box|smartbox|fofibox|fofi[_-]?box|fta)\b/i;

function firstTrimmedValue(...values) {
    for (const value of values) {
        if (value == null) continue;
        const text = String(value).trim();
        if (text) return text;
    }
    return '';
}

const LINKED_TV_TYPES = [
    { key: 'android', label: 'Android TV', pattern: /\bandroid\s*tv\b|\batv\b|\bandroid\b/i },
    { key: 'samsung', label: 'Samsung TV', pattern: /\bsamsung\s*tv\b|\bsamsung\b|\btizen\b/i },
    { key: 'lg', label: 'LG TV', pattern: /\blg\s*tv\b|\blg\b|\bwebos\b|\bweb\s*os\b/i },
];

/**
 * Recognise a linked TV (Android / Samsung / LG) by its service/device-type
 * fields. These devices don't carry a BBNL-format box ID, so they need a
 * dedicated identity check instead of a blind field fallback.
 */
export function detectLinkedTvType(row) {
    const searchable = [
        row?.device_type,
        row?.devicetype,
        row?.deviceType,
        row?.device_model,
        row?.deviceModel,
        row?.model,
        row?.make,
        row?.brand,
        row?.platform,
        row?.os,
        row?.ostype,
        row?.app_type,
        row?.apptype,
        row?.serv_name,
        row?.service_name,
        row?.servicename,
        row?.product_name,
        row?.itemname,
        row?.item_name,
        row?.planname,
        row?.plan_name,
        row?.title,
        row?.type,
    ].map(firstTrimmedValue).join(' ');

    return LINKED_TV_TYPES.find((type) => type.pattern.test(searchable)) || null;
}

export function getLinkedTvIdentifier(row) {
    return firstTrimmedValue(
        row?.deviceid,
        row?.device_id,
        row?.deviceId,
        row?.itemid,
        row?.item_id,
        row?.stbid,
        row?.stb_id,
        row?.boxid,
        row?.box_id,
        row?.fofiboxid,
        row?.fofi_box_id,
        row?.serialno,
        row?.serial_no,
        row?.serial_number,
        row?.fserialno,
        row?.fofiserailnumber,
        row?.mac,
        row?.macid,
        row?.mac_addr,
        row?.macAddress,
        row?.mac_address
    );
}

/**
 * Decide whether a single assigned-items row represents a real box, and if
 * so return `{ boxId, source, item, tvType? }`. Returns `null` when the row
 * is NOT a box (e.g. a bare cabletv smartcard with no BBNL/FoFi marker).
 *
 * Acceptance order:
 *   1. BBNL-formatted ID (bbnl-andbox-…)
 *   2. Value whose text explicitly indicates FoFi / SmartBox / FTA identity
 *   3. Deep scan of every string field for a BBNL pattern
 *   4. Recognised linked-TV device (Android / Samsung / LG)
 * No unconditional fallback — anything else is "not a box".
 */
export function extractBoxFromItem(item) {
    if (!item || typeof item !== 'object') return null;

    // Primary box ID fields
    const candidates = [
        item.fofiboxid, item.fofi_box_id, item.boxid, item.box_id,
        item.stbid, item.stb_id, item.device_id, item.itemid,
        item.product_name, item.boxId, item.fofiBoxId,
    ].map(v => (v == null ? '' : String(v).trim())).filter(Boolean);

    // Look for BBNL/FOFI formatted box IDs first
    let bbnlMatch = candidates.find(v => _BBNL_BOX_RE.test(v));
    if (bbnlMatch) return { boxId: bbnlMatch, source: 'bbnl-pattern', item };

    // Look for values that explicitly indicate FoFi/SmartBox identity.
    let fofiMatch = candidates.find(v => _FOFI_BOX_RE.test(v) && v.length > 3);
    if (fofiMatch) return { boxId: fofiMatch, source: 'fofi-pattern', item };

    // A FoFi box is often registered against a plain hex/MAC identifier that
    // carries NO textual marker (e.g. "842034bc05a8b9b3"). It is still
    // unambiguously a FoFi box because the row carries a fofi-specific SERIAL
    // field — `fserialno` / `fofiserailnumber` (the leading "f" = fofi) — which
    // a bare cabletv smartcard/STB row does NOT have. Keying on that structural
    // field (not an "any non-empty value" fallback) identifies the box without
    // reintroducing the phantom-cable-box bug the file header warns about.
    // Verified in production: the FTA-only box's getUserAssignedItems(fofi) row
    // (`{ fserialno, mac, product_name, primarybox: 'yes' }`) feeds
    // getMyPlanDetails(fofi), which returns the subscribed FoFi plan.
    const fofiSerial = firstTrimmedValue(item.fserialno, item.fofiserailnumber, item.fserial_no, item.fofi_serial_no);
    if (fofiSerial) return { boxId: fofiSerial, source: 'fofi-serial', item };

    // Deep scan: check all string values in the item for BBNL pattern
    for (const [key, val] of Object.entries(item)) {
        if (typeof val === 'string') {
            const trimmed = val.trim();
            if (_BBNL_BOX_RE.test(trimmed)) {
                return { boxId: trimmed, source: `deep-scan:${key}`, item };
            }
        }
    }

    // TV-linked devices (Android TV, Samsung TV, LG TV) use device/MAC
    // identifiers that don't carry BBNL-format IDs. detectLinkedTvType
    // recognises them by service/device-type fields; we fall back to
    // getLinkedTvIdentifier to get their display ID.
    const tvType = detectLinkedTvType(item);
    if (tvType) {
        const tvId = getLinkedTvIdentifier(item);
        if (tvId) return { boxId: tvId, source: `tv-device:${tvType.key}`, item, tvType };
    }

    return null;
}

/**
 * Extract a box ID from a single getUserAssignedItems response.
 * Walks every servkey bucket (fofi → multi → voip → internet) in
 * precedence order and returns the first row that `extractBoxFromItem`
 * accepts as a genuine box. Mirrors FoFiSmartBox's deriveFofiOverviewFromAssigned
 * exactly so the two pages always agree.
 * @param {object} resp    Raw response ({ body: { fofi, multi, voip, internet } }).
 * @param {string} userid  Current customer id (kept for API compatibility).
 * @returns {string} The resolved box ID, or "" when none found.
 */
export function extractBoxIdFromAssigned(resp, userid) {
    const body = resp?.body || {};
    for (const bucket of [body.fofi, body.multi, body.voip, body.internet]) {
        const items = Array.isArray(bucket) ? bucket : [];
        for (const fi of items) {
            const extracted = extractBoxFromItem(fi);
            if (extracted && extracted.boxId) return extracted.boxId;
        }
    }
    return "";
}

/**
 * Resolve a box ID across multiple assigned-items responses, in priority
 * order (first non-empty wins). Mirrors the fofi → multi → voip → internet
 * precedence the IPTV page uses.
 * @param {object[]} responses
 * @param {string} userid
 * @returns {string}
 */
export function resolveBoxIdFromResponses(responses, userid) {
    for (const resp of responses) {
        const id = extractBoxIdFromAssigned(resp, userid);
        if (id) return id;
    }
    return "";
}
