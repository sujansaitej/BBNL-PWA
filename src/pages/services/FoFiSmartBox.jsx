import { useState, useEffect, useRef, useCallback, lazy, Suspense } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { XMarkIcon, ExclamationCircleIcon, MagnifyingGlassIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
import { fofiPlans as mockFofiPlans } from "../../data";
import BottomNav from "../../components/BottomNav";
import { ServiceSelectionModal, Badge, Loader, Alert } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { getUser } from "../../services/safeStorage";
import { canonicalServiceKey } from "../../constants/services";

// Lazy-load QRScanner — only downloaded when user triggers QR scanning
const QRScanner = lazy(() => import("../../components/QRScanner"));
import {
    getFoFiPlans,
    validateFoFiAsset,
    fetchMACBySerial,
    registerFoFiDevice,
    getFoFiDeviceDetails,
    changeFoFiPlan,
    createFoFiPaymentOrder,
    verifyFoFiPayment,
    validateBeforeFofiBoxReg,
    getFofiUpgradePlans,
    getSpecialInternetPlans,
    getFofiPaymentInfo,
    linkFoFiBox,
    upgradeRegistration,
} from "../../services/fofiApis";
import { getMyPlanDetails, getCustKYCPreview, getUserAssignedItems } from "../../services/generalApis";
// Box-identity logic (extractBoxFromItem + linked-TV detection) lives in
// utils/boxId.js so this page, IPTVService, and prefetch all resolve a box
// the SAME way and can never diverge on "opted vs not opted".
import { extractBoxFromItem, detectLinkedTvType, getLinkedTvIdentifier, extractBoxIdFromAssigned, isFofiAndroidBoxId, findAndboxBoxId } from "../../utils/boxId";
import { raceForFirstMatch } from "../../utils/raceForFirst";
import { findLinkFofiboxSrvid, findSpecialPlanSrvid } from "../../utils/specialPlans";
import { lsRemove, lsGetStale, lsSet, lsGet } from "../../services/lsCache";
import { refreshServiceController } from "../../services/navigationController";
import { loadKycWithRetry } from "../../utils/kycRetry";
import { isExpiredDate } from "../../utils/dateParse";

// Cache key helpers
const _uid = (cd) => cd?.username || cd?.customer_id || '';
const OVERVIEW_TTL = 2 * 60 * 1000;

// ── Pending upgrade-plan store ──────────────────────────────────────
// After a successful FoFi payment/upgrade the backend takes several
// seconds (sometimes 10+) to propagate the new plan across getMyPlanDetails
// and the assigned-items buckets. During that window every backend read
// still returns the OLD plan. To stop the Current Plan card flapping back
// to the old plan — or showing it at all — we remember the just-purchased
// plan per box id in sessionStorage and keep displaying it until the
// backend confirms the SAME plan (or a short TTL elapses). This also keeps
// the correct plan if the operator leaves and revisits the page before the
// backend catches up.
const PENDING_PLAN_TTL_MS = 10 * 60 * 1000; // 10 minutes
const _pendingPlanKey = (boxId) => `fofi_pending_plan_${String(boxId || '').trim().toLowerCase()}`;

// Tolerant plan-name comparison: the optimistic name passed from the payment
// screen and the backend's canonical plan name can differ in spacing/case/
// punctuation (e.g. "FoFi-Box + FTA ONLY" vs "fofibox_fta_only").
function plansEquivalent(a, b) {
    const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    const na = norm(a);
    const nb = norm(b);
    return !!na && na === nb;
}

function readPendingPlan(boxId) {
    if (!boxId) return null;
    try {
        const raw = window.sessionStorage?.getItem(_pendingPlanKey(boxId));
        if (!raw) return null;
        const rec = JSON.parse(raw);
        if (!rec?.plan || !rec?.ts || (Date.now() - rec.ts) > PENDING_PLAN_TTL_MS) {
            window.sessionStorage?.removeItem(_pendingPlanKey(boxId));
            return null;
        }
        return rec.plan;
    } catch (_) {
        return null;
    }
}

function writePendingPlan(boxId, plan) {
    if (!boxId || !plan) return;
    try {
        window.sessionStorage?.setItem(_pendingPlanKey(boxId), JSON.stringify({ plan, ts: Date.now() }));
    } catch (_) { /* sessionStorage can be unavailable in private mode */ }
}

function clearPendingPlan(boxId) {
    if (!boxId) return;
    try { window.sessionStorage?.removeItem(_pendingPlanKey(boxId)); } catch (_) { /* ignore */ }
}

// ── Success-popup replay guard (module-level) ───────────────────────
// The "Plan Upgraded" popup must appear exactly ONCE per completed
// payment/order. A useRef guard resets if the component fully remounts
// (observed on slower phones), and sessionStorage is unavailable in some
// embedded webviews / private mode. A module-level Set survives component
// remounts for the life of the SPA session, so it is the durable in-memory
// guard that the per-instance ref and sessionStorage back up.
const _shownSuccessPopupKeys = new Set();

function markSuccessPopupShown(key) {
    if (!key) return;
    _shownSuccessPopupKeys.add(key);
    try { window.sessionStorage?.setItem(`fofi_success_popup_${key}`, 'shown'); } catch (_) { /* ignore */ }
}

function wasSuccessPopupShown(key) {
    if (!key) return false;
    if (_shownSuccessPopupKeys.has(key)) return true;
    try { return window.sessionStorage?.getItem(`fofi_success_popup_${key}`) === 'shown'; } catch (_) { return false; }
}

// Shared derivation of FoFi overview state from a getUserAssignedItems
// response. Used for both initial cache hydration (so first paint shows
// the right view, not 'not opted') and inside the fetch effect after a
// fresh API response. Keeps the box-ID picking logic in one place.
//
// CRITICAL: Some backends put the FoFi box under different servkey buckets
// (multi, voip, internet) depending on user classification. We scan ALL
// buckets to find the box, not just body.fofi.
// extractBoxFromItem + _BBNL_BOX_RE/_FOFI_BOX_RE moved to utils/boxId.js
// (single source of truth — imported at the top of this file).

function deriveFofiOverviewFromAssigned(assignedItemsResponse) {
    const body = assignedItemsResponse?.body;

    // Scan ALL servkey buckets - box might be under fofi, multi, voip, or internet
    const buckets = ['fofi', 'multi', 'voip', 'internet'];
    let foundBox = null;
    let sourceBucket = null;

    for (const bucket of buckets) {
        const items = Array.isArray(body?.[bucket]) ? body[bucket] : [];
        for (const item of items) {
            const extracted = extractBoxFromItem(item);
            if (extracted) {
                foundBox = extracted;
                sourceBucket = bucket;
                break;
            }
        }
        if (foundBox) break;
    }

    if (!foundBox) {
        return { hasFofi: false, serviceDetails: null, fi: {}, boxId: '' };
    }

    const fi = foundBox.item;
    const boxId = foundBox.boxId;
    const deviceType = foundBox.tvType?.label || null; // e.g. 'Android TV', 'Samsung TV', 'LG TV'

    console.log(`🔍 [FoFi] Box found in bucket '${sourceBucket}':`, boxId, `(source: ${foundBox.source})`, deviceType ? `[${deviceType}]` : '');

    const mac = fi.mac || fi.macid || fi.mac_addr || fi.macAddress || fi.mac_address || fi.fofimac || '';
    const serial = fi.fserialno || fi.serial_number || fi.serialno || fi.fofiserailnumber || '';

    // Pull plan name / expiry straight from the assigned-items row when
    // the backend already includes them. This is what makes the service
    // card render reliably (QA 4.9 — "details sometimes show, sometimes
    // don't"): previously these were hard-coded to 'Loading…', so the
    // card stayed *unconfirmed* until the separate getMyPlanDetails
    // enrichment landed. When that call transiently failed it fell back
    // to 'N/A', isConfirmedFofiServiceDetails returned false, and the
    // whole service vanished into the "not opted" CTA. Seeding a
    // meaningful expiry/plan here keeps the card confirmed even if the
    // enrichment never resolves; the enrichment still overwrites these
    // with the authoritative values when it succeeds.
    const itemPlanName = firstTrimmedValue(fi.planname, fi.plan_name, fi.serv_name);
    const itemExpiry = firstTrimmedValue(fi.expirydate, fi.expiry_date, fi.expdate);

    return {
        hasFofi: true,
        fi,
        boxId,
        serviceDetails: {
            boxId,
            deviceType,
            planName: isMeaningfulFoFiValue(itemPlanName) ? itemPlanName : 'Loading…',
            expiryDate: isMeaningfulFoFiValue(itemExpiry) ? itemExpiry : 'Loading…',
            macAddress: mac,
            serialNumber: serial,
            ottPlanId: null,
            status: fi.primarybox === 'yes' ? 'Active' : (fi.status || 'Active'),
            _rawFofiItem: fi,
        },
    };
}

// Returns all FoFi boxes found across ALL assigned-item buckets,
// deduped by boxId. Used to build the multi-box dropdown when one
// user has more than one linked box.
function extractAllBoxesFromAssigned(assignedItemsResponse) {
    const body = assignedItemsResponse?.body;
    const buckets = ['fofi', 'multi', 'voip', 'internet'];
    const results = [];
    const seenBoxIds = new Set();

    for (const bucket of buckets) {
        const items = Array.isArray(body?.[bucket]) ? body[bucket] : [];
        for (const fi of items) {
            const extracted = extractBoxFromItem(fi);
            if (!extracted) continue;
            const { boxId } = extracted;
            if (seenBoxIds.has(boxId.toLowerCase())) continue;
            seenBoxIds.add(boxId.toLowerCase());

            const deviceType = extracted.tvType?.label || null;
            const mac = fi.mac || fi.macid || fi.mac_addr || fi.macAddress || fi.mac_address || fi.fofimac || '';
            const serial = fi.fserialno || fi.serial_number || fi.serialno || fi.fofiserailnumber || '';
            const itemPlanName = firstTrimmedValue(fi.planname, fi.plan_name, fi.serv_name);
            const itemExpiry = firstTrimmedValue(fi.expirydate, fi.expiry_date, fi.expdate);

            results.push({
                boxId,
                serviceDetails: {
                    boxId,
                    deviceType,
                    planName: isMeaningfulFoFiValue(itemPlanName) ? itemPlanName : 'Loading…',
                    expiryDate: isMeaningfulFoFiValue(itemExpiry) ? itemExpiry : 'Loading…',
                    macAddress: mac,
                    serialNumber: serial,
                    ottPlanId: null,
                    status: fi.primarybox === 'yes' ? 'Active' : (fi.status || 'Active'),
                    _rawFofiItem: fi,
                },
            });
        }
    }
    return results;
}

// ── Cable-TV fallback extraction ────────────────────────────────────
// A cabletv-only customer's STB/smartcard row carries no BBNL/FoFi
// marker, so utils/boxId.js (correctly) rejects it as a FoFi box and
// the page used to collapse into the bare "not opted" screen. The
// native app instead shows that cable box + its (FTA/cable) plan with
// an UPGRADE PLAN button. These rows are collected here for that
// fallback card ONLY — they never mark the customer as having a FoFi
// service; FoFi box identity remains solely utils/boxId.js's decision.
const CABLE_ROW_HINT_RE = /\b(cable\s*tv|cabletv|cable|iptv|catv|dpo|fta|stb|set\s*top|smart\s*card|smartcard)\b/i;

function extractCableTvBoxesFromAssigned(assignedItemsResponse) {
    const body = assignedItemsResponse?.body;
    const buckets = ['fofi', 'multi', 'voip', 'internet'];
    const results = [];
    const seen = new Set();

    for (const bucket of buckets) {
        const items = Array.isArray(body?.[bucket]) ? body[bucket] : [];
        for (const fi of items) {
            if (!fi || typeof fi !== 'object') continue;
            if (extractBoxFromItem(fi)) continue; // real FoFi box / linked TV — not a cable fallback row
            const id = firstTrimmedValue(getLinkedTvIdentifier(fi), fi.product_name);
            if (!id) continue;
            const searchable = [
                fi.servkey, fi.serv_name, fi.service_name, fi.servicename,
                fi.planname, fi.plan_name, fi.itemname, fi.item_name,
                fi.product_name, fi.type, fi.category,
            ].map((v) => (v == null ? '' : String(v))).join(' ');
            const cableHinted = CABLE_ROW_HINT_RE.test(searchable);
            // Internet-bucket rows are usually the customer's internet CPE
            // (ONU serial etc.) — accept them only with an explicit cable marker.
            if (bucket === 'internet' && !cableHinted) continue;
            if (seen.has(id.toLowerCase())) continue;
            seen.add(id.toLowerCase());
            const planName = firstTrimmedValue(fi.planname, fi.plan_name);
            const expiryDate = firstTrimmedValue(fi.expirydate, fi.expiry_date, fi.expdate);
            results.push({
                boxId: id,
                cableHinted,
                serviceName: firstTrimmedValue(fi.serv_name, fi.service_name, fi.servkey) || 'fofi',
                planName: isMeaningfulFoFiValue(planName) ? planName : 'Loading…',
                expiryDate: isMeaningfulFoFiValue(expiryDate) ? expiryDate : 'Loading…',
                _rawItem: fi,
            });
        }
    }
    // Explicitly cable-marked rows first so the default selection is the
    // most likely genuine cable box.
    results.sort((a, b) => (b.cableHinted ? 1 : 0) - (a.cableHinted ? 1 : 0));
    return results;
}

// Resolve the cable-TV fallback boxes for the UPGRADE PLAN card. This is the
// SINGLE decision point for "does this customer get the cable-TV upgrade card
// instead of the bare 'not opted' screen". A customer qualifies when the
// customer record says they have cable TV (hasCablePerRecord, derived from
// the authenticated customerData.usertype) OR an assigned row is
// explicitly cable-marked.
//
// Box-ID resolution is deliberately layered because a cable-only box often
// isn't returned in the linked-device fields of getUserAssignedItems (the
// same "backend data sync gap" IPTVService logs). In priority order:
//   1. rows extractCableTvBoxesFromAssigned recognised (cable STB rows)
//   2. extractBoxIdFromAssigned (the boxId.js extractor IPTVService uses)
//   3. cabletv_boxid_<userid> that IPTVService cached on a prior visit
//   4. no id at all — still show the card (UPGRADE PLAN runs the add-FoFi-box
//      flow, which does NOT need the cable box id), with a blank Box ID row.
// The plan-enrichment effect fills Plan Name / Expiry / real Box ID from
// getMyPlanDetails afterwards.
// ponytail: usertype is a per-search-list literal ('cableonly'/'internet'),
// not a per-customer capability flag, so a customer with both internet+cable
// selected from the internet list reads as no-cable. Same approximation the
// InternetService/IPTVService migrations use.
const hasCableFromUsertype = (cd) => String(cd?.usertype || '').toLowerCase().includes('cable');

function resolveCableTvBoxes(assignedItemsResponse, hasCablePerRecord, userid) {
    const rows = extractCableTvBoxesFromAssigned(assignedItemsResponse)
        .filter(b => hasCablePerRecord || b.cableHinted);
    if (rows.length) return rows;

    // From here on we only synthesise a card for customers the record
    // confirms are on cable TV — never guess for anyone else.
    if (!hasCablePerRecord) return [];

    let boxId = extractBoxIdFromAssigned(assignedItemsResponse, userid) || '';
    if (!boxId && userid) {
        // IPTVService persists the resolved cable box id for a year; reuse it.
        try { boxId = lsGet(`cabletv_boxid_${userid}`, 365 * 24 * 60 * 60 * 1000) || ''; } catch (_) { /* ignore */ }
    }

    return [{
        boxId,
        cableHinted: true,
        serviceName: 'fofi',
        planName: 'Loading…',
        expiryDate: 'Loading…',
        _rawItem: null,
    }];
}

function findFoFiSubscribedService(planResponse) {
    const subscribedServices = planResponse?.body?.subscribed_services || [];
    if (!Array.isArray(subscribedServices)) return null;
    return subscribedServices.find(s => canonicalServiceKey(s?.servicekey) === 'fofi'
        || /\bfo-?fi\b|smart\s*box|fofibox|\bfta\b/i.test(
            `${s?.serv_name || ''} ${s?.title || ''} ${s?.planname || ''} ${s?.plan_name || ''}`
        ));
}

const FOFI_MAC_RE = /[0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5}/;
const FOFI_SERIAL_RE = /\bFOFI[0-9]{6,}\b/i;

// Robustly extract the MAC + serial from a scanned "Scan From TV" QR.
//
// The native FoFi box QR is base64-encoded JSON ({emacid, serialno}),
// but the Android TV / Smart-TV apps present the SAME data in other
// shapes: plain JSON, URL-encoded JSON, or a raw string that simply
// contains the MAC (and sometimes the serial). The previous code
// assumed base64+JSON only AND required both MAC and serial, so a
// TV-app QR in any other shape failed with "Invalid QR code format"
// and the TV MAC never appeared. We now try, in order:
//   1. base64 -> JSON   (native FoFi box contract)
//   2. plain / URL-encoded JSON  (Smart-TV apps)
//   3. raw text         (regex-extract MAC + serial)
// and only require the MAC (serial is optional for TV devices).
function parseFofiQrPayload(qrData) {
    const raw = String(qrData ?? '').trim();
    const tryJson = (s) => {
        try { const v = JSON.parse(s); return (v && typeof v === 'object') ? v : null; }
        catch (_) { return null; }
    };

    let obj = null;
    let decodedText = '';

    // 1. base64-wrapped (native FoFi box contract)
    try {
        const decoded = atob(raw);
        if (decoded) { decodedText = decoded; obj = tryJson(decoded); }
    } catch (_) { /* not valid base64 — fall through */ }

    // 2. plain JSON, then URL-encoded JSON
    if (!obj) obj = tryJson(raw);
    if (!obj) { try { obj = tryJson(decodeURIComponent(raw)); } catch (_) { /* ignore */ } }

    const pick = (o, keys) => {
        if (!o) return '';
        const lowerKeys = keys.map((k) => k.toLowerCase());
        for (const realKey of Object.keys(o)) {
            if (lowerKeys.includes(realKey.toLowerCase())) {
                const val = o[realKey];
                if (val != null && String(val).trim()) return String(val).trim();
            }
        }
        return '';
    };

    let mac = pick(obj, ['emacid', 'macid', 'mac', 'mac_addr', 'mac_address', 'macaddress']);
    let serial = pick(obj, ['serialno', 'serial', 'serial_number', 'serialnumber', 'fserialno']);

    // 3. regex fallback over raw + decoded text (handles raw-string QRs)
    const haystack = `${raw} ${decodedText}`;
    if (!mac) { const m = haystack.match(FOFI_MAC_RE); if (m) mac = m[0]; }
    if (!serial) { const s = haystack.match(FOFI_SERIAL_RE); if (s) serial = s[0]; }

    return { mac, serial };
}

function firstTrimmedValue(...values) {
    for (const value of values) {
        if (value == null) continue;
        const text = String(value).trim();
        if (text) return text;
    }
    return '';
}

function isMeaningfulFoFiValue(value) {
    const text = firstTrimmedValue(value);
    if (!text) return false;
    const normalized = text.toLowerCase();
    return !['n/a', 'na', 'null', 'undefined', '-', '--'].includes(normalized)
        && !normalized.startsWith('loading');
}

// LINKED_TV_TYPES + detectLinkedTvType moved to utils/boxId.js (imported above).

function getLinkedTvRowsFromResponse(response, source) {
    const body = response?.body || {};
    const rows = [];
    const pushRows = (value, bucket) => {
        if (Array.isArray(value)) {
            value.forEach((item) => {
                if (item && typeof item === 'object') rows.push({ ...item, _source: source, _bucket: bucket });
            });
        } else if (value && typeof value === 'object') {
            rows.push({ ...value, _source: source, _bucket: bucket });
        }
    };

    ['fofi', 'multi', 'voip', 'internet'].forEach((bucket) => pushRows(body?.[bucket], bucket));
    [
        'devices',
        'device',
        'tvdevices',
        'tv_devices',
        'linked_devices',
        'linkeddevices',
        'assigned_devices',
        'assigneddevices',
        'smart_tv',
        'smarttv',
        'androidtv',
        'samsungtv',
        'lgtv',
        'android_tv',
        'samsung_tv',
        'lg_tv',
    ].forEach((key) => pushRows(body?.[key], key));

    return rows;
}

// getLinkedTvIdentifier moved to utils/boxId.js (imported above).

function deriveLinkedTvDevices(assignedItemsResponse, planDetailsResponse) {
    const rows = [
        ...getLinkedTvRowsFromResponse(assignedItemsResponse, 'assigned-items'),
        ...getLinkedTvRowsFromResponse(planDetailsResponse, 'plan-details'),
    ];
    const seen = new Set();

    return rows.reduce((devices, row, index) => {
        const tvType = detectLinkedTvType(row);
        if (!tvType) return devices;

        const identifier = getLinkedTvIdentifier(row);
        const mac = firstTrimmedValue(row?.mac, row?.macid, row?.mac_addr, row?.macAddress, row?.mac_address);
        const serial = firstTrimmedValue(row?.serialno, row?.serial_no, row?.serial_number, row?.fserialno, row?.fofiserailnumber);
        const model = firstTrimmedValue(row?.model, row?.device_model, row?.deviceModel, row?.product_name, row?.itemname, row?.item_name);
        const status = firstTrimmedValue(row?.status, row?.devicestatus, row?.device_status, row?.validity_status, row?.primarybox);
        const key = [
            tvType.key,
            identifier,
            mac,
            serial,
            model,
            row?._bucket,
            row?._source,
            index,
        ].filter(Boolean).join('|');
        const dedupeKey = [tvType.key, identifier || mac || serial || model || key].join('|');
        if (seen.has(dedupeKey)) return devices;
        seen.add(dedupeKey);

        devices.push({
            type: tvType.label,
            identifier,
            mac,
            serial,
            model,
            status,
            source: row?._source,
            bucket: row?._bucket,
        });
        return devices;
    }, []);
}

function isConfirmedFofiServiceDetails(details) {
    if (!details) return false;
    const hasBox = isMeaningfulFoFiValue(details.boxId || details.fofiboxid || details.fofi_box_id);
    // Existing-service upgrade flow must have human-verified plan context.
    // A standalone ottPlanId without plan/expiry has led to false positives
    // and wrong-box-id failures on submit.
    const hasPlanOrExpiry = isMeaningfulFoFiValue(details.planName)
        || isMeaningfulFoFiValue(details.expiryDate);
    return hasBox && hasPlanOrExpiry;
}

function isNoActiveFofiPlanResponse(response) {
    const message = String(response?.status?.err_msg || response?.message || '').toLowerCase();
    return response?.status?.err_code !== 0 && (
        message.includes('valid fofi box') ||
        message.includes('fofi box') ||
        message.includes('not subscribed') ||
        message.includes('not found') ||
        message.includes('no active')
    );
}

function getFoFiValidationBody(response) {
    const body = Array.isArray(response?.body) ? (response.body[0] || {}) : (response?.body || {});
    if (Array.isArray(body?.data)) return body.data[0] || {};
    if (body?.data && typeof body.data === 'object') return body.data;
    if (Array.isArray(body?.details)) return body.details[0] || {};
    if (body?.details && typeof body.details === 'object') return body.details;
    if (Array.isArray(body?.device)) return body.device[0] || {};
    if (body?.device && typeof body.device === 'object') return body.device;
    return body || {};
}

function extractFoFiMac(response, fallback = '') {
    const body = getFoFiValidationBody(response);
    const fromBody = firstTrimmedValue(
        body.mac_addr,
        body.macAddress,
        body.mac_address,
        body.mac,
        body.macid,
        body.fofimac
    );
    if (fromBody) return fromBody;

    const msg = String(response?.status?.err_msg || '');
    const match = msg.match(FOFI_MAC_RE);
    return firstTrimmedValue(match?.[0], fallback);
}

function extractFoFiBoxId(response, fallback = '') {
    const body = getFoFiValidationBody(response);
    const fromBody = firstTrimmedValue(
        body.boxid,
        body.box_id,
        body.fofiboxid,
        body.fofi_box_id,
        body.stbid,
        body.stb_id,
        body.device_id
    );
    if (fromBody) return fromBody;

    // ANDBOX-format only — an "already assigned" message may carry the real box
    // id, but "device not belongs op(BBNL_OP981)" carries an OPERATOR id that a
    // broad /BBNL[-_].../ would wrongly load into the Box ID field.
    const msg = String(response?.status?.err_msg || '');
    return firstTrimmedValue(findAndboxBoxId(msg), fallback);
}

function classifyFoFiValidationMessage(message) {
    if (!message) return { kind: 'other', opid: '' };
    const raw = String(message).trim();
    const lower = raw.toLowerCase();
    const opMatch = raw.match(/not\s+belongs(?:\s+to)?(?:\s+op)?\s*\(?([A-Za-z0-9_-]+)\)?/i)
        || raw.match(/belongs\s+to\s*\(?([A-Za-z0-9_-]+)\)?/i);

    if (lower.includes('not belongs')) {
        return { kind: 'not-belongs', opid: opMatch?.[1] || '' };
    }
    if (lower.includes('device details not found') || lower.includes('device not found')) {
        return { kind: 'not-found', opid: opMatch?.[1] || '' };
    }
    if (
        lower.includes('already assigned') ||
        lower.includes('already registered') ||
        lower.includes('already in use') ||
        lower.includes('already linked')
    ) {
        return { kind: 'already-assigned', opid: opMatch?.[1] || '' };
    }
    return { kind: 'other', opid: opMatch?.[1] || '' };
}

function formatFoFiValidationError(response, { fallbackMac = '', fallbackBoxId = '' } = {}) {
    const rawMsg = String(response?.status?.err_msg || '').trim();
    const classification = classifyFoFiValidationMessage(rawMsg);

    if (classification.kind === 'not-belongs') {
        const mac = extractFoFiMac(response, fallbackMac);
        const opid = classification.opid || 'different OPID';
        return `${mac ? `(${mac}) ` : ''}device not belongs to (${opid})`;
    }

    if (classification.kind === 'already-assigned') {
        const box = extractFoFiBoxId(response, fallbackBoxId);
        return box
            ? `Fo-Fi device with box id (${box}) already assigned`
            : 'Fo-Fi device already assigned';
    }

    if (classification.kind === 'not-found') {
        return 'Device details not found. Please verify the Box ID and try again.';
    }

    return rawMsg;
}

function resolveFoFiPlanSelection(plan) {
    const servRates = plan?.serv_rates || {};
    const planid = firstTrimmedValue(
        plan?.planid,
        plan?.fofiplanid,
        plan?.fofi_planid,
        plan?.ottservplanid,
        plan?.ott_servplanid,
        plan?.ottplanid,
        plan?.ott_planid,
        plan?.ott_plan_id,
        servRates.planid,
        servRates.plan_id,
        servRates.fofiplanid,
        servRates.fofi_planid,
        servRates.ottservplanid,
        servRates.ott_servplanid,
        servRates.ottplanid,
        servRates.ott_planid,
        servRates.ott_plan_id,
        plan?.servid,
        plan?.srvid,
        plan?.id
    );
    const priceid = firstTrimmedValue(
        plan?.priceid,
        plan?.price_id,
        servRates.priceid,
        servRates.price_id,
        '99'
    );
    const rate = firstTrimmedValue(
        plan?.planrate,
        plan?.price,
        plan?.amount,
        plan?.rate,
        Array.isArray(servRates.prices) ? servRates.prices[0] : '',
        0
    );
    const servid = firstTrimmedValue(
        plan?.servid,
        plan?.serv_id,
        plan?.service_id,
        plan?.serviceid,
        servRates.servid,
        servRates.serv_id,
        servRates.service_id,
        servRates.serviceid,
        '3'
    );

    return { planid, priceid, planrate: rate, servid };
}

function resolveInternetLinkPlanSelection(plan) {
    const servRates = plan?.serv_rates || {};
    const planid = firstTrimmedValue(
        plan?.servid,
        plan?.srvid,
        plan?.internet_planid,
        plan?.internet_plan_id,
        plan?.planid,
        plan?.plan_id,
        plan?.id,
        servRates.servid,
        servRates.srvid,
        servRates.serviceid,
        servRates.service_id,
        servRates.planid,
        servRates.plan_id
    );
    const priceid = firstTrimmedValue(
        plan?.priceid,
        plan?.price_id,
        servRates.priceid,
        servRates.price_id,
        '99'
    );
    const rate = firstTrimmedValue(
        plan?.planrate,
        plan?.price,
        plan?.amount,
        plan?.rate,
        Array.isArray(servRates.prices) ? servRates.prices[0] : '',
        0
    );
    const servid = firstTrimmedValue(
        plan?.service_id,
        plan?.serviceid,
        plan?.serv_id,
        servRates.service_id,
        servRates.serviceid,
        servRates.serv_id,
        planid,
        '3'
    );

    return { planid, priceid, planrate: rate, servid };
}

function getPlanSelectId(plan, index = '') {
    return firstTrimmedValue(
        plan?._selectId,
        plan?.planid,
        plan?.srvid,
        plan?.servid,
        plan?.id,
        index
    );
}

function getInternetOriginPlanRows(response) {
    const body = response?.body || {};
    // Live specialInternetPlans (verified 2026-07-09 against netmontest)
    // returns body as a BARE ARRAY of {srvid, serv_name} rows — not an
    // object with an internet_plans key. Only checking object keys made
    // this always return [] and the Link FoFi Box dropdown permanently
    // showed "No IPTV / Combo plans are available".
    if (Array.isArray(body)) return body;
    const primary = Array.isArray(body.internet_plans) ? body.internet_plans : null;
    if (primary) return primary;

    const fallbackKeys = [
        'iptv_combo_plans',
        'iptv_plans',
        'combo_plans',
        'internet_combo_plans',
        'plans',
    ];
    for (const key of fallbackKeys) {
        if (Array.isArray(body[key])) return body[key];
    }
    return [];
}

function mapInternetOriginPlan(plan, idx) {
    const selection = resolveInternetLinkPlanSelection(plan);
    const planName = firstTrimmedValue(plan?.serv_name, plan?.planname, plan?.plan_name, plan?.name, `Plan ${idx + 1}`);
    return {
        ...plan,
        _source: 'internet-link',
        _selectId: `internet_${selection.planid || idx}`,
        _uniqueKey: `internet_${selection.planid || idx}_${planName}`,
    };
}

function normalizeFoFiPlanName(value) {
    return firstTrimmedValue(value)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function getFoFiAssignedItemsList(assignedItemsResponse) {
    const body = assignedItemsResponse?.body || {};
    return ['fofi', 'multi', 'voip', 'internet']
        .flatMap(bucket => Array.isArray(body?.[bucket]) ? body[bucket] : [])
        .filter(Boolean);
}

function pickFoFiPlanIdsFromRecord(record, { strict = false } = {}) {
    if (!record || typeof record !== 'object') return null;
    const servRates = record?.serv_rates || {};
    // True plan-id fields — these identify a *purchasable* plan that the
    // FoFi payment API (`service/paymentinfo/fofi`) accepts. The loose
    // fields below (srvid/servid/serviceid/id) are subscription / record
    // identifiers, NOT plan ids; sending one to paymentinfo makes the
    // backend reply "Invalid Plan, choose valid Plan". `strict` mode
    // (used when resolving the current plan from an expired subscription)
    // therefore excludes the loose identifiers.
    const planIdFields = [
        record.planid,
        record.plan_id,
        record.fofiplanid,
        record.fofi_planid,
        record.internet_planid,
        record.ottservplanid,
        record.ott_servplanid,
        record.ottplanid,
        record.ott_planid,
        record.ott_plan_id,
        servRates.planid,
        servRates.plan_id,
        servRates.fofiplanid,
        servRates.fofi_planid,
        servRates.ottservplanid,
        servRates.ott_servplanid,
        servRates.ottplanid,
        servRates.ott_planid,
        servRates.ott_plan_id,
    ];
    const looseIdFields = [
        record.srvid,
        record.servid,
        record.serviceid,
        record.service_id,
        record.id,
        servRates.servid,
        servRates.srvid,
        servRates.serviceid,
        servRates.service_id,
    ];
    const planid = strict
        ? firstTrimmedValue(...planIdFields)
        : firstTrimmedValue(...planIdFields, ...looseIdFields);
    if (!planid) return null;

    return {
        planid,
        priceid: firstTrimmedValue(record.priceid, record.price_id, servRates.priceid, servRates.price_id, '99'),
        servid: firstTrimmedValue(record.servid, record.serv_id, record.serviceid, record.service_id, servRates.servid, servRates.serv_id, servRates.serviceid, servRates.service_id, '3'),
        planrate: firstTrimmedValue(record.planrate, record.price, record.amount, record.rate, Array.isArray(servRates.prices) ? servRates.prices[0] : ''),
        planName: firstTrimmedValue(record.planname, record.plan_name, record.serv_name, record.title, record.name),
    };
}

function flattenFoFiPlanCatalog(plansResponse) {
    const body = plansResponse?.body || {};
    return [
        ...(Array.isArray(body.fofi_plans) ? body.fofi_plans : []),
        ...(Array.isArray(body.ott_plans) ? body.ott_plans : []),
        ...(Array.isArray(body.plans) ? body.plans : []),
        ...(Array.isArray(body.cable_plans) ? body.cable_plans : []),
        ...(Array.isArray(body.internet_plans) ? body.internet_plans : []),
    ];
}

// Match the current plan NAME against the purchasable-plan catalog
// (registrationNecessities → fofi/ott/internet plans). Because the
// catalog only lists plans that can actually be paid for, a name match
// here is guaranteed to yield a plan id the FoFi payment API accepts —
// even when the customer's subscription is EXPIRED and its own record
// carries no usable plan-id field. Exact (normalized) match is preferred
// over a fuzzy substring match to avoid picking an adjacent plan.
function matchFoFiCatalogByName(planCatalog, planName) {
    const target = normalizeFoFiPlanName(planName);
    if (!target) return null;
    const catalog = Array.isArray(planCatalog) ? planCatalog : [];
    const findBy = (predicate) => {
        const plan = catalog.find(p => {
            const name = normalizeFoFiPlanName(p?.planname || p?.plan_name || p?.serv_name || p?.title || p?.name);
            return name && predicate(name);
        });
        return pickFoFiPlanIdsFromRecord(plan);
    };
    return findBy(name => name === target)
        || findBy(name => name.includes(target) || target.includes(name));
}

function resolvePayBillPlanIds({ planDetails, serviceDetails, assignedItems, planCatalog } = {}) {
    const fofiSvc = findFoFiSubscribedService(planDetails);
    const targetPlanName = normalizeFoFiPlanName(
        fofiSvc?.planname ||
        fofiSvc?.plan_name ||
        serviceDetails?.planName ||
        serviceDetails?._rawFofiSvc?.planname ||
        serviceDetails?._rawFofiItem?.planname
    );
    const fallbackPlanName = firstTrimmedValue(
        fofiSvc?.planname,
        fofiSvc?.plan_name,
        serviceDetails?.planName
    );

    const directCandidates = [
        fofiSvc,
        serviceDetails?._rawFofiSvc,
        serviceDetails?._rawFofiItem,
        { planid: serviceDetails?.ottPlanId, planname: serviceDetails?.planName },
        ...getFoFiAssignedItemsList(assignedItems),
    ];

    // 1) Resolve the current plan name to a VALID purchasable plan id via
    //    the catalog. This is the primary source for PAY BILL: it works
    //    identically for active and expired subscriptions and never sends
    //    a stale subscription/record id that the backend would reject with
    //    "Invalid Plan, choose valid Plan".
    const catalogMatch = matchFoFiCatalogByName(planCatalog, fallbackPlanName);
    if (catalogMatch?.planid) {
        return { ...catalogMatch, planName: catalogMatch.planName || fallbackPlanName, source: 'plan-catalog-name-match' };
    }

    // 2) A true plan-id field carried on the current subscription / asset
    //    record (strict — excludes srvid/servid/serviceid/id).
    for (const candidate of directCandidates) {
        const ids = pickFoFiPlanIdsFromRecord(candidate, { strict: true });
        if (ids?.planid) return { ...ids, planName: ids.planName || fallbackPlanName, source: 'current-service' };
    }

    // 3) Loose record identifiers — absolute last resort so an otherwise
    //    unresolvable plan still has a chance rather than hard-blocking.
    for (const candidate of directCandidates) {
        const ids = pickFoFiPlanIdsFromRecord(candidate);
        if (ids?.planid) return { ...ids, planName: ids.planName || fallbackPlanName, source: 'current-service-loose' };
    }

    return { planid: '', priceid: '99', servid: '3', planrate: '', planName: firstTrimmedValue(serviceDetails?.planName), source: 'missing' };
}

function normalizeStringArray(value) {
    const values = Array.isArray(value) ? value : (value ? [value] : []);
    return values
        .map(item => firstTrimmedValue(item))
        .filter(Boolean);
}

function resolveFoFiRegistrationFields(plan) {
    const services = normalizeStringArray(
        plan?.reg_serv_keys ||
        plan?.services ||
        plan?.servicekeys ||
        plan?.service_keys
    );
    const subscriptions = normalizeStringArray(plan?.subscriptions);
    const packages = normalizeStringArray(
        plan?.packages ||
        plan?.packageid ||
        plan?.package_id ||
        plan?.packageids
    );

    return {
        services: services.length > 0 ? services : ['ott'],
        ...(subscriptions.length > 0 ? { subscriptions } : {}),
        ...(packages.length > 0 ? { packages } : {}),
    };
}

function parseFoFiCurrency(value) {
    if (value === undefined || value === null || value === '') return null;
    const amount = parseFloat(String(value).replace(/,/g, ''));
    return Number.isFinite(amount) ? amount : null;
}

function compactFoFiPlanName(value) {
    return firstTrimmedValue(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isFoFiFtaOnlyPlan(planName) {
    return compactFoFiPlanName(planName).includes('ftaonly');
}

function isFoFiDhamakaOfferPlan(planName) {
    const compact = compactFoFiPlanName(planName);
    return compact.includes('dhamakaoffer') || compact.includes('dhamaka');
}

function resolveFoFiAmountDeductable(paymentBody, fallbackPlanName = '') {
    const planName = firstTrimmedValue(
        paymentBody?.planname,
        paymentBody?.plan_name,
        paymentBody?.serv_name,
        fallbackPlanName
    );

    if (isFoFiFtaOnlyPlan(planName)) return 0;

    const explicitAmount = parseFoFiCurrency(
        paymentBody?.deduction?.totalamount ??
        paymentBody?.amount_deductable ??
        paymentBody?.amountdeductable ??
        paymentBody?.fofi_wallet_deduction ??
        paymentBody?.wallet_deduction
    );
    if (explicitAmount !== null && explicitAmount > 0) return explicitAmount;

    const fofiShare = parseFoFiCurrency(paymentBody?.fofishare);
    if (fofiShare !== null && fofiShare > 0) return fofiShare;

    const fofiSplit = parseFoFiCurrency(
        paymentBody?.final_split_data?.FOFI?.amount ??
        paymentBody?.final_split_data?.fofi?.amount
    );
    if (fofiSplit !== null && fofiSplit > 0) return fofiSplit;

    if (isFoFiDhamakaOfferPlan(planName)) return 35.40;

    const totalAmount = parseFoFiCurrency(
        paymentBody?.total_amt ??
        paymentBody?.totalamount ??
        paymentBody?.grandtotal ??
        paymentBody?.paidamount
    );
    if (totalAmount !== null && totalAmount > 0) return totalAmount;

    return explicitAmount !== null ? explicitAmount : 0;
}

// "Last-known-good" store for the Link-FoFi "Select Plan" dropdown.
// The backend plan list (registrationNecessities / specialInternetPlans)
// is sometimes slow or transiently returns an empty list, which left the
// dropdown stuck on "Loading…" or "No plans". We persist the last
// successful, NON-EMPTY real list per customer + entry path and fall back
// to it on an empty/failed load. These rows carry the real plan ids, so
// they stay payable — unlike the static mock list, which cannot be
// resolved to a valid plan id at checkout.
const LINK_PLANS_LKG_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
const linkPlansLkgKey = (userid, internetOrigin) =>
    `fofilkp_${userid}_${internetOrigin ? 'int' : 'fofi'}`;

function FoFiSmartBox() {
    const location = useLocation();
    const navigate = useNavigate();
    const { customerId: routeCustomerId } = useParams();
    const toast = useToast();

    // Use actual customer data from API (passed from customer list).
    // Pin to a ref so transient location.state loss (e.g. after
    // window.history.back() pops the QR scanner entry) doesn't blank
    // the page or force the data-fetch effect to re-run and abort the
    // in-flight validateFoFiAsset request.
    const customerDataRef = useRef(null);
    if (location.state?.customer) customerDataRef.current = location.state.customer;
    // Prefer the ref over transient state — window.history.back() from the
    // QR scanner wipes location.state, but the ref survives.
    const customerData = customerDataRef.current || location.state?.customer;
    const servicesFromState = location.state?.services || [];
    const fromInternet = location.state?.fromInternet;
    const internetId = location.state?.internetId;
    const refreshData = location.state?.refreshData; // Flag to force refresh after payment
    const paymentSuccess = location.state?.paymentSuccess; // Flag to show success message
    const paymentSuccessOrderId = firstTrimmedValue(
        location.state?.paymentSuccessOrderId,
        location.state?.transactionid,
        location.state?.orderid,
        location.state?._t
    );
    const isNewRegistration = location.state?.isNewRegistration; // Flag to indicate new registration vs upgrade
    // Optimistic state passed from FofiPayment — applied on mount so the
    // Current Plan card and wallet update immediately, before the
    // backend's slow propagation lands.
    const optimisticPlan = location.state?.optimisticPlan;
    const optimisticFofiBoxId = location.state?.optimisticFofiBoxId;
    const optimisticDeduction = location.state?.optimisticDeduction;
    const successMessageFromState = isNewRegistration
        ? 'FoFi-Box Registration Successful! Plan has been activated.'
        : 'Plan upgraded successfully. Your new plan is now active.';

    // hasFofiService is determined from API state (hasFofiService), not mock data

    // ── SWR: hydrate from cache for instant render ──
    const _userid = _uid(customerData);
    const _cachedAI = _userid ? lsGetStale(`uai_fofi_${_userid}`, OVERVIEW_TTL) : null;
    const _hasCached = !!_cachedAI;
    // Derive overview from cached assigned-items so existing customers
    // don't flash the "not opted" view on first paint while the network
    // revalidation is still in flight.
    const _cachedOverview = _cachedAI?.data ? deriveFofiOverviewFromAssigned(_cachedAI.data) : null;
    const _cachedAllBoxes = _cachedAI?.data ? extractAllBoxesFromAssigned(_cachedAI.data) : [];
    // Cable-TV fallback hydration — cabletv-only customers render the
    // cable box + UPGRADE PLAN card on first paint instead of flashing
    // the "not opted" CTA while the network revalidates.
    const _cachedCableBoxes = (_cachedOverview && !_cachedOverview.hasFofi && _cachedAI?.data)
        ? resolveCableTvBoxes(_cachedAI?.data, hasCableFromUsertype(customerData), _userid)
        : [];

    // State management
    const [showServiceModal, setShowServiceModal] = useState(false);
    // View states: 'overview', 'link-fofi', 'upgrade-plans', 'subscription-confirm', 'device-validation', 'payment'
    // When coming from Internet Service "Link FoFi Box", go directly to Scan From TV screen
    const [view, setView] = useState(paymentSuccess ? 'overview' : (fromInternet ? 'link-fofi' : 'overview'));
    const [selectedPlan, setSelectedPlan] = useState(null);
    const [isUpgradeLinkContinuation, setIsUpgradeLinkContinuation] = useState(false);
    // True when the operator is subscribing a package for a device that is
    // ALREADY linked to the customer (present in getUserAssignedItems but with
    // no active plan — see linkedDeviceNoPlan). In that case the box + MAC are
    // already known, so the link-fofi step must render as a read-only
    // "confirm & subscribe" screen instead of the Scan/GET-MAC entry form —
    // the device is already added, we're only subscribing a package to it.
    const [isLinkedDeviceSubscription, setIsLinkedDeviceSubscription] = useState(false);
    const [deviceValidated, setDeviceValidated] = useState(false);
    const [showValidationSuccess, setShowValidationSuccess] = useState(false);
    const [validationMethod, setValidationMethod] = useState(null); // 'qr' or 'manual'
    const [serialNumber, setSerialNumber] = useState('');
    const [boxId, setBoxId] = useState('');
    const [macAddress, setMacAddress] = useState('');
    const [validationError, setValidationError] = useState('');
    // General error state for API/data loading failures
    const [error, setError] = useState('');
    // Ref attached to the validation-error banner so we can scroll it
    // into view the moment it appears. Without this the banner used
    // to render below the LINK FO-FI BOX button — operators on small
    // phones had to scroll down to discover why the link failed.
    const validationErrorRef = useRef(null);
    const [deviceInfo, setDeviceInfo] = useState(null);
    const [fofiPlans, setFofiPlans] = useState(fromInternet ? [] : mockFofiPlans); // Initialize with mock data except Internet-origin link flow
    const [linkPlansLoading, setLinkPlansLoading] = useState(false);
    const [linkPlansError, setLinkPlansError] = useState('');
    // Bumped by the "Retry" button to force a fresh plan load (bypassing the
    // 10-min cache) when the Select Plan list fails or comes back empty.
    const [linkPlansRetryKey, setLinkPlansRetryKey] = useState(0);
    // Guards against the load effect re-firing in a loop: setFofiPlans([]) on
    // an empty result used to change `fofiPlans` and re-trigger the effect,
    // which kept the dropdown stuck on "Loading plans…".
    const linkPlansAttemptRef = useRef(null);
    const [isLoading, setIsLoading] = useState(false);
    // Dedicated loading flag for the "Upload Document" button. Kept
    // separate from the shared `isLoading` so the button doesn't show
    // "Loading…" during the initial overview data fetch (which also
    // toggles `isLoading`). It should only spin while the operator is
    // actually fetching the KYC preview after tapping the button.
    const [isUploadingDocument, setIsUploadingDocument] = useState(false);
    const [isOverviewLoading, setIsOverviewLoading] = useState(!_hasCached); // Skip spinner if cache hit
    const [overviewRetryKey, setOverviewRetryKey] = useState(0);
    const [paymentOrderId, setPaymentOrderId] = useState(null);
    const [showQRScanner, setShowQRScanner] = useState(false);
    // Flag to prevent sub-view popstate listener from resetting view when
    // QR scanner pops its own history entry via history.back()
    const skipNextPopStateRef = useRef(false);
    // FoFi service status - will be validated by API response
    // Hydrate from the cached assigned-items derivation so existing
    // customers render the correct view on first paint instead of
    // briefly flashing the "not opted" CTA before the network resolves.
    const [hasFofiService, setHasFofiService] = useState(_cachedOverview?.hasFofi ?? false);
    const [fofiServiceDetails, setFofiServiceDetails] = useState(_cachedOverview?.serviceDetails ?? null);
    // A device that is LINKED to the customer (e.g. an Android TV that
    // just logged into the ATV app) but has NO active FoFi plan yet. It
    // is intentionally NOT a "confirmed" FoFi service (no plan/expiry),
    // so it must not drive the upgrade/pay flows — but we keep its
    // identity (Box ID + MAC + device type) so the overview can SHOW the
    // TV MAC the operator needs to subscribe a package, and so the
    // package-subscription (link) step can pre-fill it instead of a
    // bare "not opted" screen with no device info.
    const [linkedDeviceNoPlan, setLinkedDeviceNoPlan] = useState(null);
    const [fofiAssignedItems, setFofiAssignedItems] = useState(_cachedAI?.data || null); // FoFi assigned items from API
    // Multi-box support: all boxes linked to this user; selectedBoxIdx is
    // the index of the currently-displayed box in allFofiBoxes.
    const [allFofiBoxes, setAllFofiBoxes] = useState(_cachedAllBoxes);
    const [selectedBoxIdx, setSelectedBoxIdx] = useState(0);
    // Cable-TV fallback boxes (customer has cable TV but NO FoFi box).
    // Drives the box-id + plan card with UPGRADE PLAN in the not-opted
    // branch. Never feeds hasFofiService / the upgrade payment flows —
    // UPGRADE PLAN there runs the same new-user (add-FoFi-box) path.
    const [cableTvBoxes, setCableTvBoxes] = useState(_cachedCableBoxes);
    const [selectedCableBoxIdx, setSelectedCableBoxIdx] = useState(0);
    // One enrichment attempt per (customer, box) — the patch below
    // changes cableTvBoxes, which re-runs the effect.
    const cableEnrichAttemptedRef = useRef(new Set());
    // Raw planDetails response — needed for the PAY BILL button's
    // disabled state, which mirrors the Internet Service pattern of
    // gating on body.other_service_renewal.btn_status.
    const [fofiPlanDetailsRaw, setFofiPlanDetailsRaw] = useState(null);
    
    // Upgrade Plans state
    const [upgradePlans, setUpgradePlans] = useState([]);
    const [filteredUpgradePlans, setFilteredUpgradePlans] = useState([]);
    const [ottPlansMap, setOttPlansMap] = useState({}); // Map of plan names to OTT plan IDs
    const [upgradePlansLoading, setUpgradePlansLoading] = useState(false);
    const [upgradePlansError, setUpgradePlansError] = useState('');
    const [upgradeSearchTerm, setUpgradeSearchTerm] = useState('');
    const [showZeroPricePopup, setShowZeroPricePopup] = useState(false); // Popup for ₹0 plans
    
    // Toast/Snackbar for payment success
    const [showSuccessToast, setShowSuccessToast] = useState(false);
    const [successMessage, setSuccessMessage] = useState('');

    // ── Success Alert ──
    // Rendered as a stable element (NOT a `<SuccessAlert/>` component whose
    // function identity changes every render — that remounts the Alert and
    // re-plays its enter animation on each parent re-render, which is what
    // made the "Plan Upgraded" popup appear again and again on some phones
    // while background refetches/optimistic updates re-rendered the page).
    // Using a plain element keeps the Alert's type stable so React
    // reconciles it in place. autoClose lets it dismiss itself after a few
    // seconds; closeSuccessToast is stable so it never reopens.
    const closeSuccessToast = useCallback(() => setShowSuccessToast(false), []);
    const successAlert = (
        // Stable `key` so React reconciles this element in place even when
        // conditional siblings (loading banners, etc.) shift around it during
        // the post-payment staged refetch. Without it, the Alert remounted on
        // slower phones — replaying its entrance animation (looked like the
        // popup "appearing again") and resetting its internal auto-close timer
        // (so it never closed). Auto-close is additionally driven by a
        // page-level timer below, which survives any remount.
        <Alert
            key="fofi-success-alert"
            isOpen={showSuccessToast}
            onClose={closeSuccessToast}
            type="success"
            title={isNewRegistration ? 'Registration Successful' : 'Plan Upgraded'}
            message={successMessage}
            autoClose
            autoCloseMs={5000}
        />
    );

    // Page-level auto-close. The Alert has its own autoClose, but that timer
    // lives inside the Alert element and resets every time the element
    // remounts. This timer lives on the persistent page component instance,
    // so it fires exactly 5s after the popup opens regardless of how often the
    // Alert (or the view) re-renders/remounts — guaranteeing the popup closes.
    useEffect(() => {
        if (!showSuccessToast) return undefined;
        const t = setTimeout(() => setShowSuccessToast(false), 5000);
        return () => clearTimeout(t);
    }, [showSuccessToast]);

    // ── Cable-TV fallback plan enrichment ──
    // The backend files an FTA/cable customer's current plan under the
    // fofi servicekey when getMyPlanDetails is queried with the CABLE
    // box id (native-app behaviour: "Service Name: fofi / Plan Name:
    // FOFI-Box + FTA ONLY"). Enrich the selected fallback box with those
    // authoritative values; on failure fall back to whatever the
    // assigned-items row seeded, else N/A — never leave "Loading…".
    useEffect(() => {
        if (hasFofiService) return undefined;
        const box = cableTvBoxes[selectedCableBoxIdx];
        if (!box || !_userid) return undefined;
        const boxIdToEnrich = box.boxId || '';
        // Only attempt each box once (empty-id boxes keyed by index so a
        // later real box id can still be enriched).
        const attemptKey = boxIdToEnrich
            ? `${_userid}:${boxIdToEnrich}`
            : `${_userid}:#${selectedCableBoxIdx}`;
        if (cableEnrichAttemptedRef.current.has(attemptKey)) return undefined;
        cableEnrichAttemptedRef.current.add(attemptKey);

        // No box id resolvable — we can't query the plan (getMyPlanDetails
        // requires the box id). Don't leave the card on "Loading…"; the
        // UPGRADE PLAN button still works without plan details.
        if (!boxIdToEnrich) {
            setCableTvBoxes(prev => prev.map((b, i) => i === selectedCableBoxIdx ? {
                ...b,
                planName: isMeaningfulFoFiValue(b.planName) ? b.planName : 'N/A',
                expiryDate: isMeaningfulFoFiValue(b.expiryDate) ? b.expiryDate : 'N/A',
            } : b));
            return undefined;
        }

        let cancelled = false;
        (async () => {
            let svc = null;
            try {
                const planResp = await getMyPlanDetails(
                    { servicekey: 'fofi', userid: _userid, fofiboxid: boxIdToEnrich, voipnumber: '' },
                    true
                );
                const services = Array.isArray(planResp?.body?.subscribed_services)
                    ? planResp.body.subscribed_services : [];
                svc = findFoFiSubscribedService(planResp)
                    || services.find(s => isMeaningfulFoFiValue(firstTrimmedValue(s?.planname, s?.plan_name)))
                    || null;
            } catch (e) {
                if (e?.message?.includes('navigated away')) {
                    cableEnrichAttemptedRef.current.delete(attemptKey);
                    return;
                }
                console.warn('⚠️ [FoFi] cable-TV fallback plan enrichment failed (non-fatal):', e?.message);
            }
            if (cancelled) return;
            setCableTvBoxes(prev => prev.map(b => {
                if (b.boxId !== boxIdToEnrich) return b;
                const planName = firstTrimmedValue(svc?.planname, svc?.plan_name, b.planName);
                const expiryDate = firstTrimmedValue(svc?.expirydate, svc?.expiry_date, b.expiryDate);
                const serviceName = firstTrimmedValue(svc?.serv_name, svc?.servicekey, b.serviceName, 'fofi');
                return {
                    ...b,
                    serviceName,
                    planName: isMeaningfulFoFiValue(planName) ? planName : 'N/A',
                    expiryDate: isMeaningfulFoFiValue(expiryDate) ? expiryDate : 'N/A',
                };
            }));
        })();
        return () => { cancelled = true; };
    }, [cableTvBoxes, selectedCableBoxIdx, hasFofiService, _userid]);

    // Fall back to the last-known-good real list when a fresh load comes
    // back empty/failed, so the dropdown keeps showing payable options
    // instead of "No plans". Returns true if a fallback was applied.
    const applyLinkPlansFallback = (lkgKey) => {
        const lkg = lsGetStale(lkgKey, LINK_PLANS_LKG_TTL);
        if (Array.isArray(lkg?.data) && lkg.data.length > 0) {
            setFofiPlans(lkg.data);
            return lkg.data;
        }
        return null;
    };

    const loadFoFiLinkPlans = async (userid, logUname, { internetOrigin = false, skipCache = false } = {}) => {
        const lkgKey = linkPlansLkgKey(userid, internetOrigin);

        if (internetOrigin) {
            const plansResponse = await getSpecialInternetPlans({ logUname, isKiranastore: "no" }, { skipCache });
            // An explicit backend error must surface as an error state (with
            // retry), not a silent empty list that the caller can't tell apart
            // from "no plans" — that ambiguity is what left the dropdown stuck.
            const errCode = plansResponse?.status?.err_code;
            if (errCode !== undefined && errCode !== 0) {
                // Prefer a still-valid cached list over hard-failing the dropdown.
                const fallback = applyLinkPlansFallback(lkgKey);
                if (fallback) return fallback;
                throw new Error(plansResponse?.status?.err_msg || 'Could not load Internet-side IPTV/Combo plans.');
            }
            const linkPlans = getInternetOriginPlanRows(plansResponse);
            const mappedPlans = linkPlans.map(mapInternetOriginPlan);
            if (mappedPlans.length > 0) {
                lsSet(lkgKey, mappedPlans); // remember the last good list
                setFofiPlans(mappedPlans);
                return mappedPlans;
            }
            const fallback = applyLinkPlansFallback(lkgKey);
            if (fallback) return fallback;
            setFofiPlans([]);
            return [];
        }

        const plansResponse = await getFofiUpgradePlans({
            logUname,
            moduletype: "upgradation",
            userid,
        });
        const linkPlans = plansResponse?.body?.fofi_plans
            || plansResponse?.body?.ott_plans
            || plansResponse?.body?.plans
            || plansResponse?.body?.cable_plans
            || [];
        if (plansResponse?.status?.err_code === 0 && linkPlans.length > 0) {
            const mappedPlans = linkPlans.map((plan, idx) => ({
                ...plan,
                _source: 'fofi',
                _uniqueKey: `fofi_${plan.planid ?? plan.srvid ?? plan.servid ?? plan.id ?? idx}_${plan.planname || plan.serv_name || plan.plan_name || ''}`,
            }));
            lsSet(lkgKey, mappedPlans); // remember the last good list
            setFofiPlans(mappedPlans);
            return mappedPlans;
        }
        const fallback = applyLinkPlansFallback(lkgKey);
        if (fallback) return fallback;
        setFofiPlans([]);
        return [];
    };

    // NOTE: When coming from Internet Service "Link FoFi Box" (fromInternet=true),
    // we intentionally do NOT push an extra history entry. The route entry for
    // /customer/:id/service/fofi-smart-box IS what back should pop — that takes
    // the user straight back to Internet Service. Pushing an extra entry would
    // make back pop that entry instead, triggering the sub-view popstate handler
    // which flips view to 'overview' and leaves the user stuck on the FoFi page.

    // Show success toast if coming back from successful payment.
    //
    // Anti-replay: a page refresh/remount on this route can preserve
    // the location.state we navigated in with, so the popup must be
    // opened only from this guarded effect. Prefer the backend
    // transaction id passed by FofiPayment.jsx; _t is kept only as a
    // compatibility fallback for older navigation state.
    // ALSO clear the location state right after — so a user who
    // navigates away and comes back via deep link doesn't see a
    // stale "Plan Upgraded" popup.
    const popupShownRef = useRef(new Set());
    useEffect(() => {
        if (!paymentSuccess) return;
        // Force the overview view so the success popup is visible
        // immediately after payment navigation (not only after back).
        if (view !== 'overview') {
            setView('overview');
            try { subViewDepthRef.current = 0; } catch (_) {}
        }
        const key = paymentSuccessOrderId || 'no-key';
        // Durable, multi-layer replay guard: module-level Set (survives
        // remounts) backed by sessionStorage, plus the per-instance ref.
        if (popupShownRef.current.has(key) || wasSuccessPopupShown(key)) return;
        popupShownRef.current.add(key);
        markSuccessPopupShown(key);

        setSuccessMessage(successMessageFromState);
        setShowSuccessToast(true);

        // Clear the success flag from React Router state so the popup can
        // never replay. The old code used window.history.replaceState,
        // which rewrites the browser history entry but does NOT update
        // React Router's in-memory location — so useLocation() still read
        // paymentSuccess=true for the life of this mount. Any re-render
        // (this effect depends on `view` and itself calls setView, plus
        // the page re-renders on every staged refetch) re-qualified the
        // effect, and on phones where sessionStorage is unavailable or the
        // component remounts the in-memory guard reset and the popup fired
        // again. navigate(replace) actually flips paymentSuccess to false
        // in Router state (next render early-returns) while preserving
        // Router's own key/idx bookkeeping — the durable anti-replay.
        navigate(location.pathname + location.search, {
            replace: true,
            state: { ...(location.state || {}), paymentSuccess: false },
        });
    }, [paymentSuccess, paymentSuccessOrderId, successMessageFromState, view, navigate, location.pathname, location.search]);

    // Optimistic plan-name update — apply once fofiServiceDetails has
    // been hydrated by the initial fetch (so we have boxId / expiryDate
    // / etc.), but before the staged refetches catch up to the new plan.
    // This is what makes the Current Plan card flip immediately instead
    // of staying on the old plan for 10+ seconds while the backend
    // propagates. Subsequent refetches will overwrite with the
    // authoritative server value.
    //
    // originalPlanRef — captures the plan name as the backend returned it
    // BEFORE we overwrite with the optimistic value. The staged refetch
    // effect uses this to recognise "backend is still echoing the old
    // plan" and leave the optimistic state in place instead of flipping
    // back, which is what produced the production "flapping" symptom.
    const optimisticAppliedRef = useRef(false);
    const originalPlanRef = useRef(null);
    useEffect(() => {
        if (!optimisticPlan) return;
        if (optimisticAppliedRef.current) return;
        if (!fofiServiceDetails) return; // Wait for hydration first
        // Persist the just-purchased plan per box so it survives the
        // backend-propagation window AND a leave/revisit of this page.
        const boxForPending = fofiServiceDetails.boxId || optimisticFofiBoxId || '';
        if (boxForPending) writePendingPlan(boxForPending, optimisticPlan);
        if (fofiServiceDetails.planName === optimisticPlan) {
            optimisticAppliedRef.current = true;
            originalPlanRef.current = optimisticPlan;
            return;
        }
        // Snapshot the pre-optimistic plan name so the refetch can ignore
        // backend responses that still show this stale value.
        originalPlanRef.current = fofiServiceDetails.planName || null;
        optimisticAppliedRef.current = true;
        setFofiServiceDetails(prev => prev ? { ...prev, planName: optimisticPlan } : prev);
    }, [optimisticPlan, optimisticFofiBoxId, fofiServiceDetails]);

    // Decide which plan name to commit when a backend response lands.
    //
    // While an upgrade is pending for this box (sessionStorage record, or
    // the in-memory optimistic value), the backend often still echoes the
    // OLD plan. In that window we keep showing the just-purchased plan and
    // only accept the backend value once it matches it — at which point the
    // upgrade is confirmed and the pending record is cleared. When there is
    // no pending upgrade this is a transparent pass-through of the backend
    // value, so normal navigation is unaffected.
    const commitPlanName = useCallback((backendPlanName, prevPlanName, boxId) => {
        const pending = readPendingPlan(boxId)
            || ((optimisticPlan && optimisticAppliedRef.current) ? optimisticPlan : null);
        if (!pending) {
            return isMeaningfulFoFiValue(backendPlanName) ? backendPlanName : prevPlanName;
        }
        if (isMeaningfulFoFiValue(backendPlanName) && plansEquivalent(backendPlanName, pending)) {
            clearPendingPlan(boxId);   // backend has propagated the new plan
            return backendPlanName;
        }
        // Backend still stale (or echoing the old plan) → keep the new plan.
        return pending;
    }, [optimisticPlan]);

    useEffect(() => {
        if (!refreshData || !optimisticFofiBoxId || fofiServiceDetails) return;
        setHasFofiService(true);
        setFofiServiceDetails({
            boxId: optimisticFofiBoxId,
            planName: optimisticPlan || 'Loading...',
            expiryDate: 'Loading...',
            macAddress: '',
            serialNumber: '',
            ottPlanId: null,
            status: 'Active',
        });
    }, [refreshData, optimisticFofiBoxId, optimisticPlan, fofiServiceDetails]);

    // Scroll the validation error banner into view as soon as it
    // appears, then auto-dismiss after 5 seconds.
    //
    // Most rejections happen right after a click on the
    // bottom-of-page LINK FO-FI BOX button, so without the
    // scrollIntoView the banner sits below the fold and operators
    // wait for nothing. The auto-dismiss is product-requested —
    // operators don't want a stale error sitting on screen after
    // they've started another action; 5s is long enough to read a
    // single-line backend message.
    //
    // Effect re-runs on every validationError change, so each new
    // error gets its own fresh 5s timer; the cleanup clears the
    // previous timer so a quick second error doesn't get cut short.
    // Manual × dismiss still works — clearing the state cancels the
    // pending timer via the same cleanup.
    useEffect(() => {
        if (!validationError) return;
        const el = validationErrorRef.current;
        if (el) {
            requestAnimationFrame(() => {
                try {
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                } catch (_) {
                    el.scrollIntoView();
                }
            });
        }
        const timer = setTimeout(() => setValidationError(''), 5000);
        return () => clearTimeout(timer);
    }, [validationError]);

    // =====================================================
    // FETCH ALL DATA ON COMPONENT MOUNT (OPTIMIZED)
    // Parallelizes independent APIs, then fetches plan details
    // =====================================================
    useEffect(() => {
        // Cancel any in-flight requests from the previous page (e.g. InternetService)
        // so FoFi's requests get full access to the browser connection pool
        refreshServiceController();

        const fetchAllData = async () => {
            if (!customerData) return;

            const userid = customerData?.username || customerData?.customer_id;
            const user = getUser();
            const logUname = user?.username || 'superadmin';

            // Normal navigation can use freshly prefetched cache. Payment
            // returns still bypass cache so new plan/order state is not hidden
            // behind pre-payment assigned-items or plan details.
            const skipStatusCache = !!refreshData;

            // Invalidate caches if coming back from payment
            if (refreshData) {
                lsRemove(`uai_fofi_${userid}`);
                lsRemove(`uai_multi_${userid}`);
                lsRemove(`uai_voip_${userid}`);
                lsRemove(`uai_internet_${userid}`);
                lsRemove(`walbal_${logUname}_fofi`);
                // Order history will pick up the new transaction
                lsRemove(`orderhist_${userid}_fofi`);
                lsRemove(`orderhist_${userid}_all`);
            }

            // SWR: only show the spinner when there's nothing to render.
            // If lsGetStale already gave us a cached overview, render it
            // instantly and let the network revalidate in the background.
            // After payment, keep the hydrated overview on screen while
            // we revalidate FoFi status in the background (ram-dev
            // intentionally dropped the `|| refreshData` force-spinner
            // path — preserved).
            if (!_hasCached) setIsOverviewLoading(true);
            // When the operator tapped "Link FoFi Box" from Internet
            // Service they land directly on view='link-fofi'. Don't
            // block the link form's SUBMIT button while these overview
            // APIs run — the link submission doesn't depend on any of
            // them. Without this, the operator sees the SUBMIT button
            // stuck in "Processing…" for the 2-8 s it takes 6 parallel
            // APIs to resolve, before they've even filled the form.
            const _skipMountLoader = fromInternet && view === 'link-fofi';
            if (!_skipMountLoader) setIsLoading(true);

            try {
                // ──────────────────────────────────────────────────
                // FoFi Smart Box overview load — single parallel batch.
                //
                // We fire 4 calls in ONE Promise.all so total wait is
                // max-of-individual rather than sum-of-individual:
                //
                //   1. ServiceApis/getUserAssignedItems  (servkey=fofi)
                //   2. GeneralApi/cblCustDet              (refid=userid)
                //   3. cabletvapis/primaryCustdet         (userid=userid)
                //   4. ServiceApis/getMyPlanDetails       (fofi+empty boxid)
                //
                // The native trace shows a duplicate getUserAssignedItems
                // call at the end — we removed that since the data is
                // identical and only adds latency.
                //
                // getMyPlanDetails is fired without a Box ID — the
                // backend errors with "Please choose valid fofi box
                // id" when no box exists. That's fine: we treat the
                // error as "no plan" and proceed. When we DO get a
                // box ID, we re-fire getMyPlanDetails in the
                // background to enrich plan name / expiry. The
                // overview renders immediately on the first batch
                // so the operator sees the Box ID + customer details
                // without waiting for the plan call to land.
                // ──────────────────────────────────────────────────
                // ONE call. This used to fan out 4 servkeys through Promise.allSettled.
                // Verified against the live backend (7 real accounts):
                //   • servkey "multi" returns the UNION of every bucket
                //     (fofi/voip/internet) — the response shape is identical
                //     whichever key is sent, so 'fofi'/'internet' were duplicates
                //     of data 'multi' already carried.
                //   • 'voip' was never a valid key: the backend answers
                //     "Please enter valid service key." with body:null.
                // The backend also stalls ~30s on a large fraction of requests;
                // awaiting 4 calls meant a high chance of eating at least one, so a
                // single call cuts exposure. Root cause is server-side (PHP 5.6.40).
                // Box discovery — FIRST-BOX-WINS race across multi + fofi +
                // cabletv (unit-tested raceForFirstMatch). A SINGLE servkey is
                // unreliable on this backend: verified live that for `pwaram`
                // servkey="multi" FAILED (null, ~45s) while "cabletv" returned
                // the box in ~4s and "fofi" in ~41s. When the lone "multi" call
                // stalled/failed — most visibly right after a payment when the
                // operator lands back here — the box was missed and the overview
                // showed a FALSE "not opted" until a manual refresh happened to
                // hit a faster key. Racing takes the fastest key that carries a
                // box and survives any one key failing. (Was a single call under
                // 9a93c0c; the concurrency it avoided is worth paying for the
                // reliability, since the alternative is a wrong "not opted".)
                let assignedItemsResponse = null;
                const _AI_KEYS = ['multi', 'fofi', 'cabletv'];
                const aiRaced = await raceForFirstMatch(
                    _AI_KEYS.map((k) => () => getUserAssignedItems(k, userid, skipStatusCache)),
                    (v) => !!v && !!extractBoxIdFromAssigned(v, userid)
                );
                // Prefer the response that actually carries a box; otherwise the
                // first settled non-null (so a genuinely box-less customer still
                // gets a valid empty response to render "not opted" from).
                assignedItemsResponse =
                    aiRaced.find((r) => r?.status === 'fulfilled' && r.value && extractBoxIdFromAssigned(r.value, userid))?.value
                    || aiRaced.find((r) => r?.status === 'fulfilled' && r.value)?.value
                    || null;

                console.log('🟣 [FoFi] getUserAssignedItems(race multi/fofi/cabletv) body:', assignedItemsResponse?.body);

                // Done with primary spinner — let the overview render.
                setIsLoading(false);

                // Derive FoFi overview (hasFofi, boxId, serviceDetails)
                // from getUserAssignedItems. Same helper used for cache
                // hydration, so the post-fetch state shape exactly
                // matches what was rendered on first paint — no flicker.
                const derived = deriveFofiOverviewFromAssigned(assignedItemsResponse);
                const { hasFofi, boxId: boxIdFromAi } = derived;
                console.log('🔍 [FoFi] Box ID extraction — picked:', boxIdFromAi, 'hasFofi:', hasFofi);

                if (assignedItemsResponse) setFofiAssignedItems(assignedItemsResponse);

                // Build the full list of linked boxes so the multi-box
                // dropdown has all candidates. Reset selectedBoxIdx to 0
                // so a refreshed response always starts on box 0.
                const allBoxes = extractAllBoxesFromAssigned(assignedItemsResponse);
                if (allBoxes.length > 0) {
                    setAllFofiBoxes(allBoxes);
                    setSelectedBoxIdx(0);
                }

                // Cable-TV fallback: resolve the customer's cable box(es) up
                // front, regardless of the FoFi branch below. This is set
                // unconditionally so the UPGRADE PLAN card is available in
                // EVERY "no confirmed FoFi service" outcome — the plain
                // no-box case AND the case where a row is initially taken for
                // a FoFi box but then fails plan confirmation and is cleared.
                // The render only surfaces it when !hasConfirmedFofiService,
                // so a genuine FoFi customer never sees it.
                const hasCablePerRecord = hasCableFromUsertype(customerData);
                const cableBoxes = resolveCableTvBoxes(assignedItemsResponse, hasCablePerRecord, userid);
                console.log('🟣 [FoFi] cable-TV fallback:', {
                    hasCablePerRecord,
                    boxes: cableBoxes.map(b => b.boxId || '(no id)'),
                });
                setCableTvBoxes(cableBoxes);
                setSelectedCableBoxIdx(0);

                if (hasFofi) {
                    // STEP 1: render the overview IMMEDIATELY with what
                    // we have from getUserAssignedItems. Plan name and
                    // expiry start as "Loading…" placeholders so the
                    // user knows they're coming. The overview is
                    // interactive instantly — no waiting on the plan
                    // call which adds 1+ RTT on slow networks.
                    // (On cache hits this is a no-op patch — the same
                    // shape was already in initial state.)
                    setHasFofiService(true);
                    setError(""); // Clear any previous errors
                    setLinkedDeviceNoPlan(null); // a box is present; not the no-plan placeholder case
                    setFofiServiceDetails(prev => {
                        // Preserve any plan name/expiry already enriched
                        // from a prior render so we don't reset them to
                        // 'Loading…' on background revalidation.
                        if (prev && prev.boxId === derived.serviceDetails.boxId &&
                            prev.planName && prev.planName !== 'Loading…') {
                            return { ...prev, ...derived.serviceDetails, planName: prev.planName, expiryDate: prev.expiryDate, ottPlanId: prev.ottPlanId };
                        }
                        // On a fresh mount (incl. revisit before the backend
                        // has propagated an upgrade), keep showing the pending
                        // just-purchased plan instead of the stale one from
                        // assigned-items.
                        return {
                            ...derived.serviceDetails,
                            planName: commitPlanName(derived.serviceDetails.planName, derived.serviceDetails.planName, derived.serviceDetails.boxId || boxIdFromAi),
                        };
                    });

                    // STEP 2: enrich plan name + expiry in the
                    // background. Don't await — the overview is
                    // already on screen. When the call returns we
                    // patch fofiServiceDetails with the real values.
                    getMyPlanDetails(
                        { servicekey: 'fofi', userid, fofiboxid: boxIdFromAi, voipnumber: '' },
                        true
                    ).then(planResp => {
                        console.log('🟣 [FoFi] getMyPlanDetails(fofi) body:', planResp?.body);
                        const clearUnconfirmedFoFiService = () => {
                            // The device is linked but has no active plan. Keep its
                            // identity (Box ID + MAC + device type) so the overview
                            // can show the TV MAC for package subscription instead of
                            // discarding it into a bare "not opted" screen. This does
                            // NOT mark it as a confirmed service.
                            const sd = derived?.serviceDetails;
                            if (sd && isMeaningfulFoFiValue(sd.boxId || sd.macAddress)) {
                                setLinkedDeviceNoPlan({
                                    boxId: sd.boxId || '',
                                    macAddress: sd.macAddress || '',
                                    deviceType: sd.deviceType || null,
                                    serialNumber: sd.serialNumber || '',
                                });
                            }
                            setHasFofiService(false);
                            setFofiServiceDetails(null);
                            setFofiPlanDetailsRaw(planResp || null);
                            lsRemove(`uai_fofi_${userid}`);
                            if (boxIdFromAi) {
                                lsRemove(`plandets_fofi_${userid}_${boxIdFromAi}`);
                            }
                        };
                        if (planResp?.status?.err_code !== 0 || !planResp?.body) {
                            if (refreshData) {
                                setFofiPlanDetailsRaw(planResp || null);
                                return;
                            }
                            if (isNoActiveFofiPlanResponse(planResp)) {
                                clearUnconfirmedFoFiService();
                                return;
                            }
                            // Plan call failed — drop the loading
                            // placeholders so the operator doesn't
                            // stare at "Loading…" forever. But keep any
                            // plan/expiry we already seeded from the
                            // assigned-items row (QA 4.9): downgrading a
                            // real expiry to 'N/A' here would fail
                            // isConfirmedFofiServiceDetails and hide the
                            // whole service on a transient plan-call error.
                            setFofiServiceDetails(prev => prev ? {
                                ...prev,
                                planName: isMeaningfulFoFiValue(prev.planName) ? prev.planName : 'N/A',
                                expiryDate: isMeaningfulFoFiValue(prev.expiryDate) ? prev.expiryDate : 'N/A',
                            } : prev);
                            return;
                        }
                        setFofiPlanDetailsRaw(planResp);
                        const fofiSvc = findFoFiSubscribedService(planResp);
                        const planName = firstTrimmedValue(fofiSvc?.planname, fofiSvc?.plan_name);
                        const expiryDate = firstTrimmedValue(fofiSvc?.expirydate, fofiSvc?.expiry_date);
                        const ottPlanIdFromPlan = fofiSvc?.internet_planid || fofiSvc?.srvid || fofiSvc?.planid || null;
                        if (!fofiSvc || (!isMeaningfulFoFiValue(planName) && !isMeaningfulFoFiValue(expiryDate))) {
                            if (refreshData) return;
                            clearUnconfirmedFoFiService();
                            return;
                        }
                        setFofiServiceDetails(prev => {
                            if (!prev) return prev;
                            // Never let a post-upgrade backend response that
                            // still shows the OLD plan clobber the new one.
                            const nextPlanName = commitPlanName(planName, prev.planName, prev.boxId || boxIdFromAi) || 'N/A';
                            return {
                                ...prev,
                                planName: nextPlanName,
                                expiryDate: expiryDate || 'N/A',
                                ottPlanId: ottPlanIdFromPlan,
                                _rawFofiSvc: fofiSvc,
                            };
                        });
                    }).catch(e => {
                        if (e?.message?.includes('navigated away')) return;
                        console.warn('⚠️ [FoFi] getMyPlanDetails enrichment failed (non-fatal):', e?.message);
                        if (refreshData) return;
                        // Preserve any plan/expiry seeded from assigned-items
                        // so a transient enrichment failure doesn't hide the
                        // service (QA 4.9).
                        setFofiServiceDetails(prev => prev ? {
                            ...prev,
                            planName: isMeaningfulFoFiValue(prev.planName) ? prev.planName : 'N/A',
                            expiryDate: isMeaningfulFoFiValue(prev.expiryDate) ? prev.expiryDate : 'N/A',
                        } : prev);
                    });
                } else {
                    // No confirmed FoFi box. Native (CustomerCompleteOverviewFragment)
                    // treats this exactly like an empty getFofi() list: it simply
                    // doesn't show the FoFi section — no error screen. An empty
                    // response and a failed call are indistinguishable here and both
                    // mean the same thing to the operator, so we don't try to tell
                    // them apart. (The old allServkeyFailed check referenced four
                    // Promise.allSettled results that the single-call refactor in
                    // 9a93c0c deleted; reaching this branch threw a ReferenceError
                    // that surfaced as "Failed to load linked-device details".)
                    setHasFofiService(false);
                    setFofiServiceDetails(null);
                    setLinkedDeviceNoPlan(null); // no device linked at all
                    // cableTvBoxes already set above (unconditional cable-TV
                    // fallback) so the UPGRADE PLAN card shows for cable-only
                    // customers instead of the bare "not opted" screen.

                    // Warm the ADD FO-FI BOX eligibility gate now, while the
                    // operator is still reading the overview. This endpoint
                    // is the slowest call in the whole flow (6-8s server-side,
                    // measured 2026-07-09) and used to be fetched cold —
                    // with skipCache — only after the button tap, which is
                    // why ADD FO-FI BOX "kept loading for a very long time".
                    // It caches success for 5 min; handleUpgradeClick reads
                    // that cache, so the tap becomes near-instant. Its own
                    // .catch swallows failures, so warming it unconditionally
                    // is safe.
                    validateBeforeFofiBoxReg({ username: userid, loginuname: logUname }).catch(() => {});
                }
            } catch (error) {
                // Ignore errors from navigation cancellation (user navigated away)
                if (error?.message?.includes('navigated away')) return;
                console.error('❌ [FoFi SmartBox] Error fetching data:', error);
                setError('Failed to load linked-device details. Please check your connection and retry.');
                setIsLoading(false);
            } finally {
                setIsOverviewLoading(false);
            }
        };

        fetchAllData();
        // Depend on the stable _userid string (pinned via customerDataRef) and
        // refreshData. If we depended on the customerData object, the QR scanner's
        // window.history.back() would re-derive location with a new/undefined
        // state, re-fire this effect, and refreshServiceController() would abort
        // the in-flight validateFoFiAsset with "Request cancelled — navigated away."
    }, [_userid, refreshData, overviewRetryKey]);

    // Auto-hide device validation success message after 3 seconds
    useEffect(() => {
        if (showValidationSuccess) {
            const timer = setTimeout(() => {
                setShowValidationSuccess(false);
            }, 3000);
            return () => clearTimeout(timer);
        }
    }, [showValidationSuccess]);

    // Lazy-load the LINK FO-FI BOX plan dropdown when the link-fofi
    // view is reached without going through handleUpgradeClick — e.g.
    // when entered directly from Internet Service via fromInternet=true,
    // or on page refresh while sitting on that view. handleUpgradeClick
    // already pre-loads these for the UPGRADE → link-fofi path, so we
    // only fetch when we still have the mock placeholder data.
    //
    // Source: registrationNecessities → body.fofi_plans (FoFi-box
    // compatible). We never use internet_plans here — those are a
    // different flow, different payment endpoint.
    useEffect(() => {
        // Prefetch on the overview too (not only once the user taps "Link"),
        // so the "Select Plan" list is already warm — and instant — by the
        // time the link-fofi dropdown mounts. Other views (payment, etc.)
        // don't need it.
        if (view !== 'link-fofi' && view !== 'overview') return;
        if (isUpgradeLinkContinuation) return; // dropdown hidden in that mode
        // Real plans already loaded — nothing to do.
        if (Array.isArray(fofiPlans) && fofiPlans !== mockFofiPlans && fofiPlans.length > 0) return;
        const userid = customerData?.username || customerData?.customer_id;
        if (!userid) return;

        // Fetch at most once per (customer + retry). Without this guard, the
        // empty-result setFofiPlans([]) re-triggered the effect (it depends on
        // fofiPlans) and looped "Loading plans…" forever. Retry bumps
        // linkPlansRetryKey, which changes attemptKey and allows one more try.
        const attemptKey = `${userid}:${linkPlansRetryKey}`;
        if (linkPlansAttemptRef.current === attemptKey) return;
        linkPlansAttemptRef.current = attemptKey;

        const user = getUser();
        const logUname = user?.username || 'superadmin';
        let cancelled = false;
        setLinkPlansLoading(true);
        setLinkPlansError('');

        // Hard safety net: the API itself is timeout-bounded, but if anything
        // stalls, never leave the operator stuck on "Loading plans…".
        const safety = setTimeout(() => {
            if (cancelled) return;
            cancelled = true; // ignore any late resolve
            setLinkPlansLoading(false);
            setLinkPlansError('Loading plans is taking too long. Please retry.');
        }, 35000);

        loadFoFiLinkPlans(userid, logUname, {
            internetOrigin: !!fromInternet,
            skipCache: linkPlansRetryKey > 0, // retry pulls a fresh list
        })
            .then((plans) => {
                if (cancelled) return;
                clearTimeout(safety);
                setLinkPlansLoading(false);
                if (!Array.isArray(plans) || plans.length === 0) {
                    setLinkPlansError(fromInternet
                        ? 'No IPTV / Combo plans are available for this customer right now.'
                        : 'No plans are available right now.');
                }
            })
            .catch((err) => {
                if (cancelled) return;
                clearTimeout(safety);
                setFofiPlans([]);
                setLinkPlansError(err?.message || 'Failed to load plans. Please retry.');
                setLinkPlansLoading(false);
            });
        return () => { cancelled = true; clearTimeout(safety); };
    }, [view, fofiPlans, customerData, fromInternet, isUpgradeLinkContinuation, linkPlansRetryKey]);

    // After a payment/upgrade, the backend can take several seconds to
    // propagate the new box + plan + expiry across the assigned-items
    // buckets and plan-details endpoint. Poll all FoFi-compatible
    // buckets, not only body.fofi, because first-time opt-in can expose
    // the box under multi/voip/internet before the fofi bucket catches up.
    useEffect(() => {
        if (!refreshData) return;
        if (!customerData) return;
        const userid = customerData?.username || customerData?.customer_id;
        if (!userid) return;

        // Capture the "old" expiry date and plan name so we can stop
        // refetching as soon as either visibly changes.
        const initialExpiry = fofiServiceDetails?.expiryDate || null;
        const initialPlanName = fofiServiceDetails?.planName || null;
        const delays = [2000, 6000, 12000, 20000, 30000];
        const timers = [];
        let stopped = false;

        const refetchOnce = async (attempt) => {
            if (stopped) return;
            const currentBoxId = fofiServiceDetails?.boxId || fofiServiceDetails?.fofiboxid || optimisticFofiBoxId || '';
            lsRemove(`uai_fofi_${userid}`);
            lsRemove(`uai_multi_${userid}`);
            lsRemove(`uai_voip_${userid}`);
            lsRemove(`uai_internet_${userid}`);
            if (currentBoxId) lsRemove(`plandets_fofi_${userid}_${currentBoxId}`);
            try {
                // Single call — servkey "multi" already returns the fofi/voip/internet
                // union. See the note on the mount batch above.
                const assignedItems = await getUserAssignedItems('multi', userid, true).catch(() => null);
                if (stopped) return;
                const derived = deriveFofiOverviewFromAssigned(assignedItems);
                const fofiBoxId = derived.boxId || currentBoxId;
                if (assignedItems) setFofiAssignedItems(assignedItems);

                if (derived.hasFofi && derived.serviceDetails) {
                    setHasFofiService(true);
                    setFofiServiceDetails(prev => {
                        const keepPlanName = isMeaningfulFoFiValue(prev?.planName) ? prev.planName : derived.serviceDetails.planName;
                        const keepExpiryDate = isMeaningfulFoFiValue(prev?.expiryDate) ? prev.expiryDate : derived.serviceDetails.expiryDate;
                        return {
                            ...(prev || {}),
                            ...derived.serviceDetails,
                            planName: keepPlanName,
                            expiryDate: keepExpiryDate,
                            ottPlanId: prev?.ottPlanId || derived.serviceDetails.ottPlanId,
                        };
                    });
                }

                if (!fofiBoxId) return;
                lsRemove(`plandets_fofi_${userid}_${fofiBoxId}`);
                const planDetails = await getMyPlanDetails(
                    { servicekey: 'fofi', userid, fofiboxid: fofiBoxId, voipnumber: '' },
                    true
                ).catch(() => null);
                if (stopped) return;
                const fofiSvc = findFoFiSubscribedService(planDetails);
                const _fi = derived.fi || assignedItems?.body?.fofi?.[0] || {};
                const newExpiry =
                    fofiSvc?.expirydate || fofiSvc?.expiry_date || fofiSvc?.expdate ||
                    _fi?.expirydate || _fi?.expiry_date || _fi?.expdate || null;
                const newPlanName =
                    fofiSvc?.planname || fofiSvc?.plan_name || fofiSvc?.serv_name || fofiSvc?.title ||
                    _fi?.planname || null;

                if (planDetails) setFofiPlanDetailsRaw(planDetails);
                // Resolve the pending (just-purchased) plan for this box so we
                // can both display it and decide when the backend has caught up.
                const pendingNow = readPendingPlan(fofiBoxId)
                    || ((optimisticPlan && optimisticAppliedRef.current) ? optimisticPlan : null);
                const backendMatchesNew = pendingNow ? plansEquivalent(newPlanName, pendingNow) : false;

                if (fofiSvc && (newExpiry || newPlanName)) {
                    // commitPlanName keeps the new plan on screen while the
                    // backend still echoes the old one, and accepts (and clears)
                    // it once the backend confirms the upgrade. expiryDate is an
                    // independent field and can update earlier than planName.
                    setFofiServiceDetails(prev => {
                        if (!prev) return prev;
                        return {
                            ...prev,
                            planName: commitPlanName(newPlanName, prev.planName, fofiBoxId) || prev.planName,
                            expiryDate: newExpiry || prev.expiryDate,
                            ottPlanId: fofiSvc?.internet_planid || fofiSvc?.srvid || fofiSvc?.planid || prev.ottPlanId,
                            _rawFofiSvc: fofiSvc,
                            _rawFofiItem: _fi,
                        };
                    });
                }
                // Stop polling once the backend has clearly propagated.
                const expiryChanged = newExpiry && initialExpiry && newExpiry !== initialExpiry;
                const planChanged =
                    newPlanName &&
                    initialPlanName &&
                    newPlanName !== initialPlanName &&
                    newPlanName !== originalPlanRef.current;
                const detailsReady = fofiBoxId && (isMeaningfulFoFiValue(newPlanName) || isMeaningfulFoFiValue(newExpiry));
                // When an upgrade is pending, keep polling until the backend
                // actually returns the new plan (or the expiry visibly moves) so
                // we don't stop early while it still shows the old plan. Without
                // a pending upgrade, the original "any details ready" stop holds.
                const shouldStop = pendingNow
                    ? (backendMatchesNew || expiryChanged)
                    : (detailsReady || expiryChanged || planChanged);
                if (shouldStop) {
                    stopped = true;
                    console.log(`[FoFi refetch] propagated on attempt ${attempt + 1} → plan=${newPlanName}, expiry=${newExpiry}, matchedNew=${backendMatchesNew}`);
                }
            } catch (_) { /* best effort */ }
        };

        delays.forEach((d, i) => {
            timers.push(setTimeout(() => refetchOnce(i), d));
        });

        return () => {
            stopped = true;
            timers.forEach(clearTimeout);
        };
    }, [refreshData, customerData, fofiServiceDetails?.boxId, optimisticFofiBoxId]);

    // Service navigation handler — peer service switch.
    // replace: true because these are parallel service views of the same
    // customer, not nested screens. Pushing would pile up an entry each
    // time the user toggled between Internet/IPTV/Voice/FoFi via the
    // picker, and back would walk through all of them instead of
    // returning to the customer services list.
    const handleServiceSelect = (service) => {
        setShowServiceModal(false);
        if (!service) return;

        const serviceId = (service.id || '').toLowerCase();
        const svcName = (service.name || '').toLowerCase();

        if (serviceId === 'internet' || svcName.includes('internet')) {
            navigate(`/customer/${customerData.customer_id}/service/internet`, {
                replace: true,
                state: { customer: customerData, services: servicesFromState }
            });
        } else if (serviceId === 'iptv' || svcName.includes('cable') || svcName.includes('iptv')) {
            navigate(`/customer/${customerData.customer_id}/service/iptv`, {
                replace: true,
                state: { customer: customerData, services: servicesFromState }
            });
        } else if (serviceId === 'voice' || svcName.includes('voice')) {
            navigate(`/customer/${customerData.customer_id}/service/voice`, {
                replace: true,
                state: { customer: customerData, services: servicesFromState }
            });
        }
    };

    // Switch the active FoFi box when the operator picks a different
    // box from the multi-box dropdown. Immediately updates fofiServiceDetails
    // to the new box's item-derived data (plan shows "Loading…"), then
    // enriches plan name/expiry via getMyPlanDetails in the background.
    const handleBoxSelect = useCallback(async (idx) => {
        const box = allFofiBoxes[idx];
        if (!box) return;
        setSelectedBoxIdx(idx);
        setFofiServiceDetails(box.serviceDetails);
        const userid = customerData?.username || customerData?.customer_id;
        if (!userid) return;
        getMyPlanDetails(
            { servicekey: 'fofi', userid, fofiboxid: box.boxId, voipnumber: '' },
            true
        ).then(planResp => {
            if (planResp?.status?.err_code !== 0 || !planResp?.body) return;
            const fofiSvc = findFoFiSubscribedService(planResp);
            if (!fofiSvc) return;
            const planName = firstTrimmedValue(fofiSvc?.planname, fofiSvc?.plan_name);
            const expiryDate = firstTrimmedValue(fofiSvc?.expirydate, fofiSvc?.expiry_date);
            setFofiServiceDetails(prev =>
                prev?.boxId === box.boxId ? {
                    ...prev,
                    planName: commitPlanName(planName, prev.planName, box.boxId) || 'N/A',
                    expiryDate: expiryDate || 'N/A',
                    ottPlanId: fofiSvc?.internet_planid || fofiSvc?.srvid || fofiSvc?.planid || null,
                    _rawFofiSvc: fofiSvc,
                } : prev
            );
            setFofiPlanDetailsRaw(planResp);
        }).catch(e => {
            if (!e?.message?.includes('navigated away'))
                console.warn('[FoFi] box-select plan fetch failed:', e?.message);
        });
    }, [allFofiBoxes, customerData, commitPlanName]);

    // Handle Order History button click
    const handleOrderHistory = () => {
        navigate('/payment-history', {
            state: {
                customer: customerData,
                // PaymentHistory only reads cableDetails.body.op_id (falls back to
                // customerData/user op_id). Synthesise it from the authenticated
                // customerData instead of the removed cblCustDet call.
                cableDetails: { body: { op_id: customerData?.op_id || getUser()?.op_id } },
                serviceType: 'fofi', // Indicate this is FoFi order history
                fofiboxid: fofiServiceDetails?.boxId || '' // Pass FoFi box ID for order history API
            }
        });
    };

    // Guard + auto-retry on backend operator-sync errors
    // (see src/utils/kycRetry.js).
    const uploadRequestInFlightRef = useRef(false);
    const handleUploadDocument = async () => {
        if (uploadRequestInFlightRef.current) return;
        uploadRequestInFlightRef.current = true;
        try {
            setIsUploadingDocument(true);
            const cid = customerData?.customer_id || customerData?.username;
            const response = await loadKycWithRetry({ cid, reqtype: 'update' });

            if (response?.status?.err_code === 0) {
                navigate('/upload-documents', {
                    state: {
                        customer: customerData,
                        kycData: response.body
                    }
                });
            } else {
                toast.add('Failed to load documents: ' + (response?.status?.err_msg || 'Unknown error'), { type: 'error' });
            }
        } catch (err) {
            console.error('Error loading document preview:', err);
            toast.add('Failed to load documents. Please try again.', { type: 'error' });
        } finally {
            setIsUploadingDocument(false);
            uploadRequestInFlightRef.current = false;
        }
    };

    // Treat FoFi service as expired when its expiry date parses to a
    // real date strictly before now. `isExpiredDate` handles the
    // backend's DD-MM-YYYY / DD-MM-YYYY HH:mm:ss am/pm formats as
    // well as ISO — `new Date()` alone returns NaN on DD-MM-YYYY,
    // which previously made every expired customer look active.
    const isFofiExpired = isExpiredDate(fofiServiceDetails?.expiryDate);
    const hasConfirmedFofiService = hasFofiService && isConfirmedFofiServiceDetails(fofiServiceDetails);
    // Cable-TV fallback card (customer has cable TV, no FoFi box).
    const selectedCableBox = !hasConfirmedFofiService
        ? (cableTvBoxes[selectedCableBoxIdx] || cableTvBoxes[0] || null)
        : null;
    const isCheckingFofiService = hasFofiService && !hasConfirmedFofiService && (
        String(fofiServiceDetails?.planName || '').toLowerCase().startsWith('loading') ||
        String(fofiServiceDetails?.expiryDate || '').toLowerCase().startsWith('loading')
    );

    // Pay Bill — fetches FoFi payment info then navigates to the FoFi
    // payment review page (same path as the upgrade flow).
    const handlePayBill = async () => {
        try {
            setIsLoading(true);
            const userid = customerData?.username || customerData?.customer_id;
            const user = getUser();
            const loginuname = user?.username || '';
            const assignedDerived = deriveFofiOverviewFromAssigned(fofiAssignedItems);
            let assignedSnapshot = fofiAssignedItems;
            let planDetailsSnapshot = fofiPlanDetailsRaw;
            let fofiBoxId = firstTrimmedValue(
                fofiServiceDetails?.fofiboxid,
                fofiServiceDetails?.boxId,
                assignedDerived?.boxId,
                fofiAssignedItems?.body?.fofi?.[0]?.fofiboxid
            );

            if (!fofiBoxId || !planDetailsSnapshot?.body) {
                // Single call — servkey "multi" already returns the fofi/voip/internet
                // union. See the note on the mount batch above.
                assignedSnapshot = await getUserAssignedItems('multi', userid, true).catch(() => null);
                const freshDerived = deriveFofiOverviewFromAssigned(assignedSnapshot);
                if (assignedSnapshot) setFofiAssignedItems(assignedSnapshot);
                fofiBoxId = firstTrimmedValue(fofiBoxId, freshDerived?.boxId);
                if (freshDerived?.hasFofi && freshDerived?.serviceDetails) {
                    setHasFofiService(true);
                    setFofiServiceDetails(prev => ({
                        ...(prev || {}),
                        ...freshDerived.serviceDetails,
                        planName: isMeaningfulFoFiValue(prev?.planName) ? prev.planName : freshDerived.serviceDetails.planName,
                        expiryDate: isMeaningfulFoFiValue(prev?.expiryDate) ? prev.expiryDate : freshDerived.serviceDetails.expiryDate,
                        ottPlanId: prev?.ottPlanId || freshDerived.serviceDetails.ottPlanId,
                    }));
                }
            }

            // Fire the plan-details refresh and the plan-catalog fetch
            // CONCURRENTLY — they're independent (resolvePayBillPlanIds below
            // consumes both, neither feeds the other), and each is SKIPPED when
            // we already have the data:
            //   • plan refresh: skipped when the mount already cached plan
            //     details into state (planDetailsSnapshot.body present). The old
            //     code re-fetched getMyPlanDetails on EVERY PAY BILL with
            //     skipCache=true — a redundant network call that, on the slow
            //     backend, is the bulk of the 10–15s wait when the operator
            //     arrived straight from the overview (which already has it).
            //   • catalog: skipped when upgradePlans is already populated.
            // Warm path (arrived from overview) now fires nothing here.
            const needPlanRefresh = !!fofiBoxId && !planDetailsSnapshot?.body;
            const needCatalog = !(upgradePlans && upgradePlans.length > 0);
            const [freshPlanDetails, plansResponse] = await Promise.all([
                needPlanRefresh
                    ? getMyPlanDetails({ servicekey: 'fofi', userid, fofiboxid: fofiBoxId, voipnumber: '' }, true).catch(() => null)
                    : Promise.resolve(null),
                needCatalog
                    ? getFofiUpgradePlans({ logUname: loginuname, moduletype: "upgradation", userid }).catch(() => null)
                    : Promise.resolve(null),
            ]);

            if (freshPlanDetails?.body) {
                planDetailsSnapshot = freshPlanDetails;
                setFofiPlanDetailsRaw(freshPlanDetails);
                const fofiSvc = findFoFiSubscribedService(freshPlanDetails);
                if (fofiSvc) {
                    setFofiServiceDetails(prev => prev ? {
                        ...prev,
                        planName: firstTrimmedValue(fofiSvc.planname, fofiSvc.plan_name, prev.planName),
                        expiryDate: firstTrimmedValue(fofiSvc.expirydate, fofiSvc.expiry_date, fofiSvc.expdate, prev.expiryDate),
                        ottPlanId: firstTrimmedValue(fofiSvc.internet_planid, fofiSvc.srvid, fofiSvc.planid, prev.ottPlanId),
                        _rawFofiSvc: fofiSvc,
                    } : prev);
                }
            }

            // Resolve the purchasable-plan catalog. For an expired subscription
            // the current plan must map to a valid plan id BEFORE opening
            // payment, and the catalog name-match is the reliable source.
            let planCatalog = (upgradePlans && upgradePlans.length > 0) ? upgradePlans : [];
            if (planCatalog.length === 0 && plansResponse) {
                const catalog = flattenFoFiPlanCatalog(plansResponse);
                if (catalog.length > 0) {
                    const mappedCatalog = catalog.map((plan, idx) => ({
                        ...plan,
                        _source: 'fofi',
                        _uniqueKey: `paybill_${plan.planid ?? plan.srvid ?? plan.servid ?? plan.id ?? idx}_${plan.planname || plan.serv_name || plan.plan_name || ''}`,
                    }));
                    planCatalog = mappedCatalog;
                    setUpgradePlans(prev => prev.length > 0 ? prev : mappedCatalog);
                }
            }

            let resolvedPlan = resolvePayBillPlanIds({
                planDetails: planDetailsSnapshot,
                serviceDetails: fofiServiceDetails,
                assignedItems: assignedSnapshot,
                planCatalog,
            });

            let planId = resolvedPlan.planid;
            let priceId = resolvedPlan.priceid || '99';
            let servId = resolvedPlan.servid || '3';

            if (!fofiBoxId) {
                toast.add('Could not determine FoFi Box ID for PAY BILL. Please refresh and try again.', { type: 'error' });
                return;
            }

            if (!planId) {
                toast.add('Could not determine current FoFi plan for PAY BILL. Please refresh and try again.', { type: 'error' });
                return;
            }

            const requestPaymentInfo = (pid, prid, svid) => getFofiPaymentInfo({
                fofi_box_id: fofiBoxId,
                planid: pid,
                priceid: prid,
                servapptype: 'crmapp',
                servid: svid,
                userid: userid,
                username: loginuname,
                voipnumber: '',
            });

            const isInvalidPlanError = (resp) => {
                const msg = String(resp?.status?.err_msg || '').toLowerCase();
                return msg.includes('invalid plan')
                    || msg.includes('choose valid')
                    || msg.includes('plan id')
                    || msg.includes('planid');
            };

            let payInfoResponse = await requestPaymentInfo(planId, priceId, servId);

            // Safety net: if the backend still rejects the plan (e.g. a
            // stale id was the only thing we could resolve from an expired
            // subscription), re-resolve strictly from the catalog by the
            // current plan name and retry ONCE before surfacing the error.
            if (payInfoResponse?.status?.err_code !== 0
                && isInvalidPlanError(payInfoResponse)
                && resolvedPlan.source !== 'plan-catalog-name-match') {
                const catalogPlan = matchFoFiCatalogByName(planCatalog, resolvedPlan.planName || fofiServiceDetails?.planName);
                if (catalogPlan?.planid && catalogPlan.planid !== planId) {
                    resolvedPlan = { ...catalogPlan, planName: catalogPlan.planName || resolvedPlan.planName, source: 'plan-catalog-name-match' };
                    planId = resolvedPlan.planid;
                    priceId = resolvedPlan.priceid || '99';
                    servId = resolvedPlan.servid || '3';
                    payInfoResponse = await requestPaymentInfo(planId, priceId, servId);
                }
            }

            if (payInfoResponse?.status?.err_code !== 0) {
                toast.add(payInfoResponse?.status?.err_msg || 'Failed to get payment info', { type: 'error' });
                return;
            }

            const paymentBody = Array.isArray(payInfoResponse?.body)
                ? (payInfoResponse.body[0] || {})
                : (payInfoResponse?.body || {});

            const taxDetails = paymentBody?.tax_details || [];
            const cgstObj = taxDetails.find(t => t.title?.toUpperCase() === 'CGST');
            const sgstObj = taxDetails.find(t => t.title?.toUpperCase() === 'SGST');
            const cgst = cgstObj?.amt || 0;
            const sgst = sgstObj?.amt || 0;
            const extractedPlanRate = parseFloat(paymentBody?.planrate) || 0;
            const extractedTotal = paymentBody?.total_amt || 0;
            const otherCharges = paymentBody?.other_amt || 0;
            const balanceAmount = paymentBody?.balance_amt || 0;
            const operatorShare = paymentBody?.oprtrshare || 0;
            const amountDeductable = resolveFoFiAmountDeductable(paymentBody, resolvedPlan.planName || fofiServiceDetails?.planName);

            navigate('/fofi-payment', {
                state: {
                    userid: userid,
                    fofiboxid: fofiBoxId,
                    planid: planId,
                    priceid: priceId,
                    servid: servId,
                    loginuname: loginuname,
                    paytype: 'upgrade',
                    transactionid: paymentBody?.transactionid || '',
                    walletBalance: 0,
                    paymentDetails: {
                        "Plan Name": paymentBody?.planname || resolvedPlan.planName || fofiServiceDetails?.planName || "N/A",
                        "Plan Rate": extractedPlanRate,
                        "CGST": cgst,
                        "SGST": sgst,
                        "Other Charges": otherCharges,
                        "Balance Amount": balanceAmount,
                        "Total Amount": extractedTotal,
                    },
                    moreDetails: {
                        "Operator Share": operatorShare,
                        "Amount Deductable": amountDeductable,
                    },
                    noofmonth: 1,
                    amountDeductable,
                    customer: customerData,
                    planName: paymentBody?.planname || resolvedPlan.planName || fofiServiceDetails?.planName || "N/A",
                    planRate: extractedPlanRate,
                    totalAmount: extractedTotal,
                    operatorShare,
                },
            });
        } catch (error) {
            toast.add('Failed to get payment info: ' + (error?.message || 'Unknown error'), { type: 'error' });
        } finally {
            setIsLoading(false);
        }
    };

    // =====================================================
    // UPGRADE BUTTON HANDLER - Fetch upgrade plans and show services screen
    // BOTH existing and new users use registrationNecessities API for plans
    // =====================================================
    const handleUpgradeClick = async () => {
        const userid = customerData?.username || customerData?.customer_id;
        const user = getUser();
        const logUname = user?.username || 'superadmin';
        const isRetryableOperatorSyncError = (response) => {
            const msg = String(response?.status?.err_msg || '').toLowerCase();
            return msg.includes('operator is disabled') ||
                msg.includes('not a valid user to register') ||
                msg.includes('device not belongs op');
        };
        // A single transient fetch failure ("Failed to fetch", timeout) used to
        // bubble straight up as a fatal network error with NO retry — the cause
        // of "ADD FO-FI BOX shows Loading… then network error on a good
        // connection". Mobile radios drop the odd request even on healthy wifi,
        // and the ~6-per-origin connection pool (see navigationController.js)
        // gets saturated by the parallel detail fetches. Retry a couple of
        // times before giving up. Genuine navigation cancels are re-thrown so
        // they aren't mistaken for a recoverable blip.
        const withNetworkRetry = async (fn, attempts = 3, delayMs = 1200) => {
            let lastErr;
            for (let i = 1; i <= attempts; i += 1) {
                try {
                    return await fn();
                } catch (err) {
                    if (err?.message?.includes('navigated away')) throw err;
                    lastErr = err;
                    if (i === attempts) break;
                    await new Promise(resolve => setTimeout(resolve, delayMs));
                }
            }
            throw lastErr;
        };
        const validateNewUserUpgradeEligibility = async () => {
            let lastValidation = null;
            let lastError = null;

            for (let attempt = 1; attempt <= 3; attempt += 1) {
                let validateResponse;
                try {
                    // validate is the eligibility gate. Use the 5-min validate
                    // cache (warmed by the overview when it renders the not-opted
                    // state, and by prefetch.js on service selection). Only
                    // successful validations are cached, so a cached hit can never
                    // mask an "Operator is disabled" error — and skipping the fresh
                    // 6-8s call is what makes ADD FO-FI BOX open the plan list
                    // quickly.
                    validateResponse = await validateBeforeFofiBoxReg({ username: userid, loginuname: logUname });
                    lastValidation = validateResponse;
                    lastError = null;
                } catch (err) {
                    if (err?.message?.includes('navigated away')) throw err;
                    // Transient network blip — retry instead of hard-failing.
                    lastError = err;
                    if (attempt === 3) throw err;
                    await new Promise(resolve => setTimeout(resolve, 1200));
                    continue;
                }

                if (validateResponse?.status?.err_code === 0) {
                    return { validateResponse };
                }
                if (!isRetryableOperatorSyncError(validateResponse) || attempt === 3) {
                    return { validateResponse };
                }
                await new Promise(resolve => setTimeout(resolve, 2500));
            }

            if (lastError) throw lastError;
            return { validateResponse: lastValidation };
        };

        console.log('🔵 [UPGRADE] Starting upgrade flow...');
        console.log('🔵 [UPGRADE] User ID:', userid);
        console.log('🔵 [UPGRADE] Log Username:', logUname);
        console.log('🔵 [UPGRADE] hasFofiService:', hasFofiService);

        // Kick the plans fetch off NOW so it runs IN PARALLEL with the
        // not-opted eligibility validation below, instead of waiting for
        // that whole stage to finish first. The plan list doesn't depend
        // on the validate *response* (validate only gates whether we show
        // the plans), so overlapping the two network stages roughly halves
        // the happy-path wait. getFofiUpgradePlans caches on success, so
        // awaiting this same promise at the existing-user stage below is
        // free. The detached catch keeps a rejection from surfacing as an
        // unhandled rejection if validation fails and we bail out early.
        const plansPromise = withNetworkRetry(() => getFofiUpgradePlans({
            logUname: logUname,
            moduletype: "upgradation",
            userid: userid,
        }));
        plansPromise.catch(() => {});

        // ── NEW USER (NOT OPTED) — eligibility gate ──
        // Earlier this branch jumped straight to enterSubView('link-fofi'),
        // which is the SINGLE-page Box-ID + MAC + plan-dropdown flow
        // used when the operator arrives from the Internet service
        // (Internet → Link FoFi Box). Operator confirmed (May 2026)
        // that the FoFi Smart Box UPGRADE button must NOT use that
        // shortcut — it must take the operator to the SAME Services
        // plan-picker that existing users see (upgrade-plans view),
        // so they choose a plan FIRST, then link the box.
        //
        // What we keep from the old branch: validateBeforeFofiBoxReg
        // (eligibility check — the "Operator is disabled" message
        // comes from this call) and the customer-details refresh.
        // After validation passes we fall through to the shared
        // getFofiUpgradePlans path below — same API, same view.
        if (!hasConfirmedFofiService) {
            setUpgradePlansLoading(true);
            setUpgradePlansError('');
            try {
                console.log('🔵 [UPGRADE] Not-opted user — validating eligibility before showing plans…');
                const { validateResponse } = await validateNewUserUpgradeEligibility();

                if (validateResponse?.status?.err_code !== 0) {
                    const errorMsg = validateResponse?.status?.err_msg || 'Validation failed. Please try again.';
                    console.error('❌ [UPGRADE] Validation failed:', errorMsg);
                    setUpgradePlansError(errorMsg);
                    setUpgradePlansLoading(false);
                    return;
                }

                // Reset any pre-selected plan / box state from a
                // prior visit so the link-fofi step (after plan
                // pick) starts clean.
                setSelectedPlan(null);
                setBoxId('');
                setMacAddress('');
                setSerialNumber('');
                setDeviceInfo(null);
                setDeviceValidated(false);
                setValidationError('');
                // Fall through to the shared upgrade-plans fetch
                // below — same flow as existing users from here on.
            } catch (error) {
                console.error('❌ [UPGRADE] Error validating new user:', error);
                setUpgradePlansError(error?.message || 'An error occurred. Please try again.');
                setUpgradePlansLoading(false);
                return;
            }
        }

        // ── EXISTING USER (UPGRADE) PATH — plan list + payment as before ──
        setUpgradePlansLoading(true);
        setUpgradePlansError('');
        setUpgradePlans([]);
        setFilteredUpgradePlans([]);
        setUpgradeSearchTerm('');
        setIsUpgradeLinkContinuation(false);

        try {
            // Fire plans fetch (existing users). Wrapped in withNetworkRetry so a
            // single transient fetch failure on this second network stage doesn't
            // surface as a fatal network error — same blip class as the validate
            // call above. getFofiUpgradePlans caches on success, so retries are cheap.
            console.log('🔵 [UPGRADE] Awaiting plans (fired in parallel above)...');
            const plansResponse = await plansPromise;
            console.log('🟢 [UPGRADE] registrationNecessities Response:', plansResponse);
            
            if (plansResponse?.status?.err_code === 0) {
                // Log the FULL response body to find planid field
                console.log('✅ [UPGRADE] Full response body:', JSON.stringify(plansResponse?.body, null, 2));
                console.log('✅ [UPGRADE] Response body keys:', Object.keys(plansResponse?.body || {}));
                
                // Check ALL plan arrays in response
                console.log('✅ [UPGRADE] === Checking all plan arrays ===');
                console.log('✅ [UPGRADE] ott_plans:', plansResponse?.body?.ott_plans);
                console.log('✅ [UPGRADE] internet_plans:', plansResponse?.body?.internet_plans?.length || 0, 'plans');
                console.log('✅ [UPGRADE] fofi_plans:', plansResponse?.body?.fofi_plans);
                console.log('✅ [UPGRADE] cable_plans:', plansResponse?.body?.cable_plans);
                console.log('✅ [UPGRADE] plans:', plansResponse?.body?.plans);
                
                // Check fofi_plans for OTT/FoFi plan IDs (planid like "55")
                // Build a map of FoFi plans by name for cross-referencing with internet_plans
                const fofiPlansArray = plansResponse?.body?.fofi_plans || plansResponse?.body?.ott_plans || [];
                console.log('✅ [UPGRADE] fofi_plans array:', fofiPlansArray);

                if (fofiPlansArray.length > 0) {
                    console.log('✅ [UPGRADE] FoFi Plans found! Count:', fofiPlansArray.length);
                    console.log('✅ [UPGRADE] First FoFi plan:', JSON.stringify(fofiPlansArray[0], null, 2));
                    console.log('✅ [UPGRADE] FoFi plan keys:', Object.keys(fofiPlansArray[0]));

                    // Create a map of plan names to FoFi/OTT plan IDs
                    // The fofi_plans should have the correct planid (like "55") that the payment API needs
                    const fofiMap = {};
                    fofiPlansArray.forEach(plan => {
                        const planName = plan.serv_name || plan.planname || plan.plan_name || plan.name || '';
                        // The FoFi plan ID could be in various fields - srvid, planid, servid, or id
                        const fofiPlanId = plan.srvid || plan.planid || plan.servid || plan.id || '';
                        console.log(`✅ [UPGRADE] FoFi plan: "${planName}" -> srvid:${plan.srvid}, planid:${plan.planid}, servid:${plan.servid}, id:${plan.id}`);
                        if (planName && fofiPlanId) {
                            fofiMap[planName.toLowerCase()] = String(fofiPlanId);
                            console.log(`✅ [UPGRADE] FoFi Map: "${planName}" -> ${fofiPlanId}`);
                        }
                    });
                    setOttPlansMap(fofiMap);
                    console.log('✅ [UPGRADE] FoFi Plans Map:', fofiMap);
                } else {
                    console.log('⚠️ [UPGRADE] No FoFi/OTT plans found in response');
                }

                // PLAN DISPLAY LOGIC:
                // - NEW USERS: Display ONLY fofi_plans (FoFi-box specific plans)
                // - EXISTING USERS: Display ALL plans from the API (all available plan arrays)
                let plans = [];
                let plansSource = 'none';

                if (hasConfirmedFofiService) {
                    // EXISTING USER - Show ALL FoFi/OTT compatible plans from the API
                    // Note: Only fofi_plans and ott_plans work with the paymentinfo/fofi API
                    // internet_plans and cable_plans use different payment flows
                    console.log('✅ [UPGRADE] Existing user - loading ALL FoFi/OTT plans');

                    // Collect all FoFi-compatible plan arrays with unique keys
                    const allPlans = [];
                    const seenPlanKeys = new Set(); // Track seen plans to avoid duplicates

                    // Helper to add plans with unique key and source tracking
                    const addPlansWithSource = (planArray, source) => {
                        planArray.forEach((plan, idx) => {
                            const planId = plan.planid || plan.servid || plan.srvid || plan.id || idx;
                            const planName = plan.planname || plan.serv_name || plan.plan_name || '';
                            const uniqueKey = `${source}_${planId}_${planName}`;

                            // Skip if we've already seen this plan (deduplicate)
                            if (!seenPlanKeys.has(uniqueKey)) {
                                seenPlanKeys.add(uniqueKey);
                                allPlans.push({
                                    ...plan,
                                    _source: source,
                                    _uniqueKey: uniqueKey
                                });
                            }
                        });
                    };

                    // Add fofi_plans (primary - contains correct planid for payment API)
                    if (fofiPlansArray.length > 0) {
                        addPlansWithSource(fofiPlansArray, 'fofi');
                        console.log('✅ [UPGRADE] Added fofi_plans:', fofiPlansArray.length);
                    }

                    // Add ott_plans (if different from fofi_plans - also compatible with FoFi payment API)
                    const ottPlans = plansResponse?.body?.ott_plans || [];
                    if (ottPlans.length > 0 && ottPlans !== fofiPlansArray) {
                        addPlansWithSource(ottPlans, 'ott');
                        console.log('✅ [UPGRADE] Added ott_plans:', ottPlans.length);
                    }

                    // Note: internet_plans and cable_plans are NOT added as they use different payment APIs
                    // If needed in future, they should use their respective payment endpoints

                    plans = allPlans;
                    plansSource = 'fofi_ott_plans (existing user)';
                    console.log('✅ [UPGRADE] Total FoFi/OTT plans for existing user (after dedup):', plans.length);
                } else {
                    // NEW USER - Show ONLY fofi_plans (FoFi-box specific plans)
                    console.log('✅ [UPGRADE] New user - loading only FoFi-box plans');
                    if (fofiPlansArray.length > 0) {
                        plans = fofiPlansArray.map((plan, idx) => ({
                            ...plan,
                            _source: 'fofi',
                            _uniqueKey: `fofi_${plan.planid || plan.srvid || idx}_${plan.planname || ''}`
                        }));
                        plansSource = 'fofi_plans (new user)';
                        console.log('✅ [UPGRADE] Using fofi_plans ONLY for new user (contains correct planid)');
                    }
                }
                
                console.log('✅ [UPGRADE] Using plans from:', plansSource);
                console.log('✅ [UPGRADE] Plans count:', plans.length);
                if (plans.length > 0) {
                    console.log('✅ [UPGRADE] First plan (FULL):', JSON.stringify(plans[0], null, 2));
                    console.log('✅ [UPGRADE] First plan keys:', Object.keys(plans[0]));
                    
                    // Look for ANY field with small numbers (like 55)
                    Object.entries(plans[0]).forEach(([key, value]) => {
                        if (typeof value === 'number' && value < 200) {
                            console.log(`✅ [UPGRADE] Small number field: ${key} = ${value}`);
                        }
                        if (key.toLowerCase().includes('plan') || key.toLowerCase().includes('id')) {
                            console.log(`✅ [UPGRADE] ID-related field: ${key} =`, value);
                        }
                    });
                    
                    if (plans[0].serv_rates) {
                        console.log('✅ [UPGRADE] First plan serv_rates (FULL):', JSON.stringify(plans[0].serv_rates, null, 2));
                        console.log('✅ [UPGRADE] serv_rates keys:', Object.keys(plans[0].serv_rates));
                        
                        // Look for planid inside serv_rates
                        Object.entries(plans[0].serv_rates).forEach(([key, value]) => {
                            console.log(`✅ [UPGRADE] serv_rates.${key} =`, value);
                        });
                    }
                }
                
                if (Array.isArray(plans) && plans.length > 0) {
                    setUpgradePlans(plans);
                    setFilteredUpgradePlans(plans);
                    enterSubView('upgrade-plans');
                } else {
                    setUpgradePlansError('No upgrade plans available at the moment.');
                }
            } else {
                const errorMsg = plansResponse?.status?.err_msg || 'Failed to fetch upgrade plans.';
                setUpgradePlansError(errorMsg);
            }
            
            setUpgradePlansLoading(false);
        } catch (error) {
            console.error('❌ [UPGRADE] Error in upgrade flow:', error);
            setUpgradePlansError('An error occurred while fetching upgrade plans. Please try again.');
        } finally {
            setUpgradePlansLoading(false);
        }
    };

    // Filter upgrade plans based on search term
    const handleUpgradeSearch = (term) => {
        setUpgradeSearchTerm(term);
        if (!term) {
            setFilteredUpgradePlans(upgradePlans);
            return;
        }

        const lowerTerm = term.toLowerCase();
        const filtered = upgradePlans.filter(plan => {
            const name = plan.planname || plan.serv_name || plan.plan_name || plan.name || '';
            const price = String(plan.planrate || plan.serv_rates?.prices?.[0] || plan.price || '');
            return name.toLowerCase().includes(lowerTerm) ||
                plan.serv_desc?.toLowerCase().includes(lowerTerm) ||
                price.includes(term);
        });
        setFilteredUpgradePlans(filtered);
    };

    // Select an upgrade plan (supports both fofi_plans and internet_plans)
    const handleUpgradePlanSelect = async (plan) => {
        console.log('🔵 [UPGRADE] Plan selected:', plan);
        console.log('🔵 [UPGRADE] Plan keys:', Object.keys(plan));
        console.log('🔵 [UPGRADE] Plan source:', plan._source);

        // Get plan ID - supports both planid (fofi_plans) and servid (internet_plans)
        const planIdentifier = plan.planid || plan.servid || plan.srvid || plan.id;
        console.log('🔵 [UPGRADE] Plan ID:', planIdentifier, '(planid:', plan.planid, ', servid:', plan.servid, ')');

        // Validate that some ID exists (required for payment API)
        if (!planIdentifier) {
            console.error('❌ [UPGRADE] No plan ID found! This plan cannot be used for payment.');
            toast.add('Error: This plan does not have a valid Plan ID. Please select another plan.', { type: 'error' });
            return;
        }

        // Get the plan price - supports both fofi_plans (planrate) and internet_plans (serv_rates.prices)
        let planPrice = plan.planrate || plan.price || plan.amount || 0;

        // For internet_plans, extract price from serv_rates
        if (!planPrice && plan.serv_rates?.prices?.length > 0) {
            planPrice = plan.serv_rates.prices[0];
        }

        const numericPrice = parseFloat(String(planPrice).replace(/[^0-9.]/g, '')) || 0;

        console.log('🔵 [UPGRADE] Plan price:', planPrice, 'Numeric:', numericPrice);

        // FTA plans legitimately have ₹0 price — allow them to proceed
        setSelectedPlan(plan);

        // A FoFi box that is ALREADY LINKED goes straight to the Services
        // Subscription → payment flow — native runs the IDENTICAL
        // UPGRADE PLAN → SUBMIT → paymentinfo path whether or not the box
        // currently has an active plan (verified: the same user/box with a
        // blank plan still reaches Review → PROCEED TO PAY → success, with no
        // freeOTAService / upgradeRegistration / validateAsset).
        //
        // "Already linked" = a confirmed service (has active plan) OR a
        // linked-device-with-no-plan (the box exists in getUserAssignedItems
        // but has no active plan → fofiServiceDetails was nulled at overview
        // load and the box stashed in linkedDeviceNoPlan). BOTH must use
        // subscription-confirm; only a genuinely NEW box (never linked) uses
        // the freeOTAService link path.
        const linkedNoPlanBox = (!hasConfirmedFofiService && linkedDeviceNoPlan &&
            isMeaningfulFoFiValue(linkedDeviceNoPlan.boxId || linkedDeviceNoPlan.macAddress))
            ? linkedDeviceNoPlan : null;

        if ((hasConfirmedFofiService && fofiServiceDetails) || linkedNoPlanBox) {
            // EXISTING / already-linked box → Services Subscription screen.
            console.log('🔵 [UPGRADE] Linked box (active plan:', hasConfirmedFofiService, ') → subscription-confirm');
            if (!fofiServiceDetails && linkedNoPlanBox) {
                // No active plan → fofiServiceDetails is null. Seed it from the
                // linked box so the confirm screen shows the Box ID and
                // handleSubscriptionSubmit has box/mac/serial to send to
                // paymentinfo. hasFofiService stays false, so the overview and
                // hasConfirmedFofiService are unaffected (no active plan seeded).
                setFofiServiceDetails({
                    boxId: linkedNoPlanBox.boxId || '',
                    macAddress: linkedNoPlanBox.macAddress || '',
                    serialNumber: linkedNoPlanBox.serialNumber || '',
                    deviceType: linkedNoPlanBox.deviceType || null,
                    _rawFofiItem: {},
                });
            }
            setIsLinkedDeviceSubscription(false);
            enterSubView('subscription-confirm');
        } else {
            // GENUINELY NEW box (never linked) → link-fofi entry/scan flow.
            setIsLinkedDeviceSubscription(false);
            setIsUpgradeLinkContinuation(true);
            enterSubView('link-fofi');
        }
    };
    
    // Handle SUBMIT from subscription confirmation screen (existing users)
    const handleSubscriptionSubmit = async () => {
        if (!selectedPlan || !fofiServiceDetails) {
            toast.add('Please select a plan first', { type: 'error' });
            return;
        }
        
        console.log('🔵 [SUBSCRIPTION] Submitting subscription...');
        setIsLoading(true);
        
        try {
            const user = getUser();
            const loginuname = user?.username || 'superadmin';
            const username = customerData?.username || customerData?.customer_id;
            
            // Get FoFi box details from existing service
            // CRITICAL: Use raw fofiboxid from _rawFofiItem — backend expects the
            // original API field value, not the processed/displayed boxId.
            // The _rawFofiItem contains the original getUserAssignedItems response.
            const _sanitize = (v) => (!v || v === 'N/A') ? '' : v;
            const rawItem = fofiServiceDetails._rawFofiItem || {};
            const fofiBoxId = _sanitize(rawItem.fofiboxid || rawItem.fofi_box_id || rawItem.boxid || fofiServiceDetails.boxId);
            const fofiMac = _sanitize(rawItem.mac || rawItem.macid || rawItem.mac_addr || fofiServiceDetails.macAddress);
            const fofiSerial = _sanitize(rawItem.fserialno || rawItem.serial_number || rawItem.serialno || rawItem.fofiserailnumber || fofiServiceDetails.serialNumber);

            // Debug: log raw API data to help identify correct field names
            console.log('🔵 [SUBSCRIPTION] Raw fofiItem fields:', JSON.stringify(fofiServiceDetails._rawFofiItem, null, 2));
            console.log('🔵 [SUBSCRIPTION] Raw fofiSvc fields:', JSON.stringify(fofiServiceDetails._rawFofiSvc, null, 2));
            console.log('🔵 [SUBSCRIPTION] Sanitized → boxId:', fofiBoxId, '| mac:', fofiMac, '| serial:', fofiSerial);

            // Validate box ID before calling API
            if (!fofiBoxId) {
                toast.add('FoFi Box ID not found. Please contact support.', { type: 'error' });
                setIsLoading(false);
                return;
            }


            // Log ALL plan fields exhaustively to find planid like "55"
            console.log('🔵 [SUBSCRIPTION] ========== FULL PLAN ANALYSIS ==========');
            console.log('🔵 [SUBSCRIPTION] Full plan object (JSON):', JSON.stringify(selectedPlan, null, 2));
            console.log('🔵 [SUBSCRIPTION] All plan keys:', Object.keys(selectedPlan));
            
            // Check all possible planid fields
            console.log('🔵 [SUBSCRIPTION] === Direct plan fields ===');
            console.log('  plan.id:', selectedPlan.id);
            console.log('  plan.planid:', selectedPlan.planid);
            console.log('  plan.plan_id:', selectedPlan.plan_id);
            console.log('  plan.srvid:', selectedPlan.srvid);
            console.log('  plan.servid:', selectedPlan.servid);
            console.log('  plan.service_id:', selectedPlan.service_id);
            console.log('  plan.fofi_planid:', selectedPlan.fofi_planid);
            console.log('  plan.ott_planid:', selectedPlan.ott_planid);
            
            // Check serv_rates deeply
            if (selectedPlan.serv_rates) {
                console.log('🔵 [SUBSCRIPTION] === serv_rates fields ===');
                console.log('  serv_rates (JSON):', JSON.stringify(selectedPlan.serv_rates, null, 2));
                console.log('  serv_rates keys:', Object.keys(selectedPlan.serv_rates));
                console.log('  serv_rates.planid:', selectedPlan.serv_rates.planid);
                console.log('  serv_rates.plan_id:', selectedPlan.serv_rates.plan_id);
                console.log('  serv_rates.id:', selectedPlan.serv_rates.id);
                console.log('  serv_rates.srvid:', selectedPlan.serv_rates.srvid);
                console.log('  serv_rates.servid:', selectedPlan.serv_rates.servid);
                console.log('  serv_rates.priceid:', selectedPlan.serv_rates.priceid);
            }
            
            // Check if there's a rates array
            if (selectedPlan.rates) {
                console.log('🔵 [SUBSCRIPTION] === rates array ===');
                console.log('  rates:', selectedPlan.rates);
            }
            
            // Check plan_details
            if (selectedPlan.plan_details) {
                console.log('🔵 [SUBSCRIPTION] === plan_details ===');
                console.log('  plan_details:', JSON.stringify(selectedPlan.plan_details, null, 2));
            }
            
            console.log('🔵 [SUBSCRIPTION] ========================================');
            
            // Extract plan details
            const servRates = selectedPlan.serv_rates || {};
            const registrationFields = resolveFoFiRegistrationFields(selectedPlan);
            const planName = selectedPlan.serv_name || selectedPlan.planname || selectedPlan.plan_name || '';

            // DEBUG: Log full plan object to find correct OTT plan ID field
            console.log('🔴🔴🔴 DEBUG: selectedPlan FULL:', JSON.stringify(selectedPlan, null, 2));
            console.log('🔴🔴🔴 DEBUG: serv_rates FULL:', JSON.stringify(servRates, null, 2));
            console.log('🔴🔴🔴 DEBUG: selectedPlan keys:', Object.keys(selectedPlan));
            console.log('🔴🔴🔴 DEBUG: serv_rates keys:', Object.keys(servRates));
            console.log('🔴🔴🔴 DEBUG: ottPlansMap:', ottPlansMap);
            console.log('🔴🔴🔴 DEBUG: fofiServiceDetails:', fofiServiceDetails);
            console.log('🔴🔴🔴 DEBUG: planName:', planName);

            // PLAN ID EXTRACTION:
            // - fofi_plans: use planid
            // - internet_plans: use servid
            // Both are valid for the payment API

            // Get plan ID - supports both planid (fofi_plans) and servid (internet_plans)
            const {
                planid: resolvedPlanId,
                priceid: resolvedPriceId,
                planrate: resolvedPlanPrice,
                servid: resolvedServId,
            } = resolveFoFiPlanSelection(selectedPlan);
            const planId = String(resolvedPlanId || '');
            console.log('🔵 [SUBSCRIPTION] Using plan ID:', planId, '(source:', selectedPlan._source || 'unknown', ')');

            // Validate we have a plan ID
            if (!planId) {
                console.error('❌ [SUBSCRIPTION] No plan ID found! Selected plan:', selectedPlan);
                toast.add('Error: Plan ID not found. Please select a valid plan.', { type: 'error' });
                setIsLoading(false);
                return;
            }

            // Extract price ID and plan price - supports both plan structures
            // fofi_plans: priceid, planrate
            // internet_plans: serv_rates.priceid, serv_rates.prices[0]
            const priceId = String(resolvedPriceId || '99');

            let planPrice = selectedPlan.planrate || selectedPlan.price || resolvedPlanPrice || 0;
            // For internet_plans, extract price from serv_rates
            if (!planPrice && servRates.prices?.length > 0) {
                planPrice = servRates.prices[0];
            }

            const servId = String(resolvedServId || '3');

            console.log('🔵 [SUBSCRIPTION] Plan details - planId:', planId, 'priceId:', priceId, 'planPrice:', planPrice);
            console.log('🔵 [SUBSCRIPTION] Box details - boxId:', fofiBoxId, 'mac:', fofiMac, 'serial:', fofiSerial);
            
            // =====================================================
            // Existing-box upgrade → go straight to paymentinfo (native parity;
            // no upgradeRegistration — see the call site below).
            // =====================================================
            const paymentPayload = {
                fofi_box_id: fofiBoxId,
                planid: planId,
                priceid: priceId,
                servapptype: "crmapp",
                servid: servId,
                userid: username,
                // username here is the SYSTEM caller, not the
                // logged-in operator. Cable TV hardcodes "superadmin"
                // and works; FoFi sending the real operator name
                // (e.g. "demopwa") makes generateorder reject the
                // returned transactionid with the misleading
                // "Available balance in wallet [X] should be greater
                // than 100" message. Operator identity is sent
                // through apiopid / paydoneby in the savePaymentApi
                // step, NOT here. Keep "superadmin" verbatim.
                username: "superadmin",
                voipnumber: ""
            };

            console.log('🔵 [PAYMENTINFO] Calling paymentinfo before deferred upgrade activation...');

            let paymentResponse;
            try {
                // Native: an already-linked box upgrading its plan goes STRAIGHT to
                // payment. ServiceSubscriptionsActivity SUBMIT with an existing
                // intent_fofi_id calls GotoUpgradePayment() → service/paymentinfo,
                // with NO upgradeRegistration and NO box re-validation (verified in
                // all three native audits). This screen is only ever reached for an
                // existing FoFi customer (hasConfirmedFofiService + _rawFofiItem), so
                // upgradeRegistration is skipped entirely — calling it re-registers an
                // already-registered box and the backend returns "Requested plan not
                // found, please contact bbnl noc team".
                paymentResponse = await getFofiPaymentInfo(paymentPayload);
            } catch (stepErr) {
                console.error('❌ API network error:', stepErr);
                toast.add('Request failed: ' + (stepErr?.message || 'Network error'), { type: 'error' });
                setIsLoading(false);
                return;
            }

            console.log('🟢 Payment Info Response:', paymentResponse);

            if (paymentResponse?.status?.err_code !== 0) {
                const errorMsg = paymentResponse?.status?.err_msg || 'Failed to get payment info';
                console.error('❌ Payment info failed:', errorMsg);
                toast.add('Failed to get payment info: ' + errorMsg, { type: 'error' });
                setIsLoading(false);
                return;
            }
            
            // =====================================================
            // STEP 4: Navigate to payment page with response data
            // =====================================================
            const paymentBody = paymentResponse?.body || {};
            
            // Debug: Log the full API response structure
            console.log('🔴 [DEBUG] Full paymentBody:', JSON.stringify(paymentBody, null, 2));
            
            // API Response Structure (actual):
            // - planrate: "130.00" (string)
            // - total_amt: 153.4 (number)
            // - tax: 23.4 (total tax)
            // - tax_details: [{ title: "SGST", percent: "9%", amt: 11.7 }, { title: "CGST", percent: "9%", amt: 11.7 }]
            // - balance_amt: 0
            // - other_amt: 0
            // - oprtrshare: 153.4 (operator share)
            // - bbnl_share: "-23.40"
            // - tds: 0
            // - softwarecharges: 0
            // - fofishare: 0
            // - deduction: { title: "...", totalamount: "0.00" }
            
            // Extract tax details from tax_details array
            const taxDetails = paymentBody?.tax_details || [];
            const cgstObj = taxDetails.find(t => t.title?.toUpperCase() === 'CGST');
            const sgstObj = taxDetails.find(t => t.title?.toUpperCase() === 'SGST');
            const cgst = cgstObj?.amt || 0;
            const sgst = sgstObj?.amt || 0;
            
            // Extract amounts directly from paymentBody
            const extractedPlanRate = parseFloat(paymentBody?.planrate) || planPrice || 0;
            const extractedTotal = paymentBody?.total_amt || 0;
            const otherCharges = paymentBody?.other_amt || 0;
            const balanceAmount = paymentBody?.balance_amt || 0;
            
            // Extract share info directly from paymentBody
            const operatorShare = paymentBody?.oprtrshare || 0;
            const bbnlShare = parseFloat(paymentBody?.bbnl_share) || 0;
            const softCharge = paymentBody?.softwarecharges || 0;
            const tds = paymentBody?.tds || 0;
            const fofiShare = paymentBody?.fofishare || 0;
            
            const amountDeductable = resolveFoFiAmountDeductable(paymentBody, selectedPlan?.planname || selectedPlan?.serv_name || selectedPlan?.plan_name);

            const fofiPaymentData = {
                // Customer & Plan identifiers (using fofi_plans structure)
                userid: username,
                fofiboxid: fofiBoxId,
                planid: planId, // from fofi_plans.planid
                priceid: priceId, // from fofi_plans.priceid
                servid: servId,
                loginuname: loginuname,
                // paytype "upgrade" matches the mobile-app trace
                // (verified May 2026 by client-side log dump).
                // Earlier probes that seemed to require "renewal"
                // were running against a customer whose subscription
                // state caused every payload variant to reject —
                // the real bug was the username field.
                paytype: 'upgrade',
                transactionid: paymentBody?.transactionid || '',
                
                // Wallet balance (not in this response, default to 0)
                walletBalance: 0,
                
                // Payment details for display
                paymentDetails: {
                    "Plan Name": paymentBody?.planname || selectedPlan?.planname || "N/A",
                    "Plan Rate": extractedPlanRate,
                    "CGST": cgst,
                    "SGST": sgst,
                    "Other Charges": otherCharges,
                    "Balance Amount": balanceAmount,
                    "Total Amount": extractedTotal
                },
                
                // More details — only include non-zero positive values (matches production)
                moreDetails: {
                    "Operator Share": operatorShare,
                    ...(bbnlShare > 0 ? { "BBNL Share": bbnlShare } : {}),
                    ...(softCharge > 0 ? { "Software Charges": softCharge } : {}),
                    ...(tds > 0 ? { "TDS": tds } : {}),
                    "Amount Deductable": amountDeductable
                },

                noofmonth: 1,
                amountDeductable: amountDeductable,
                customer: customerData,
                planName: paymentBody?.planname || selectedPlan?.planname || "N/A",
                planRate: extractedPlanRate,
                totalAmount: extractedTotal,
                operatorShare: operatorShare
            };
            
            console.log('🔵 [STEP 4] Navigating to FoFi Payment with fofi_plans data:', fofiPaymentData);

            // Pop our subview history entries (upgrade-plans,
            // subscription-confirm, link-fofi etc.) BEFORE pushing
            // the /fofi-payment route. Without this, after payment
            // success the back button walks the user back through
            // those subview markers — but the component has been
            // unmounted/remounted by then so subview state is empty
            // (operator saw "No plans found", "Plan Name: N/A", etc.).
            // Cleaning the history here means back from the
            // post-payment overview lands cleanly on the customer
            // list, matching the mobile app behaviour.
            const subviewDepth = subViewDepthRef.current;
            if (subviewDepth > 0) {
                cleanupPopStateRef.current = subviewDepth;
                window.history.go(-subviewDepth);
                // history.go fires popstates on the next task; wait
                // for them to drain so the listener processes the
                // cleanup ref before we push the new route.
                await new Promise(resolve => setTimeout(resolve, 30 * subviewDepth + 30));
            }
            // Navigate to FoFi Payment Review page
            navigate('/fofi-payment', { state: fofiPaymentData });
            
        } catch (error) {
            console.error('❌ [SUBSCRIPTION] Error:', error);
            const errMsg = error?.message || 'Unknown error';
            toast.add('Failed to process subscription: ' + errMsg, { type: 'error' });
        } finally {
            setIsLoading(false);
        }
    };

    // ── Hardware back button / history support for internal views ──
    //
    // Per-transition history entries — each enterSubView pushes its
    // own marker, so phone-back walks the user one view at a time:
    //
    //   overview → upgrade-plans → subscription-confirm → payment
    //   ← back ← back ← back ← back to Choose Service
    //
    // Previously the code pushed ONE entry on first leave-from-
    // overview and treated every back press as "go to overview" —
    // that skipped intermediate steps and was the cross-cutting
    // reason QA reported "back doesn't go to previous page".
    //
    // subViewDepthRef tracks how many entries we've pushed so
    // programmatic returns (errors, post-payment) can pop exactly
    // that many — never overshooting and exiting the route.
    const subViewDepthRef = useRef(0);
    // Number of popstate events the listener should ignore because
    // we triggered them programmatically as part of pre-payment
    // history cleanup. Without this guard, the popstates fired by
    // window.history.go(-N) would each call setView() to a stale
    // subview just before we navigate away.
    const cleanupPopStateRef = useRef(0);
    const enterSubView = (newView) => {
        if (view === newView) return;
        try {
            // CRITICAL: spread the existing history state. React
            // Router stores location.state inside window.history.state
            // under its own keys (`usr`, `key`, `idx`). A bare
            // pushState({ fofiView }) wipes those — and on popstate
            // React Router rehydrates location.state as empty, which
            // is what produced the "No customer data available"
            // page and the TypeError reading customerData.name on
            // some devices.
            window.history.pushState(
                { ...(window.history.state || {}), fofiView: newView },
                ''
            );
            subViewDepthRef.current += 1;
        } catch (_) {}
        // Clear any stale validation error from a prior attempt so the
        // error popup doesn't re-appear when the user enters the scan view.
        setValidationError('');
        setView(newView);
    };
    useEffect(() => {
        // When entered from Internet Service, there is no FoFi overview to
        // return to — back should pop the route and land on Internet Service.
        // Registering this listener would override that with setView('overview').
        if (fromInternet) return;
        const onPopState = (e) => {
            // Skip this popstate if it was triggered by the QR scanner
            // closing its own history entry (not a real back navigation)
            if (skipNextPopStateRef.current) {
                skipNextPopStateRef.current = false;
                return;
            }
            // Skip this popstate if it's part of the pre-payment
            // history cleanup. We're about to navigate to /fofi-payment
            // anyway, so re-rendering an intermediate subview here
            // just creates a flicker.
            if (cleanupPopStateRef.current > 0) {
                cleanupPopStateRef.current -= 1;
                if (subViewDepthRef.current > 0) subViewDepthRef.current -= 1;
                return;
            }
            // Each pop reduces our owned-entries count.
            if (subViewDepthRef.current > 0) subViewDepthRef.current -= 1;
            // Read the fofiView marker from the entry we landed on.
            // Missing marker means we popped past all our sub-view
            // entries — back to the route's natural state (overview).
            const target = e.state?.fofiView || 'overview';
            setView(target);
        };
        window.addEventListener('popstate', onPopState);
        return () => window.removeEventListener('popstate', onPopState);
    }, [fromInternet]);

    // In-app back chevrons — call this so they share the popstate
    // path with the phone hardware back button. Keeps history and
    // view in sync regardless of which back path the user chose.
    const goBackOneView = () => { try { window.history.back(); } catch (_) {} };
    // Programmatic full-reset (errors / post-payment success). Pops
    // exactly subViewDepthRef.current entries so we land cleanly on
    // overview without overshooting and exiting the route.
    const goBackToOverview = () => {
        const depth = subViewDepthRef.current;
        if (depth > 0) {
            try { window.history.go(-depth); return; } catch (_) {}
        }
        // Already at overview, or history.go failed — just sync state.
        subViewDepthRef.current = 0;
        setView('overview');
    };

    // Open QR scanner — push a history entry so the hardware back button
    // closes the scanner instead of navigating away from the page.
    const handleQRScan = () => {
        // Clear any stale error popup from a previous scan attempt
        setValidationError('');
        window.history.pushState({ ...window.history.state, qrScanner: true }, '');
        setShowQRScanner(true);
    };

    // Close QR scanner when the user presses the hardware/OS back button.
    // On Android the hardware back key fires popstate; on iPhone a swipe-back
    // gesture does the same. In both cases the pushed entry is already popped
    // by the browser, so we only need to close the scanner UI.
    useEffect(() => {
        if (!showQRScanner) return;
        const onPopState = () => {
            setShowQRScanner(false);
        };
        window.addEventListener('popstate', onPopState);
        return () => window.removeEventListener('popstate', onPopState);
    }, [showQRScanner]);

    // Handle QR code scan result
    const handleQRCodeScanned = async (qrData) => {
        try {
            // Close scanner first, then clean up the history entry
            setShowQRScanner(false);
            // Pop the QR scanner history entry. Set the skip flag so the
            // sub-view popstate listener ignores this pop (it's not a real
            // back navigation — we're just cleaning up the scanner's entry).
            queueMicrotask(() => {
                if (window.history.state?.qrScanner) {
                    skipNextPopStateRef.current = true;
                    window.history.back();
                }
            });
            setIsLoading(true);
            setValidationError('');
            setValidationMethod('qr');

            console.log('🔵 QR Code scanned:', qrData);

            // ──────────────────────────────────────────────────────
            // Native QR-scan flow (per server log of native app):
            //
            //   1. Decode QR → extract emacid (MAC) + serialno.
            //      The QR does NOT carry the Box ID; it's the
            //      backend's job to issue it.
            //
            //   2. POST /netmon/fofi/fofiapis/validateAsset with
            //      { mac_addr, serialno, userid:"<operator>",
            //        boxid:"" }
            //      — userid is ALWAYS the logged-in operator, not
            //      the customer. boxid is empty so the backend
            //      generates / returns the canonical Box ID.
            //
            //   3. Read Box ID from the response and display it
            //      in the FOFI Box ID field. MAC stays as the QR
            //      value. Don't fall back to anything QR-encoded.
            //
            //   4. If err_code !== 0 (e.g. "device already
            //      assigned"), surface the backend message and
            //      clear MAC so the operator can't link a taken
            //      device.
            // ──────────────────────────────────────────────────────
            // Robustly read MAC + serial from the QR — handles the native
            // base64-JSON FoFi-box format AND the plain-JSON / raw-string
            // shapes the Android TV / Smart-TV apps emit (see
            // parseFofiQrPayload). Only the MAC is required; TV devices
            // don't always carry a serial.
            const { mac: qrMacAddress, serial: qrSerialNumber } = parseFofiQrPayload(qrData);
            console.log('🟢 Parsed QR data:', { mac: qrMacAddress, serial: qrSerialNumber });

            if (!qrMacAddress) {
                setValidationError('Could not read the device MAC from this QR. Please rescan the code shown on the TV, or enter the FOFI Box ID manually and tap GET MAC ID.');
                setIsLoading(false);
                return;
            }

            const opUser = getUser();
            const operatorUserId = opUser?.username || 'superadmin';

            console.log('🔵 [QR] validateAsset →', {
                mac_addr: qrMacAddress,
                serialno: qrSerialNumber,
                userid: operatorUserId,
                boxid: '',
            });

            let response;
            try {
                response = await validateFoFiAsset({
                    mac_addr: qrMacAddress,
                    serialno: qrSerialNumber,
                    userid: operatorUserId,
                    boxid: '',
                });
            } catch (validateErr) {
                if (validateErr?.message?.includes('navigated away')) return;
                console.error('❌ [QR] validateAsset threw:', validateErr);
                // Network failure — keep MAC/serial from QR so the
                // operator sees what they scanned, then surface the
                // error and let them retry.
                setMacAddress(qrMacAddress);
                setSerialNumber(qrSerialNumber);
                setBoxId('');
                setValidationError(validateErr?.message || 'Could not validate this device. Please try again.');
                setIsLoading(false);
                return;
            }
            console.log('🟢 [QR] validateAsset response:', response);

            // Deep-search helper — the backend embeds the canonical
            // Box ID in different places across success vs. error
            // responses (named field, err_msg, nested wrapper).
            //
            // The Box ID and the QR-encoded serial number are
            // DIFFERENT identifiers — verified against the live API:
            //   serialno  FOFI20190729000335
            //   mac_addr  68:1D:EF:14:6B:97
            //   boxid     bbnl-ANDBOX-... (issued by validateAsset)
            // The product owner has been explicit that the field
            // here must show the API-returned Box ID and never the
            // serial. So this regex only matches actual Box ID
            // formats (bbnl-*, BBNL_*) — never the FOFI<digits>
            // serial pattern, even though it appears in some err_msg
            // strings.
            // Pull the Box ID from named fields on the response body.
            // We trust whatever the named field carries (no pattern
            // gate here) — the API is authoritative for what the Box
            // ID is. We deliberately exclude `product_name` and
            // similar serial-bearing fields because they may carry
            // the FOFI<digits> serial which is NOT the Box ID.
            const respBody = Array.isArray(response?.body) ? (response.body[0] || {}) : (response?.body || {});
            let apiBoxId =
                respBody.boxid || respBody.box_id ||
                respBody.fofiboxid || respBody.fofi_box_id ||
                respBody.stbid || respBody.stb_id ||
                respBody.device_id || '';
            apiBoxId = String(apiBoxId || '').trim();

            // Fallback — deep search the entire response, including
            // status.err_msg, for a bbnl-style Box ID. Some backends
            // embed the canonical ID in the "already assigned"
            // message; that's still the authoritative Box ID.
            if (!apiBoxId && response) {
                // Only an ANDBOX-format id — never an operator id (BBNL_OP…) that
                // an error message like "device not belongs op(BBNL_OP981)" carries.
                apiBoxId = findAndboxBoxId(response) || '';
                if (apiBoxId) console.log('🔎 [QR] Box ID via deep search:', apiBoxId);
            }

            const apiMacAddress =
                respBody.mac_addr || respBody.macAddress || respBody.mac || respBody.macid || qrMacAddress;
            const apiSerialNumber =
                respBody.serialno || respBody.serialNumber || respBody.serial_number ||
                respBody.serial || respBody.fserialno || qrSerialNumber;
            const multicastDeviceId = respBody.multicast_id || respBody.multicastDeviceId || '';
            const unicastDeviceId = respBody.unicast_id || respBody.unicastDeviceId || '';

            // ALWAYS populate MAC + serial — they come from the QR
            // and stay valid regardless of whether the API succeeded.
            // Box ID populates ONLY from what validateAsset returned;
            // we never substitute the serial here. If the API didn't
            // return a Box ID (e.g. "device not found"), the field
            // stays blank and the operator sees the err_msg banner.
            setMacAddress(apiMacAddress);
            setSerialNumber(apiSerialNumber);
            setBoxId(apiBoxId || '');
            setDeviceInfo({
                boxId: apiBoxId,
                macAddress: apiMacAddress,
                serialNumber: apiSerialNumber,
                multicastDeviceId,
                unicastDeviceId,
            });

            const errCode = response?.status?.err_code;
            const errMsg = response?.status?.err_msg || '';

            if (errCode === 0) {
                // Fresh device — operator can pick a plan and link.
                console.log('✅ [QR] Validated:', { boxId: apiBoxId, macAddress: apiMacAddress, serialNumber: apiSerialNumber });
                setDeviceValidated(true);
                setShowValidationSuccess(true);
                setValidationError('');
            } else {
                // Backend rejected (typically "already assigned").
                // MAC + serial stay populated so operator sees what
                // they scanned. Surface the verbatim backend message.
                console.log(`📛 [QR] Backend rejected: "${errMsg}". Box ID extracted: "${apiBoxId}"`);
                setDeviceValidated(false);
                setShowValidationSuccess(false);
                setValidationError(
                    formatFoFiValidationError(response, { fallbackMac: apiMacAddress, fallbackBoxId: apiBoxId }) ||
                    'This device cannot be linked. Please rescan or check the box.'
                );
            }
        } catch (error) {
            // Navigation-controller aborts throw this message — not a
            // user-facing error. Silently drop.
            if (error?.message?.includes('navigated away')) return;
            console.error('❌ QR validation error:', error);
            // Surface the real message (backend err_msg or HTTP failure)
            // rather than hiding it behind a generic prefix.
            setValidationError(error?.message || 'Device validation failed. Please try again.');
        } finally {
            setIsLoading(false);
        }
    };

    // Handle QR scanner error
    const handleQRScanError = (error) => {
        console.error('QR scanner error:', error);
        setValidationError('QR scanner error: ' + error);
    };

    // Handle QR scanner close (Cancel / X button)
    const handleQRScannerClose = () => {
        setShowQRScanner(false);
        // Pop the QR scanner history entry. Set the skip flag so the
        // sub-view popstate listener ignores this pop.
        queueMicrotask(() => {
            if (window.history.state?.qrScanner) {
                skipNextPopStateRef.current = true;
                window.history.back();
            }
        });
    };

    // MAC fetch handler with backend integration using validateFoFiAsset API
    // API: fofi/fofiapis/validateAsset
    // Request: { mac_addr: "", serialno: "", userid: "superadmin", boxid: "BBNL-ANDBOX-00000933" }
    const handleFetchMAC = async () => {
        try {
            setValidationError('');
            setIsLoading(true);

            if (!boxId.trim()) {
                setValidationError('Please enter a Box ID');
                setIsLoading(false);
                return;
            }
            setMacAddress('');
            setSerialNumber('');
            setDeviceInfo(null);
            setDeviceValidated(false);
            setShowValidationSuccess(false);

            // Native mimic: validateAsset (FoFi box validation) applies ONLY to real
            // FoFi Android boxes (AUG-/BBNL-ANDBOX). A non-ANDBOX id is an ATV/unicast
            // device — native never FoFi-validates it (the FoFi box UI is never shown
            // for a non-FoFi device), it goes straight to payment. So skip the
            // validateAsset MAC lookup, accept the typed id, and let LINK proceed via
            // the unicast LINK_FOFIBOX → paymentinfo path (which accepts a 'TV-' id and
            // needs no FoFi MAC).
            if (!isFofiAndroidBoxId(boxId.trim())) {
                console.log('🔶 [GET MAC ID] Non-ANDBOX (ATV/unicast) id — skipping FoFi validateAsset, matching native:', boxId.trim());
                setDeviceInfo({ boxId: boxId.trim(), macAddress: '', serialNumber: '' });
                setDeviceValidated(true);
                setValidationError('');
                setIsLoading(false);
                return;
            }

            // Manual flow has NO QR fallback — if validateAsset rejects,
            // the user can't get the MAC. So we try multiple userid
            // values and use whichever the backend accepts. Production
            // saw a regression where "operator op_id" used to work and
            // now returns "not a valid user to register" for some
            // customers, while "customer username" works for others
            // (and vice versa). Trying both sequentially is the only
            // way to keep the manual flow working without a backend
            // contract guarantee.
            const opUser = getUser();
            const customerUsername = customerData?.username || customerData?.customer_id || '';
            const operatorOpId = opUser?.op_id || '';
            const operatorUsername = opUser?.username || '';

            // De-dup and order: operator username first (same as QR),
            // superadmin second (legacy/native trace), OPID third for
            // ownership checks, customer last for old compatibility.
            const useridCandidates = Array.from(new Set(
                [operatorUsername, 'superadmin', operatorOpId, customerUsername].filter(Boolean)
            ));
            if (useridCandidates.length === 0) {
                setValidationError('No valid user identifier found. Please log in again or re-open this service from the customer list.');
                setIsLoading(false);
                return;
            }

            console.log('🔵 [GET MAC ID] Calling validateAsset API...');
            console.log('🔵 [GET MAC ID] Box ID:', boxId);
            console.log('🔵 [GET MAC ID] userid candidates (in order):', useridCandidates);

            // GET MAC ID is just a MAC LOOKUP at this stage — the
            // ownership decision is made at SUBMIT (handleLinkFoFiBox
            // STEP 0 re-validates with the final Box ID + MAC).
            //
            // Strategy: try each userid candidate; collect every
            // response. ANY response that contains a MAC (in body or
            // in err_msg — backend emits the MAC even on errors like
            // "Fo-Fi device(11:1D:EF:1A:12:3F) already assigned") is
            // accepted as the result for display purposes. err_code
            // is no longer a gate here. We prefer success responses
            // when available, but fall back to a MAC-bearing error
            // response so the user sees the device's MAC.
            const extractMacFromBody = (resp) => {
                return extractFoFiMac({ body: getFoFiValidationBody(resp) });
            };
            const extractMacFromMsg = (resp) => {
                return extractFoFiMac({ status: resp?.status });
            };

            // Ownership-blocker detector — recognises every backend
            // phrasing we've seen in production for "this device is
            // already taken by another user":
            //
            //   By MAC (QR flow) → "Fo-Fi device(MAC) already assigned"
            //   By Box ID (manual) → "Device details not found" — the
            //     backend's way of saying "you don't have access to
            //     this device" when it's claimed by another op pool.
            //   Other variants → already registered / in use / linked /
            //     belongs to <op> & <not available>.
            //
            // Treating "Device details not found" as an assignment
            // conflict here is intentional: in the manual-entry path
            // the operator has already typed a real Box ID off the
            // sticker, so a "not found" response on a real-format ID
            // overwhelmingly means it's assigned, not missing.
            let successResp = null;
            let successUserid = '';
            let macResp = null;       // any response that yielded a MAC
            let macUserid = '';
            let lastErrMsg = '';
            // ownershipBlocker captures the FIRST conflict signal AND
            // any MAC seen across attempts — sometimes the MAC arrives
            // in one userid's response while the "Device details not
            // found" message arrives from another. Pooling them lets
            // us emit "FoFi device(MAC) already assigned" even when
            // the MAC and the conflict signal came from different
            // attempts.
            let ownershipBlocker = null;
            let bestMacAcrossAttempts = '';

            // Candidates are tried SEQUENTIALLY, breaking on the first clean
            // success. Do NOT parallelize/race these: the backend serializes
            // concurrent validateAsset calls for the SAME box (a per-box lock),
            // so firing all candidates at once causes contention — measured 30s
            // (timeout) vs ~675ms for all four in series. Sequential is optimal
            // here; each call is ~170ms and a success usually lands on the first.
            for (const candidate of useridCandidates) {
                try {
                    console.log(`🔵 [GET MAC ID] Trying userid="${candidate}"...`);
                    const r = await validateFoFiAsset({
                        mac_addr: '',
                        serialno: '',
                        userid: candidate,
                        boxid: boxId.trim()
                    });
                    const errCode = r?.status?.err_code;
                    const errMsg = r?.status?.err_msg || '';
                    console.log(`🟢 [GET MAC ID] userid="${candidate}" → err_code=${errCode}, err_msg="${errMsg}"`);

                    // Pool any MAC we see across attempts.
                    const macFromBody = extractMacFromBody(r);
                    const macFromMsg = extractMacFromMsg(r);
                    if (!bestMacAcrossAttempts && (macFromBody || macFromMsg)) {
                        bestMacAcrossAttempts = macFromBody || macFromMsg;
                    }

                    if (errCode === 0) {
                        successResp = r;
                        successUserid = candidate;
                        break; // clean success — abort retry
                    }

                    // Definitive ownership-conflict signal.
                    const classification = classifyFoFiValidationMessage(errMsg);
                    if (!ownershipBlocker && (classification.kind === 'not-belongs' || classification.kind === 'already-assigned')) {
                        ownershipBlocker = {
                            kind: classification.kind,
                            msg: errMsg,
                            mac: macFromMsg || macFromBody,
                            opid: classification.opid,
                        };
                        console.log(`📛 [GET MAC ID] Ownership blocker captured: "${errMsg}"`);
                        // Don't break yet — a later candidate's response
                        // might surface the MAC even when this one didn't.
                    }

                    // Capture any MAC-bearing response for the success path.
                    if ((macFromBody || macFromMsg) && !macResp) {
                        macResp = r;
                        macUserid = candidate;
                        console.log(`📌 [GET MAC ID] Captured MAC-bearing error response from userid="${candidate}"`);
                    }
                    lastErrMsg = errMsg || lastErrMsg;
                } catch (e) {
                    if (e?.message?.includes('navigated away')) {
                        return;
                    }
                    console.warn(`⚠️ [GET MAC ID] userid="${candidate}" threw:`, e?.message);
                    lastErrMsg = e?.message || lastErrMsg;
                }
            }

            // SHORT-CIRCUIT: device is already assigned. Match the
            // reference app's wording exactly: "Fo-Fi device(MAC)
            // already assigned" (with hyphen, no space before paren).
            // Prefer the backend's verbatim message when it's already
            // in this shape — otherwise synthesise it.
            //
            // Manual flow deliberately does NOT clear the Box ID field
            // the operator typed — that mirrors the reference app
            // where the Box ID stays visible while the toast appears
            // at the bottom (matches the screenshot the user shared).
            //
            // Order matters: we ONLY treat this as a conflict if no
            // userid succeeded. A later candidate succeeding overrides
            // the earlier blocker (rare but possible — e.g. operator
            // username works after customer/op_id failed).
            if (ownershipBlocker && !successResp) {
                const rawMsg = String(ownershipBlocker.msg || '');
                const blockerResponse = {
                    status: { err_msg: rawMsg },
                    body: {
                        mac_addr: ownershipBlocker.mac || bestMacAcrossAttempts,
                        boxid: boxId.trim(),
                    },
                };
                const userMsg = formatFoFiValidationError(blockerResponse, {
                    fallbackMac: ownershipBlocker.mac || bestMacAcrossAttempts,
                    fallbackBoxId: boxId.trim(),
                });
                console.log(`📛 [GET MAC ID] Surfacing to user: "${userMsg}" (raw: "${rawMsg}")`);
                setValidationError(userMsg);
                setShowValidationSuccess(false);
                setDeviceValidated(false);
                setIsLoading(false);
                return;
            }

            // Pick the best response we have: success > MAC-bearing
            // error > nothing.
            const response = successResp || macResp;
            const userid = successUserid || macUserid;

            if (!response) {
                // No response had any MAC at all — either backend was
                // unreachable for every candidate or the Box ID is
                // genuinely invalid.
                setValidationError(formatFoFiValidationError({
                    status: { err_msg: lastErrMsg },
                    body: { boxid: boxId.trim() },
                }, { fallbackBoxId: boxId.trim() }) || 'Device not found. Please verify the Box ID is correct.');
                setIsLoading(false);
                return;
            }

            console.log(`✅ [GET MAC ID] Using response from userid="${userid}" (success=${!!successResp})`);
            console.log('🟢 [GET MAC ID] Response (full):', JSON.stringify(response, null, 2));

            {
                let extractedMac = extractMacFromBody(response);
                let extractedSerial = '';
                let extractedBoxId = extractFoFiBoxId(response, '');

                if (response?.body) {
                    const bodyData = getFoFiValidationBody(response);
                    extractedSerial = bodyData?.serial_number || bodyData?.serialNumber || bodyData?.serialno || bodyData?.serial || bodyData?.fserialno || '';
                    // Read the Box ID strictly from box-ID fields.
                    // product_name on the FoFi response carries the
                    // FOFI<digits> serial (same string surfaced as
                    // itemid in cabletvapis), so we deliberately
                    // exclude it here — Box ID and serial are
                    // separate identifiers and the user-facing field
                    // must show the API-issued Box ID only.
                    extractedBoxId = extractedBoxId || bodyData?.boxid || bodyData?.box_id || bodyData?.fofiboxid || bodyData?.fofi_box_id || bodyData?.stbid || bodyData?.stb_id || '';
                }

                // MAC from message — works for both success
                // ("Fo-Fi device(...) belongs to ... & available") and
                // error ("Fo-Fi device(...) already assigned").
                if (!extractedMac) {
                    extractedMac = extractMacFromMsg(response);
                    if (extractedMac) console.log('✅ [GET MAC ID] Extracted MAC from message:', extractedMac);
                }

                // Box ID from message — only matches actual Box ID
                // formats (bbnl-*, BBNL_*). Serial numbers
                // (FOFI<digits>) often appear in err_msg strings too,
                // but the product owner has been explicit that this
                // field must carry the API-issued Box ID, never the
                // serial. So we keep the regex strictly to
                // box-ID-shaped tokens.
                if (!extractedBoxId && response?.status?.err_msg) {
                    // ANDBOX-format only — never an operator id (BBNL_OP…) that the
                    // "device not belongs op(BBNL_OP981)" message embeds.
                    const boxMatch = findAndboxBoxId(String(response.status.err_msg));
                    if (boxMatch) {
                        extractedBoxId = boxMatch;
                        console.log('✅ [GET MAC ID] Extracted Box ID from message:', extractedBoxId);
                    }
                }

                if (!extractedMac) {
                    setValidationError(lastErrMsg || 'MAC address not found for this Box ID. Please verify the Box ID is correct.');
                    setIsLoading(false);
                    return;
                }

                // Optional enrichment: if serial / canonical box ID
                // missing, do a second call. Only on a clean success
                // (avoids piling more "already assigned" errors on the
                // user — STEP 0 at submit will surface that cleanly).
                if (successResp && (!extractedSerial || !extractedBoxId)) {
                    console.log('🔵 [GET MAC ID] Missing serial/boxId — second call with MAC...');
                    try {
                        const detailResp = await validateFoFiAsset({
                            mac_addr: extractedMac,
                            serialno: '',
                            userid: userid,
                            boxid: boxId.trim()
                        });
                        console.log('🟢 [GET MAC ID] Detail response:', JSON.stringify(detailResp, null, 2));
                        if (detailResp?.status?.err_code === 0 && detailResp?.body) {
                            const d = getFoFiValidationBody(detailResp);
                            if (!extractedSerial) extractedSerial = d?.serial_number || d?.serialNumber || d?.serialno || d?.serial || d?.fserialno || '';
                            if (!extractedBoxId) extractedBoxId = d?.boxid || d?.box_id || d?.fofiboxid || d?.fofi_box_id || '';
                        }
                        if (!extractedBoxId && detailResp?.status?.err_msg) {
                            const m = findAndboxBoxId(String(detailResp.status.err_msg));
                            if (m) extractedBoxId = m;
                        }
                    } catch (e) {
                        console.warn('⚠️ [GET MAC ID] Detail call failed (non-fatal):', e.message);
                    }
                }

                const finalBoxId = extractedBoxId || boxId.trim();
                const finalMac = extractedMac.toUpperCase();

                console.log('✅ [GET MAC ID] Final Box ID:', finalBoxId, extractedBoxId ? '(from API)' : '(user input)');
                console.log('✅ [GET MAC ID] Final MAC:', finalMac);
                console.log('✅ [GET MAC ID] Final Serial:', extractedSerial || '(empty)');

                // Populate the form. SUBMIT will re-validate ownership
                // via STEP 0 in handleLinkFoFiBox — that's the gate.
                setBoxId(finalBoxId);
                setMacAddress(finalMac);
                setSerialNumber(extractedSerial);
                setDeviceInfo({
                    macAddress: finalMac,
                    serialNumber: extractedSerial,
                    boxId: finalBoxId
                });
                setDeviceValidated(true);
                setShowValidationSuccess(true);
                setValidationMethod('manual');
                // Clear any previous error popup — fields populated is the success signal.
                setValidationError('');
            }
        } catch (error) {
            // Navigation-controller aborts throw this message — not a
            // user-facing error. Silently drop.
            if (error?.message?.includes('navigated away')) return;
            console.error('❌ [GET MAC ID] Error:', error);
            setValidationError(error?.message || 'Failed to validate device. Please check the Box ID and try again.');
        } finally {
            setIsLoading(false);
        }
    };

    // Link FoFi Box handler - Uses upgradeRegistration API for fresh/new user registration
    const handleLinkFoFiBox = async () => {
        try {
            setIsLoading(true);
            setValidationError('');

            // Pre-flight check — only reject obviously incomplete
            // forms. We deliberately DON'T gate on deviceValidated
            // any more: that flag flips false on the validateAsset
            // "already assigned" path and used to block the LINK
            // button with a misleading "Please get MAC ID first"
            // message even when the MAC was clearly populated. The
            // STEP 0 re-validation below talks to validateAsset
            // again at submit time and surfaces the actual backend
            // verdict ("already assigned", "device not belongs to
            // this op", etc.), which is the message operators need.
            if (!selectedPlan) {
                setValidationError('Please select one plan from the selection');
                setIsLoading(false);
                return;
            }
            if (!boxId || !boxId.trim()) {
                setValidationError('Please scan the QR or enter the FOFI Box ID');
                setIsLoading(false);
                return;
            }
            // ATV/unicast devices carry no FoFi MAC — native links them without one.
            // Only require a MAC for real FoFi Android (ANDBOX) boxes.
            if (isFofiAndroidBoxId(boxId) && (!macAddress || !macAddress.trim())) {
                setValidationError('MAC ID is missing — click GET MAC ID or scan the QR');
                setIsLoading(false);
                return;
            }

            const user = getUser();
            const loginuname = user?.username || 'superadmin';
            const username = firstTrimmedValue(
                customerData?.username,
                customerData?.customer_id,
                routeCustomerId,
                loginuname
            );

            // Extract plan details
            // For combo plans (IPTV_OTT_COMBO), the OTT plan ID is in ottservplanid field inside serv_rates
            // For registrationNecessities API: servid is the internet plan ID, but we need OTT plan ID
            const servRates = selectedPlan.serv_rates || {};
            const selection = selectedPlan?._source === 'internet-link'
                ? resolveInternetLinkPlanSelection(selectedPlan)
                : resolveFoFiPlanSelection(selectedPlan);
            const { planid: planId, priceid: priceId, planrate: planPrice, servid: servId } = selection;
            const registrationFields = resolveFoFiRegistrationFields(selectedPlan);
            if (!planId) {
                setValidationError('Selected FoFi plan is missing a plan ID. Please select another plan.');
                setIsLoading(false);
                return;
            }
            // Service ID for FoFi/OTT is ALWAYS '3' - this is the service type

            console.log('🔵 Selected Plan Object:', selectedPlan);
            console.log('🔵 All plan fields:', Object.keys(selectedPlan));
            console.log('🔵 serv_rates fields:', Object.keys(servRates));
            console.log('🔵 serv_rates.ottservplanid:', servRates.ottservplanid);
            console.log('🔵 serv_rates.ottplanid:', servRates.ottplanid);
            console.log('🔵 serv_rates.fofiplanid:', servRates.fofiplanid);
            console.log('🔵 serv_rates.planid:', servRates.planid);
            console.log('🔵 Plan ID:', planId, 'Price ID:', priceId, 'Service ID:', servId);

            // Build the values that go into the freeOTAService /
            // upgradeRegistration payload. Prefer what GET MAC ID /
            // QR-scan stored on deviceInfo, but fall back to the form
            // fields so an operator who typed values manually still
            // works.
            //
            // No pre-flight validateAsset re-check here: the mobile
            // native trace goes straight from GET MAC ID to
            // freeOTAService with no intermediate re-validate, and
            // the previous PWA "STEP 0" was the actual reason
            // already-assigned devices saw "Please get MAC ID first"
            // and never reached the link API. The link/upgrade APIs
            // themselves validate ownership server-side and return
            // err_msg verbatim — the catch blocks below surface
            // those messages to the operator, which is the same
            // signal STEP 0 used to relay just one network hop
            // earlier.
            const finalBoxIdForSubmit = (deviceInfo && deviceInfo.boxId) || boxId;
            const finalMacForSubmit = macAddress;
            const finalSerialForSubmit = (deviceInfo && deviceInfo.serialNumber) || serialNumber || '';

            // =====================================================
            // FIRST-TIME LINK PATH (new user — !hasFofiService).
            //
            // Native app contract: ServiceApis/freeOTAService with
            //   { fofiboxid, fofimac, fofiserailnumber, loginuname,
            //     plan_id, services:["ott"], username }
            // On success: fetch FoFi payment info and continue to
            // the payment review page, matching the CRM flow.
            // =====================================================
            if (!hasConfirmedFofiService) {
                // Native FreeOTTlinkFragment: the freeOTAService `plan_id` is the
                // SELECTED plan's srvid from specialInternetPlans — native builds a
                // serv_name → srvid map from that endpoint and sends the chosen
                // srvid. A registrationNecessities fofi `planid` is NOT a special-plan
                // srvid, which is exactly what produces "Requested plan not found".
                // Resolve the srvid the same way: by plan name for a normal FoFi
                // (ANDBOX) box, or the LINK_FOFIBOX plan for a unicast / ATV device
                // (the only srvid the backend accepts for those — FreeOTTPaidChannels.php).
                // Native's link body is exactly { fofiboxid, fofimac, fofiserailnumber,
                // loginuname, username(=customerid), plan_id, services:["ott"] }.
                const isUnicastTvDevice = !isFofiAndroidBoxId(finalBoxIdForSubmit);
                const specialRows = getInternetOriginPlanRows(
                    await getSpecialInternetPlans({ logUname: loginuname, isKiranastore: "no" }).catch(() => null)
                );
                const selectedPlanName = firstTrimmedValue(
                    selectedPlan?.planname, selectedPlan?.plan_name, selectedPlan?.serv_name, selectedPlan?.name
                );
                const linkPlanId = isUnicastTvDevice
                    ? findLinkFofiboxSrvid(specialRows)
                    : findSpecialPlanSrvid(specialRows, selectedPlanName);
                if (!linkPlanId) {
                    setValidationError(isUnicastTvDevice
                        ? 'Could not resolve the LINK_FOFIBOX plan from the server. Please retry.'
                        : `Could not resolve the selected plan "${selectedPlanName}" in the server plan list. Please retry.`);
                    setIsLoading(false);
                    return;
                }
                const linkPayload = {
                    fofiboxid: finalBoxIdForSubmit,
                    fofimac: finalMacForSubmit,
                    fofiserailnumber: finalSerialForSubmit,
                    loginuname: loginuname,
                    username: username,
                    plan_id: linkPlanId,
                    services: ['ott'],
                };
                console.log('🔵 [LINK] Calling freeOTAService…', linkPayload);
                const linkResp = await linkFoFiBox(linkPayload);
                console.log('🟢 [LINK] freeOTAService response:', linkResp);
                if (linkResp?.status?.err_code !== 0) {
                    setValidationError(linkResp?.status?.err_msg || 'Failed to link FoFi box.');
                    setIsLoading(false);
                    return;
                }

                const paymentPayload = {
                    fofi_box_id: finalBoxIdForSubmit,
                    planid: planId,
                    priceid: priceId,
                    servapptype: "crmapp",
                    servid: servId,
                    userid: username,
                    username: "superadmin",
                    voipnumber: ""
                };

                console.log('ðŸ”µ [LINK] Calling getFofiPaymentInfo API...', paymentPayload);
                const paymentResponse = await getFofiPaymentInfo(paymentPayload);
                console.log('ðŸŸ¢ [LINK] Payment Info Response:', paymentResponse);

                if (paymentResponse?.status?.err_code !== 0) {
                    setValidationError(paymentResponse?.status?.err_msg || 'Failed to get FoFi payment info.');
                    setIsLoading(false);
                    return;
                }

                const paymentBody = paymentResponse?.body || {};
                const taxDetails = paymentBody?.tax_details || [];
                const cgstObj = taxDetails.find(t => t.title?.toUpperCase() === 'CGST');
                const sgstObj = taxDetails.find(t => t.title?.toUpperCase() === 'SGST');
                const cgst = cgstObj?.amt || 0;
                const sgst = sgstObj?.amt || 0;
                const extractedPlanRate = parseFloat(paymentBody?.planrate) || parseFloat(planPrice) || 0;
                const extractedTotal = paymentBody?.total_amt || 0;
                const otherCharges = paymentBody?.other_amt || 0;
                const balanceAmount = paymentBody?.balance_amt || 0;
                const operatorShare = paymentBody?.oprtrshare || 0;
                const bbnlShare = parseFloat(paymentBody?.bbnl_share) || 0;
                const softCharge = paymentBody?.softwarecharges || 0;
                const tds = paymentBody?.tds || 0;
                const amountDeductable = resolveFoFiAmountDeductable(paymentBody, selectedPlan?.planname || selectedPlan?.serv_name || selectedPlan?.plan_name);

                const fofiPaymentData = {
                    userid: username,
                    fofiboxid: finalBoxIdForSubmit,
                    planid: planId,
                    priceid: priceId,
                    servid: servId,
                    loginuname: loginuname,
                    paytype: 'new_registration',
                    transactionid: paymentBody?.transactionid || '',
                    walletBalance: 0,
                    paymentDetails: {
                        "Plan Name": paymentBody?.planname || selectedPlan?.planname || selectedPlan?.serv_name || selectedPlan?.plan_name || "N/A",
                        "Plan Rate": extractedPlanRate,
                        "CGST": cgst,
                        "SGST": sgst,
                        "Other Charges": otherCharges,
                        "Balance Amount": balanceAmount,
                        "Total Amount": extractedTotal
                    },
                    moreDetails: {
                        "Operator Share": operatorShare,
                        ...(bbnlShare > 0 ? { "BBNL Share": bbnlShare } : {}),
                        ...(softCharge > 0 ? { "Software Charges": softCharge } : {}),
                        ...(tds > 0 ? { "TDS": tds } : {}),
                        "Amount Deductable": amountDeductable
                    },
                    noofmonth: 1,
                    amountDeductable: amountDeductable,
                    planName: paymentBody?.planname || selectedPlan?.planname || selectedPlan?.serv_name || selectedPlan?.plan_name || "N/A",
                    planRate: extractedPlanRate,
                    totalAmount: extractedTotal,
                    operatorShare: operatorShare,
                    customer: customerData
                };

                try {
                    lsRemove(`uai_fofi_${username}`);
                    lsRemove(`uai_cabletv_${username}`);
                    lsRemove(`plandets_fofi_${username}_${finalBoxIdForSubmit}`);
                    lsRemove(`plandets_fofi_${username}_`);
                } catch (_) { /* cache clear is best-effort */ }

                const subviewDepth = subViewDepthRef.current;
                if (subviewDepth > 0) {
                    cleanupPopStateRef.current = subviewDepth;
                    window.history.go(-subviewDepth);
                    await new Promise(resolve => setTimeout(resolve, 30 * subviewDepth + 30));
                }
                navigate('/fofi-payment', { state: fofiPaymentData });
                return;

            }

            // =====================================================
            // STEP 1: Call upgradeRegistration API (existing-user upgrade path)
            // =====================================================
            const upgradePayload = {
                fofiboxid: finalBoxIdForSubmit,
                fofimac: finalMacForSubmit,
                fofiserailnumber: finalSerialForSubmit,
                loginuname: loginuname,
                plan_id: planId,
                planid: planId,
                priceid: priceId,
                servid: servId,
                servapptype: "crmapp",
                userid: username,
                ...registrationFields,
                username: username
            };

            console.log('🔵 [STEP 1] Calling upgradeRegistration API...');
            console.log('🔵 Upgrade Payload:', JSON.stringify(upgradePayload, null, 2));

            const upgradeResponse = await upgradeRegistration(upgradePayload);
            console.log('🟢 Upgrade Registration Response:', upgradeResponse);

            if (upgradeResponse?.status?.err_code !== 0) {
                setValidationError(upgradeResponse?.status?.err_msg || 'Failed to register upgrade');
                setIsLoading(false);
                return;
            }

            // =====================================================
            // STEP 3: Call paymentinfo/fofi API
            // =====================================================
            const paymentPayload = {
                fofi_box_id: finalBoxIdForSubmit,
                planid: planId,
                priceid: priceId,
                servapptype: "crmapp",
                servid: servId,
                userid: username,
                // Hardcoded "superadmin" — see equivalent comment
                // in handleSubscriptionSubmit. Sending the real
                // operator name binds the txn to that operator on
                // the backend and generateorder later rejects it
                // with the misleading wallet-balance message.
                username: "superadmin",
                voipnumber: ""
            };

            console.log('🔵 [STEP 3] Calling getFofiPaymentInfo API...');
            console.log('🔵 Payment Payload:', JSON.stringify(paymentPayload, null, 2));

            const paymentResponse = await getFofiPaymentInfo(paymentPayload);
            console.log('🟢 Payment Info Response:', paymentResponse);

            if (paymentResponse?.status?.err_code !== 0) {
                // Payment info API failed, but registration was successful
                console.warn('⚠️ Payment info API failed, but registration succeeded');
                toast.add('FoFi Box registered successfully! Payment info could not be retrieved.', { type: 'info' });
                // Reset form and navigate back to overview
                setView('overview');
                setDeviceValidated(false);
                setMacAddress('');
                setSerialNumber('');
                setBoxId('');
                setDeviceInfo(null);
                setSelectedPlan(null);
            } else {
                // Both APIs succeeded - Navigate to FoFi Payment Review Page
                console.log('✅ Registration successful, navigating to payment page...');
                
                // Extract payment details from the response
                const paymentBody = paymentResponse?.body || {};
                
                // Debug: Log the full API response structure
                console.log('🔴 [DEBUG] Full paymentBody (new user):', JSON.stringify(paymentBody, null, 2));
                
                // Extract tax details from tax_details array
                const taxDetails = paymentBody?.tax_details || [];
                const cgstObj = taxDetails.find(t => t.title?.toUpperCase() === 'CGST');
                const sgstObj = taxDetails.find(t => t.title?.toUpperCase() === 'SGST');
                const cgst = cgstObj?.amt || 0;
                const sgst = sgstObj?.amt || 0;
                
                // Extract amounts directly from paymentBody
                const extractedPlanRate = parseFloat(paymentBody?.planrate) || selectedPlan?.price || 0;
                const extractedTotal = paymentBody?.total_amt || 0;
                const otherCharges = paymentBody?.other_amt || 0;
                const balanceAmount = paymentBody?.balance_amt || 0;
                
                // Extract share info directly from paymentBody
                const operatorShare = paymentBody?.oprtrshare || 0;
                const bbnlShare = parseFloat(paymentBody?.bbnl_share) || 0;
                const softCharge = paymentBody?.softwarecharges || 0;
                const tds = paymentBody?.tds || 0;
                const fofiShare = paymentBody?.fofishare || 0;
                
                const amountDeductable = resolveFoFiAmountDeductable(paymentBody, selectedPlan?.planname || selectedPlan?.plan_name);

                // Prepare payment data for the review page
                const fofiPaymentData = {
                    // Customer & Plan identifiers
                    userid: username,
                    fofiboxid: deviceInfo.boxId || boxId,
                    planid: planId,
                    priceid: priceId,
                    servid: servId,
                    loginuname: loginuname,
                    paytype: 'new_registration',
                    transactionid: paymentBody?.transactionid || '',

                    // Wallet balance
                    walletBalance: 0,

                    // Payment details for display
                    paymentDetails: {
                        "Plan Name": paymentBody?.planname || selectedPlan?.planname || selectedPlan?.plan_name || "N/A",
                        "Plan Rate": extractedPlanRate,
                        "CGST": cgst,
                        "SGST": sgst,
                        "Other Charges": otherCharges,
                        "Balance Amount": balanceAmount,
                        "Total Amount": extractedTotal
                    },

                    // More details — only include non-zero positive values (matches production)
                    moreDetails: {
                        "Operator Share": operatorShare,
                        ...(bbnlShare > 0 ? { "BBNL Share": bbnlShare } : {}),
                        ...(softCharge > 0 ? { "Software Charges": softCharge } : {}),
                        ...(tds > 0 ? { "TDS": tds } : {}),
                        "Amount Deductable": amountDeductable
                    },

                    // Additional payment info
                    noofmonth: 1,
                    amountDeductable: amountDeductable,
                    planName: paymentBody?.planname || selectedPlan?.planname || selectedPlan?.plan_name || "N/A",
                    planRate: extractedPlanRate,
                    totalAmount: extractedTotal,
                    operatorShare: operatorShare,
                    
                    // Customer data for reference
                    customer: customerData
                };

                console.log('🔵 Navigating to FoFi Payment with data:', fofiPaymentData);

                // Same history-cleanup as the existing-user submit path
                // — see comment at the other navigate('/fofi-payment')
                // call. Pop our subview entries first so back from the
                // post-payment overview is clean.
                const subviewDepth = subViewDepthRef.current;
                if (subviewDepth > 0) {
                    cleanupPopStateRef.current = subviewDepth;
                    window.history.go(-subviewDepth);
                    await new Promise(resolve => setTimeout(resolve, 30 * subviewDepth + 30));
                }
                // Navigate to FoFi Payment Review page
                navigate('/fofi-payment', { state: fofiPaymentData });
                return; // Exit the function after navigation
            }

        } catch (error) {
            console.error('❌ Upgrade registration error:', error);
            const errMsg = error?.message || 'Unknown error';
            setValidationError('Failed to register FoFi box: ' + errMsg);
        } finally {
            setIsLoading(false);
        }
    };

    const handlePlanSelect = (plan) => {
        setSelectedPlan(plan);
        // For existing users, skip device validation
        if (hasConfirmedFofiService) {
            enterSubView('payment');
        } else {
            enterSubView('device-validation');
        }
    };

    // Handle payment for new registration
    const handlePayment = async () => {
        try {
            setIsLoading(true);
            setValidationError('');

            // Step 1: Create payment order
            const orderResponse = await createFoFiPaymentOrder({
                customerId: customerData.customer_id,
                planId: selectedPlan.id,
                amount: selectedPlan.price,
                deviceId: deviceInfo?.serialNumber,
                orderType: hasConfirmedFofiService ? 'renewal' : 'new_registration'
            });

            if (!orderResponse.success) {
                setValidationError(orderResponse.message || 'Failed to create payment order');
                setIsLoading(false);
                return;
            }

            setPaymentOrderId(orderResponse.data.orderId);

            // Step 2: For new users, register the device first
            if (!hasConfirmedFofiService && deviceInfo) {
                const registerResponse = await registerFoFiDevice({
                    customerId: customerData.customer_id,
                    planId: selectedPlan.id,
                    serialNumber: deviceInfo.serialNumber,
                    macAddress: macAddress,
                    multicastDeviceId: deviceInfo.multicastDeviceId,
                    unicastDeviceId: deviceInfo.unicastDeviceId,
                    validationMethod: validationMethod
                });

                if (!registerResponse.success) {
                    setValidationError(registerResponse.message || 'Failed to register device');
                    setIsLoading(false);
                    return;
                }
            }

            // Step 3: Redirect to payment gateway or handle payment
            // In production, this would redirect to payment gateway
            console.log('Payment order created:', orderResponse.data);

            // For demo: simulate successful payment after 2 seconds
            setTimeout(async () => {
                try {
                    const verifyResponse = await verifyFoFiPayment({
                        orderId: orderResponse.data.orderId,
                        paymentId: 'DEMO_PAYMENT_' + Date.now(),
                        customerId: customerData.customer_id
                    });

                    if (verifyResponse.success && verifyResponse.verified) {
                        toast.add('Payment successful! Your FoFi Smart Box has been activated.', { type: 'success' });
                        // Navigate back to customer overview
                        navigate('/customers');
                    } else {
                        setValidationError('Payment verification failed');
                    }
                } catch (verifyError) {
                    console.error('Payment verification error:', verifyError);
                    setValidationError('Failed to verify payment');
                } finally {
                    setIsLoading(false);
                }
            }, 2000);

        } catch (error) {
            console.error('Payment error:', error);
            setValidationError('Failed to process payment. Please try again.');
            setIsLoading(false);
        }
    };

    // Handle plan change for existing users
    const handlePlanChange = async () => {
        try {
            setIsLoading(true);
            setValidationError('');

            const response = await changeFoFiPlan({
                customerId: customerData.customer_id,
                currentPlanId: fofiService?.planId,
                newPlanId: selectedPlan.id,
                action: 'change'
            });

            if (response.success) {
                toast.add('Plan changed successfully!', { type: 'success' });
                navigate('/customers');
            } else {
                setValidationError(response.message || 'Failed to change plan');
            }
        } catch (error) {
            console.error('Plan change error:', error);
            setValidationError('Failed to change plan. Please try again.');
        } finally {
            setIsLoading(false);
        }
    };

    if (!customerData) {
        return (
            <div className="min-h-screen flex flex-col bg-gray-50">
                <header className="sticky top-0 z-40 flex items-center px-4 pb-3 bg-gradient-to-r from-indigo-600 to-blue-600 shadow-lg" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top, 0.75rem))' }}>
                    <button onClick={() => navigate(-1)} className="p-1 mr-3">
                        <svg className="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                        </svg>
                    </button>
                    <h1 className="text-lg font-medium text-white">Customer OverView</h1>
                </header>
                <div className="flex-1 px-3 py-4">
                    <div className="text-center text-gray-500 dark:text-gray-400 py-10">
                        No customer data available. Please select a customer from the customer list.
                    </div>
                </div>
                <BottomNav />
            </div>
        );
    }

    // =====================================================
    // CUSTOMER OVERVIEW VIEW - Shows customer details and service status
    // Matches Internet module UI/UX exactly
    // =====================================================
    if (view === 'overview') {
        // Customer details come from the operator-selected customerData
        // (authenticated customersList selection), matching Android — the
        // removed unauthenticated cblCustDet/primaryCustdet calls are gone.
        const displayUsername = customerData?.username ||
                               customerData?.customer_id || 'N/A';
        const displayName = customerData?.name ||
                           customerData?.customer_name || 'N/A';
        const displayPhone = customerData?.mobile ||
                            customerData?.phone || 'N/A';
        const displayEmail = customerData?.email || 'N/A';

        console.log('📊 [FoFi SmartBox] Overview Display Data:', {
            username: displayUsername,
            name: displayName,
            phone: displayPhone,
            email: displayEmail,
            hasFofiService: hasFofiService,
            isOverviewLoading: isOverviewLoading
        });

        // No fullScreen gate — render the shell (header, user
        // details, filter, action buttons) immediately from
        // customerData (which we always have from navigation
        // state). Only the FoFi service-status section below
        // shows an inline loading state while the assigned-items
        // call resolves. Operators see something useful in
        // ~50 ms instead of a blank loader for 1+ RTT.

        return (
            <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
                {successAlert}

                {/* Header - Matching Internet module exactly */}
                <header className="sticky top-0 z-40 flex items-center px-4 pb-3 bg-gradient-to-r from-indigo-600 to-blue-600 shadow-lg" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top, 0.75rem))' }}>
                    <button onClick={() => navigate(-1)} className="p-1 mr-3">
                        <svg className="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                        </svg>
                    </button>
                    <h1 className="text-lg font-medium text-white">Customer OverView</h1>
                </header>

                <div className="flex-1 max-w-2xl mx-auto w-full px-4 py-4 space-y-4 pb-24">
                    {/* User Details - Matching Internet module */}
                    <div className="space-y-3">
                        <h3 className="text-indigo-600 font-semibold text-lg flex items-center gap-2">
                            <div className="w-1 h-6 bg-gradient-to-b from-indigo-600 to-blue-600 rounded-full"></div>
                                    User Details
                                </h3>
                                <div className="space-y-1 text-sm">
                                    <div className="flex">
                                        <span className="w-36 shrink-0 text-gray-600 dark:text-gray-400">Username</span>
                                        <span className="text-gray-600 dark:text-gray-400 min-w-0 break-all">: {displayUsername}</span>
                                    </div>
                                    <div className="flex">
                                        <span className="w-36 shrink-0 text-gray-600 dark:text-gray-400">Customer Name</span>
                                        <span className="text-gray-600 dark:text-gray-400 min-w-0 break-all">: {displayName}</span>
                                    </div>
                                    <div className="flex">
                                        <span className="w-36 shrink-0 text-gray-600 dark:text-gray-400">Ph Number</span>
                                        <span className="text-gray-600 dark:text-gray-400 min-w-0 break-all">: {displayPhone}</span>
                                    </div>
                                    <div className="flex">
                                        <span className="w-36 shrink-0 text-gray-600 dark:text-gray-400">Email Id</span>
                                        <span className="text-gray-600 dark:text-gray-400 min-w-0 break-all">: {displayEmail}</span>
                                    </div>
                                </div>
                            </div>

                            {/* Action Buttons - Matching Internet module */}
                            <div className="flex gap-3">
                                <button
                                    onClick={handleUploadDocument}
                                    disabled={isUploadingDocument}
                                    className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2.5 px-4 rounded-full text-sm transition-[background-color,box-shadow] duration-200 shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {isUploadingDocument ? 'Loading...' : 'Upload Document'}
                                </button>
                                <button
                                    onClick={handleOrderHistory}
                                    className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2.5 px-4 rounded-full text-sm transition-[background-color,box-shadow] duration-200 shadow-md hover:shadow-lg"
                                >
                                    Order History
                                </button>
                            </div>

                            {/* Filter Badge - Matching Internet module */}
                            <div className="flex items-center justify-between bg-white dark:bg-gray-800 px-4 py-3 -mx-4">
                                <div className="flex items-center gap-2">
                                    <span className="text-base text-indigo-600 font-semibold">Filtered by :</span>
                                    <span className="bg-gradient-to-r from-indigo-600 to-blue-600 text-white text-sm font-medium px-4 py-1.5 rounded-full shadow-md">
                                        FOFI Smart Box
                                    </span>
                                </div>
                                <button onClick={() => setShowServiceModal(true)} className="text-indigo-600 hover:text-indigo-700 transition-colors">
                                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                                    </svg>
                                </button>
                            </div>

                            {/* Service Status Section */}
                            {error ? (
                                // Error state - API calls failed
                                <div className="flex-1 flex flex-col items-center justify-center py-10">
                                    <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mb-4">
                                        <svg className="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                        </svg>
                                    </div>
                                    <p className="text-red-600 dark:text-red-400 text-center text-sm mb-2">{error}</p>
                                    <button
                                        onClick={() => {
                                            setError('');
                                            setOverviewRetryKey((key) => key + 1);
                                        }}
                                        className="mt-4 text-indigo-600 hover:text-indigo-700 text-sm font-medium underline"
                                    >
                                        Retry
                                    </button>
                                </div>
                            ) : isOverviewLoading ? (
                                // Inline skeleton while getUserAssignedItems
                                // is in flight. Avoids a flash of
                                // "not opted" before the API decides.
                                <div className="flex-1 flex flex-col items-center justify-center py-10">
                                    <div className="w-8 h-8 rounded-full border-4 border-indigo-200 border-t-indigo-600 animate-spin"></div>
                                    <p className="text-gray-500 dark:text-gray-400 text-xs mt-3">Loading service status…</p>
                                </div>
                            ) : isCheckingFofiService ? (
                                <div className="flex-1 flex flex-col items-center justify-center py-10">
                                    <div className="w-8 h-8 rounded-full border-4 border-indigo-200 border-t-indigo-600 animate-spin"></div>
                                    <p className="text-gray-600 dark:text-gray-400 text-center text-sm mt-3">
                                        Checking FoFi service status...
                                    </p>
                                </div>
                            ) : !hasConfirmedFofiService && selectedCableBox ? (
                                // CABLE-TV CUSTOMER — has cable TV but no FoFi box.
                                // Native-app parity: show the cable box id + its
                                // current (FTA/cable) plan and an UPGRADE PLAN
                                // button. The button runs the SAME eligibility-
                                // gated add-FoFi-box flow as ADD FO-FI BOX
                                // (hasConfirmedFofiService is false here, so
                                // handleUpgradeClick takes the new-user path).
                                <>
                                    {(cableTvBoxes.length > 1 || selectedCableBox.boxId) && (
                                    <div className="space-y-3">
                                        <h3 className="text-indigo-600 font-semibold text-lg flex items-center gap-2">
                                            <div className="w-1 h-6 bg-gradient-to-b from-indigo-600 to-blue-600 rounded-full"></div>
                                            FoFi Box ID
                                        </h3>
                                        {cableTvBoxes.length > 1 ? (
                                            <div className="bg-gradient-to-br from-indigo-50 to-blue-50 dark:bg-gray-800 rounded-xl border border-indigo-200 dark:border-gray-700 overflow-hidden">
                                                <select
                                                    value={selectedCableBoxIdx}
                                                    onChange={e => setSelectedCableBoxIdx(Number(e.target.value))}
                                                    className="w-full px-4 py-3 bg-transparent text-indigo-600 dark:text-indigo-300 font-semibold text-base appearance-none cursor-pointer focus:outline-none"
                                                    style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%234f46e5' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")", backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center', paddingRight: '36px' }}
                                                >
                                                    {cableTvBoxes.map((box, idx) => (
                                                        <option key={box.boxId} value={idx}>{box.boxId}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        ) : (
                                            <div className="bg-gradient-to-br from-indigo-50 to-blue-50 dark:bg-gray-800 px-4 py-3 rounded-xl border border-indigo-200 dark:border-gray-700">
                                                <p className="text-indigo-600 dark:text-indigo-300 font-semibold text-base break-all">{selectedCableBox.boxId}</p>
                                            </div>
                                        )}
                                    </div>
                                    )}

                                    <div className="space-y-3">
                                        <h3 className="text-indigo-600 font-semibold text-lg flex items-center gap-2">
                                            <div className="w-1 h-6 bg-gradient-to-b from-indigo-600 to-blue-600 rounded-full"></div>
                                            Plan Details
                                        </h3>
                                        <div className="bg-white dark:bg-gray-800 p-5 rounded-xl shadow-md hover:shadow-lg transition-shadow duration-300 border border-gray-100 dark:border-gray-700">
                                            <div className="flex items-start gap-3">
                                                <div className="flex-shrink-0">
                                                    <svg className="w-12 h-12" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                        <circle cx="50" cy="50" r="50" fill="url(#fofiCableGradient)" />
                                                        <path d="M25 48 Q50 22, 75 48" stroke="white" strokeWidth="5" strokeLinecap="round" fill="none" />
                                                        <line x1="22" y1="55" x2="78" y2="55" stroke="white" strokeWidth="5" strokeLinecap="round" />
                                                        <line x1="26" y1="66" x2="74" y2="66" stroke="white" strokeWidth="5" strokeLinecap="round" />
                                                        <line x1="32" y1="77" x2="68" y2="77" stroke="white" strokeWidth="4" strokeLinecap="round" />
                                                        <defs>
                                                            <linearGradient id="fofiCableGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                                                                <stop offset="0%" stopColor="#38BDF8" />
                                                                <stop offset="100%" stopColor="#0284C7" />
                                                            </linearGradient>
                                                        </defs>
                                                    </svg>
                                                </div>
                                                <div className="flex-1 min-w-0 space-y-2 text-sm">
                                                    <div className="flex">
                                                        <span className="w-24 shrink-0 text-gray-700 dark:text-gray-300">Service Name</span>
                                                        <span className="min-w-0 break-words text-gray-700 dark:text-gray-300">: {selectedCableBox.serviceName || 'fofi'}</span>
                                                    </div>
                                                    <div className="flex">
                                                        <span className="w-24 shrink-0 text-gray-700 dark:text-gray-300">Plan Name</span>
                                                        <span className="min-w-0 break-words text-gray-700 dark:text-gray-300">: {selectedCableBox.planName || 'N/A'}</span>
                                                    </div>
                                                    <div className="flex">
                                                        <span className="w-24 shrink-0 text-gray-700 dark:text-gray-300">Expiry Date</span>
                                                        <span className="min-w-0 break-words text-gray-700 dark:text-gray-300">: {selectedCableBox.expiryDate || 'N/A'}</span>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="mt-4">
                                                <button
                                                    onClick={handleUpgradeClick}
                                                    disabled={upgradePlansLoading}
                                                    className="w-full bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-semibold py-3 px-4 rounded-lg text-sm uppercase tracking-wide transition-shadow duration-200 shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                                                >
                                                    {upgradePlansLoading ? 'Loading...' : 'UPGRADE PLAN'}
                                                </button>
                                                {upgradePlansError && (
                                                    <p className="text-red-500 text-sm mt-3 text-center">{upgradePlansError}</p>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </>
                            ) : !hasConfirmedFofiService ? (
                                // NEW USER - Not opted for a FoFi PLAN yet.
                                // If a device is already LINKED (e.g. the customer
                                // logged into the ATV app, which links the Android TV
                                // and assigns it a MAC), show that device's Box ID +
                                // TV MAC here so the operator can verify it and
                                // subscribe a package — instead of a bare "not opted"
                                // screen that hides the MAC.
                                <div className="flex-1 flex flex-col items-center justify-center py-10">
                                    {linkedDeviceNoPlan && isMeaningfulFoFiValue(linkedDeviceNoPlan.boxId || linkedDeviceNoPlan.macAddress) ? (
                                        <div className="w-full max-w-md mb-6">
                                            <h3 className="text-indigo-600 font-semibold text-lg flex items-center gap-2 mb-3">
                                                <div className="w-1 h-6 bg-gradient-to-b from-indigo-600 to-blue-600 rounded-full"></div>
                                                Linked TV Device
                                            </h3>
                                            <div className="bg-gradient-to-br from-indigo-50 to-blue-50 dark:bg-gray-800 px-4 py-3 rounded-xl border border-indigo-200 dark:border-gray-700 space-y-1">
                                                {linkedDeviceNoPlan.deviceType && (
                                                    <p className="text-xs text-indigo-500 dark:text-indigo-400">{linkedDeviceNoPlan.deviceType}</p>
                                                )}
                                                {isMeaningfulFoFiValue(linkedDeviceNoPlan.boxId) && (
                                                    <p className="text-indigo-600 dark:text-indigo-300 font-semibold text-base break-all">{linkedDeviceNoPlan.boxId}</p>
                                                )}
                                                {isMeaningfulFoFiValue(linkedDeviceNoPlan.macAddress) && (
                                                    <p className="text-sm text-gray-700 dark:text-gray-300 font-mono break-all">MAC: {linkedDeviceNoPlan.macAddress}</p>
                                                )}
                                            </div>
                                            <p className="text-gray-500 dark:text-gray-400 text-center text-xs mt-3">
                                                This device is linked but has no active plan. Subscribe a package to activate it.
                                            </p>
                                        </div>
                                    ) : (
                                        <p className="text-gray-600 dark:text-gray-400 text-center text-sm mb-6">
                                            Selected Customer have not opted<br />for this Service
                                        </p>
                                    )}
                                    <button
                                        onClick={handleUpgradeClick}
                                        disabled={upgradePlansLoading}
                                        className="bg-gradient-to-r from-purple-500 to-violet-600 hover:from-purple-600 hover:to-violet-700 text-white font-semibold py-3 px-10 rounded-lg text-sm uppercase tracking-wide transition-shadow duration-200 shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {upgradePlansLoading
                                            ? 'Loading...'
                                            : (linkedDeviceNoPlan && isMeaningfulFoFiValue(linkedDeviceNoPlan.boxId || linkedDeviceNoPlan.macAddress)
                                                ? 'SUBSCRIBE PACKAGE'
                                                : 'ADD FO-FI BOX')}
                                    </button>
                                    {upgradePlansError && (
                                        <p className="text-red-500 text-sm mt-3 text-center">{upgradePlansError}</p>
                                    )}
                                </div>
                            ) : (
                                // EXISTING USER - Has FoFi service
                                <>
                                    {/* FoFi Box ID Section - Matching Internet ID style exactly */}
                                    <div className="space-y-3">
                                        <h3 className="text-indigo-600 font-semibold text-lg flex items-center gap-2">
                                            <div className="w-1 h-6 bg-gradient-to-b from-indigo-600 to-blue-600 rounded-full"></div>
                                            FoFi Box ID
                                        </h3>
                                        {allFofiBoxes.length > 1 ? (
                                            <div className="bg-gradient-to-br from-indigo-50 to-blue-50 dark:bg-gray-800 rounded-xl border border-indigo-200 dark:border-gray-700 overflow-hidden">
                                                <select
                                                    value={selectedBoxIdx}
                                                    onChange={e => handleBoxSelect(Number(e.target.value))}
                                                    className="w-full px-4 py-3 bg-transparent text-indigo-600 dark:text-indigo-300 font-semibold text-base appearance-none cursor-pointer focus:outline-none"
                                                    style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%234f46e5' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")", backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center', paddingRight: '36px' }}
                                                >
                                                    {allFofiBoxes.map((box, idx) => (
                                                        <option key={box.boxId} value={idx}>
                                                            {box.serviceDetails?.deviceType ? `[${box.serviceDetails.deviceType}] ` : ''}{box.boxId}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                        ) : (
                                            <div className="bg-gradient-to-br from-indigo-50 to-blue-50 dark:bg-gray-800 px-4 py-3 rounded-xl border border-indigo-200 dark:border-gray-700">
                                                <p className="text-indigo-600 dark:text-indigo-300 font-semibold text-base">{fofiServiceDetails?.boxId || 'N/A'}</p>
                                                {fofiServiceDetails?.deviceType && (
                                                    <p className="text-xs text-indigo-500 dark:text-indigo-400 mt-0.5">{fofiServiceDetails.deviceType}</p>
                                                )}
                                            </div>
                                        )}
                                    </div>

                                    {/* Current Plan (Read-Only) Section - Matching Internet style exactly */}
                                    <div className="space-y-3">
                                        <h3 className="text-indigo-600 font-semibold text-lg flex items-center gap-2">
                                            <div className="w-1 h-6 bg-gradient-to-b from-indigo-600 to-blue-600 rounded-full"></div>
                                            Current Plan 
                                        </h3>
                                        <div className="bg-white dark:bg-gray-800 p-5 rounded-xl shadow-md hover:shadow-lg transition-shadow duration-300 border border-gray-100 dark:border-gray-700">
                                            <div className="flex items-start gap-3">
                                                {/* FoFi Smart Box Logo - Hardcoded SVG */}
                                                <div className="flex-shrink-0">
                                                    <svg className="w-12 h-12" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                        {/* Blue circle background */}
                                                        <circle cx="50" cy="50" r="50" fill="url(#fofiGradient)" />
                                                        {/* Top dome/arc */}
                                                        <path d="M25 48 Q50 22, 75 48" stroke="white" strokeWidth="5" strokeLinecap="round" fill="none" />
                                                        {/* Three horizontal wave lines */}
                                                        <line x1="22" y1="55" x2="78" y2="55" stroke="white" strokeWidth="5" strokeLinecap="round" />
                                                        <line x1="26" y1="66" x2="74" y2="66" stroke="white" strokeWidth="5" strokeLinecap="round" />
                                                        <line x1="32" y1="77" x2="68" y2="77" stroke="white" strokeWidth="4" strokeLinecap="round" />
                                                        <defs>
                                                            <linearGradient id="fofiGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                                                                <stop offset="0%" stopColor="#38BDF8" />
                                                                <stop offset="100%" stopColor="#0284C7" />
                                                            </linearGradient>
                                                        </defs>
                                                    </svg>
                                                </div>

                                                {/* Plan Info - Matching Internet style */}
                                                <div className="flex-1 min-w-0 space-y-2 text-sm">
                                                    <div className="flex">
                                                        <span className="w-24 shrink-0 text-gray-700 dark:text-gray-300">Service Name</span>
                                                        <span className="min-w-0 break-words text-gray-700 dark:text-gray-300">: FoFi Smart Box</span>
                                                    </div>
                                                    <div className="flex">
                                                        <span className="w-24 shrink-0 text-gray-700 dark:text-gray-300">Plan Name</span>
                                                        <span className="min-w-0 break-words text-gray-700 dark:text-gray-300">: {fofiServiceDetails?.planName || 'N/A'}</span>
                                                    </div>
                                                    <div className="flex">
                                                        <span className="w-24 shrink-0 text-gray-700 dark:text-gray-300">Expiry Date</span>
                                                        <span className="min-w-0 break-words text-gray-700 dark:text-gray-300">: {fofiServiceDetails?.expiryDate || 'N/A'}</span>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Action Buttons.
                                                PAY BILL is the renew-the-current-plan path
                                                and is only meaningful AFTER the plan has
                                                expired — that's the only state where the
                                                customer can pay to keep the same plan.
                                                Before expiry there's nothing to renew, so
                                                we hide the button entirely instead of
                                                showing it disabled (which the client
                                                reported as confusing). The backend's
                                                btn_status='disable' flag is still honoured
                                                as a secondary gate when present. */}
                                            <div className="space-y-3 mt-4">
                                                {isFofiExpired && fofiPlanDetailsRaw?.body?.other_service_renewal?.btn_status !== 'disable' && (
                                                    <button
                                                        onClick={handlePayBill}
                                                        className="w-full bg-gradient-to-r from-purple-500 to-violet-600 hover:from-purple-600 hover:to-violet-700 text-white font-semibold py-3 px-4 rounded-lg transition-shadow duration-200 text-sm shadow-md hover:shadow-lg"
                                                    >
                                                        PAY BILL
                                                    </button>
                                                )}
                                                <button
                                                    onClick={handleUpgradeClick}
                                                    disabled={upgradePlansLoading}
                                                    className="w-full bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white font-semibold py-3 px-4 rounded-lg transition-shadow duration-200 text-sm shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                                                >
                                                    {upgradePlansLoading ? 'Loading...' : 'Upgrade Plan'}
                                                </button>
                                            </div>
                                        </div>
                                    </div>

                                </>
                            )}
                </div>

                <ServiceSelectionModal
                    isOpen={showServiceModal}
                    onClose={() => setShowServiceModal(false)}
                    onSelectService={handleServiceSelect}
                    customer={customerData}
                    services={servicesFromState}
                    currentServiceKey="fofi-smart-box"
                    fofiboxid={fofiServiceDetails?.boxId || ''}
                    cableDetails={{ body: { op_id: customerData?.op_id || getUser()?.op_id } }}
                />
                <BottomNav />
            </div>
        );
    }

    // =====================================================
    // UPGRADE PLANS VIEW - Show available upgrade plans/services
    // =====================================================
    if (view === 'upgrade-plans') {
        return (
            <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
                {successAlert}

                {/* Header - Blue/Indigo gradient matching app theme */}
                <header className="sticky top-0 z-40 flex items-center px-4 pb-4 bg-gradient-to-r from-indigo-600 to-blue-600 shadow-lg" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top, 1rem))' }}>
                    <button onClick={goBackToOverview} className="p-1 mr-3">
                        <svg className="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                    </button>
                    <h1 className="text-xl font-medium text-white">Services</h1>
                </header>

                <div className="flex-1 px-4 py-4 space-y-4 pb-24 max-w-2xl mx-auto w-full">
                    {/* Search Input - Matching app theme */}
                    <div className="relative w-full">
                        <input
                            type="text"
                            placeholder="Search Plans"
                            value={upgradeSearchTerm}
                            onChange={(e) => handleUpgradeSearch(e.target.value)}
                            className="w-full px-4 py-3 pr-12 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-white rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 shadow-sm"
                        />
                        <MagnifyingGlassIcon className="h-5 w-5 absolute right-4 top-1/2 -translate-y-1/2 text-gray-400" />
                    </div>

                    {/* All Services Section Header - Matching app theme */}
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <div className="w-1 h-5 bg-gradient-to-b from-indigo-600 to-blue-600 rounded-full"></div>
                            <span className="text-indigo-600 dark:text-indigo-400 font-semibold text-base">All Services</span>
                            {!upgradePlansLoading && (
                                <span className="bg-gradient-to-r from-indigo-600 to-blue-600 text-white text-xs font-medium px-2.5 py-1 rounded-full shadow-sm">
                                    {filteredUpgradePlans.length}
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Loading State */}
                    {upgradePlansLoading && (
                        <div className="flex justify-center py-10">
                            <Loader size={10} color="indigo" text="Loading plans..." />
                        </div>
                    )}

                    {/* Error State */}
                    {upgradePlansError && !upgradePlansLoading && (
                        <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-500 rounded-lg p-4">
                            <p className="text-red-700 dark:text-red-400 text-sm">{upgradePlansError}</p>
                        </div>
                    )}

                    {/* Plans List */}
                    {!upgradePlansLoading && filteredUpgradePlans.length > 0 && (
                        <div className="space-y-3">
                            {filteredUpgradePlans.map((plan, index) => {
                                // Plan display - supports both fofi_plans and internet_plans
                                // fofi_plans: planname, planrate, planid
                                // internet_plans: serv_name, serv_rates, servid
                                const planName = plan.planname || plan.serv_name || plan.plan_name || plan.name || 'Unknown Plan';
                                const planPrice = plan.planrate || plan.serv_rates?.prices?.[0] || plan.price || plan.amount || '0';
                                // Use _uniqueKey for React key to avoid duplicates
                                const uniqueKey = plan._uniqueKey || `plan_${index}`;

                                return (
                                    <div
                                        key={uniqueKey}
                                        onClick={() => handleUpgradePlanSelect(plan)}
                                        className="relative flex items-center justify-between bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 cursor-pointer hover:shadow-md hover:border-indigo-200 dark:hover:border-indigo-700 transition-[box-shadow,border-color] duration-200 overflow-hidden"
                                    >
                                        {/* Special Offer Ribbon - Always shown */}
                                        <div className="absolute top-0 right-0">
                                            <div className="bg-gradient-to-r from-orange-500 to-red-500 text-white text-[10px] font-bold px-3 py-1 shadow-md uppercase tracking-wide" style={{ clipPath: 'polygon(0 0, 100% 0, 100% 100%, 10% 100%)' }}>
                                                SPECIAL OFFER
                                            </div>
                                        </div>

                                        {/* Plan Details */}
                                        <div className="flex-1 pr-20">
                                            <p className="font-medium text-gray-800 dark:text-white text-base">{planName}</p>
                                            <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">
                                                {import.meta.env.VITE_API_APP_DEFAULT_CURRENCY_SYMBOL || '₹'}{planPrice}
                                            </p>
                                        </div>

                                        {/* Arrow Icon */}
                                        <ChevronRightIcon className="h-5 w-5 text-gray-400" />
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* Empty State */}
                    {!upgradePlansLoading && !upgradePlansError && filteredUpgradePlans.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-10">
                            <div className="w-20 h-20 bg-indigo-100 dark:bg-indigo-900/30 rounded-full flex items-center justify-center mb-4">
                                <svg className="w-10 h-10 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                            </div>
                            <p className="text-gray-600 dark:text-gray-400 text-center text-sm">No plans found matching your search.</p>
                            <button 
                                onClick={() => { setUpgradeSearchTerm(''); setFilteredUpgradePlans(upgradePlans); }}
                                className="mt-3 text-indigo-600 dark:text-indigo-400 text-sm font-medium hover:underline"
                            >
                                Clear search
                            </button>
                        </div>
                    )}
                </div>

                {/* Zero Price Plan Popup */}
                <AnimatePresence>
                    {showZeroPricePopup && (
                        <div className="fixed inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm z-50 px-4" onClick={() => setShowZeroPricePopup(false)}>
                            <motion.div
                                initial={{ opacity: 0, scale: 0.9, y: -20 }}
                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                                transition={{ duration: 0.3, ease: "easeOut" }}
                                className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden"
                                onClick={(e) => e.stopPropagation()}
                            >
                                {/* Gradient Header */}
                                <div className="bg-gradient-to-r from-orange-500 to-red-500 px-6 py-4 flex items-center justify-between">
                                    <h3 className="text-lg font-semibold text-white">Alert</h3>
                                    <button
                                        onClick={() => setShowZeroPricePopup(false)}
                                        className="text-white/80 hover:text-white hover:bg-white/20 rounded-full p-1 transition-colors duration-200"
                                    >
                                        <XMarkIcon className="h-6 w-6" />
                                    </button>
                                </div>

                                {/* Content */}
                                <div className="p-8">
                                    <motion.div
                                        initial={{ scale: 0 }}
                                        animate={{ scale: 1 }}
                                        transition={{ delay: 0.1, type: "spring", stiffness: 200 }}
                                        className="flex justify-center mb-6"
                                    >
                                        <div className="bg-gradient-to-br from-orange-100 to-red-100 dark:from-orange-900/30 dark:to-red-900/30 rounded-full p-4">
                                            <ExclamationCircleIcon className="h-16 w-16 text-orange-500" />
                                        </div>
                                    </motion.div>

                                    <p className="text-gray-700 dark:text-gray-300 text-center text-base leading-relaxed mb-6">
                                       Plan Rate is Missing.Please Contact Admin to Update the Plan Rate.
                                    </p>

                                    {/* Action Button */}
                                    <button
                                        onClick={() => setShowZeroPricePopup(false)}
                                        className="w-full px-6 py-3 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white font-semibold rounded-lg transition-shadow duration-200 shadow-md hover:shadow-lg"
                                    >
                                        OK, Select Other Plan
                                    </button>
                                </div>
                            </motion.div>
                        </div>
                    )}
                </AnimatePresence>

                <BottomNav />
            </div>
        );
    }

    // =====================================================
    // SUBSCRIPTION CONFIRMATION VIEW - For EXISTING users
    // Shows Plan Type, Plan Name, auto-detected Box ID, and SUBMIT button
    // =====================================================
    if (view === 'subscription-confirm') {
        const confirmPlanName = selectedPlan?.planname || selectedPlan?.serv_name || selectedPlan?.plan_name || selectedPlan?.name || 'N/A';
        const confirmBoxId = fofiServiceDetails?.boxId || 'N/A';
        
        return (
            <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
                {successAlert}

                {/* Header - Blue/Indigo gradient matching app theme */}
                <header className="sticky top-0 z-40 flex items-center px-4 pb-4 bg-gradient-to-r from-indigo-600 to-blue-600 shadow-lg" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top, 1rem))' }}>
                    {/* In-app chevron pops one history entry; popstate
                        handler reads the marker and restores the
                        previous view. Same path as phone hardware back. */}
                    <button onClick={goBackOneView} className="p-1 mr-3">
                        <svg className="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                    </button>
                    <h1 className="text-xl font-medium text-white">Services Subscription</h1>
                </header>

                <div className="flex-1 px-4 py-6 space-y-6 max-w-md mx-auto w-full">
                    {/* Plan Info Card */}
                    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-5">
                        <div className="space-y-3">
                            <div className="flex">
                                <span className="text-gray-600 dark:text-gray-400 w-28">Plan Type</span>
                                <span className="text-gray-600 dark:text-gray-400 mr-2">:</span>
                                <span className="text-indigo-600 dark:text-indigo-400 font-semibold">FoFi Plan</span>
                            </div>
                            <div className="flex">
                                <span className="text-gray-600 dark:text-gray-400 w-28">Plan Name</span>
                                <span className="text-gray-600 dark:text-gray-400 mr-2">:</span>
                                <span className="text-indigo-600 dark:text-indigo-400 font-semibold uppercase">{confirmPlanName}</span>
                            </div>
                        </div>
                    </div>

                    {/* FOFI Section */}
                    <div className="space-y-3">
                        <div className="flex items-center gap-2">
                            <div className="w-1 h-5 bg-gradient-to-b from-indigo-600 to-blue-600 rounded-full"></div>
                            <span className="text-indigo-600 dark:text-indigo-400 font-semibold text-sm uppercase tracking-wide">FOFI</span>
                        </div>
                        
                        {/* FoFi Box ID - Auto-detected (Read-only) */}
                        <div className="relative pt-2.5">
                            <label className="absolute top-0 left-3 bg-gray-50 dark:bg-gray-900 px-1 text-xs text-indigo-600 dark:text-indigo-400 font-medium">
                                FOFI BOX ID
                            </label>
                            <input
                                type="text"
                                value={confirmBoxId}
                                readOnly
                                className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-xl focus:outline-none cursor-not-allowed"
                            />
                        </div>
                    </div>

                    {/* SUBMIT Button */}
                    <div className="pt-4">
                        <button
                            onClick={handleSubscriptionSubmit}
                            disabled={isLoading}
                            className="w-full py-3.5 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white font-semibold rounded-xl shadow-lg transition-opacity duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                        >
                            {isLoading ? (
                                <>
                                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                    Processing...
                                </>
                            ) : (
                                'SUBMIT'
                            )}
                        </button>
                    </div>
                </div>

                <BottomNav />
            </div>
        );
    }

    // =====================================================
    // LINK FO-FI BOX VIEW (single-page first-time link)
    // Mirrors the native app contract:
    //   - Plan dropdown sourced from specialInternetPlans (already
    //     loaded into fofiPlans state on mount)
    //   - FOFI Box ID input + Scan From TV
    //   - GET MAC ID → fofi/fofiapis/validateAsset
    //   - LINK FO-FI BOX → ServiceApis/freeOTAService, then
    //     service/paymentinfo/fofi, then FoFi payment review
    // =====================================================
    const selectedPlanName = selectedPlan?.serv_name || selectedPlan?.planname || selectedPlan?.plan_name || selectedPlan?.name || 'Select a Plan';
    const selectedPlanPrice = selectedPlan?.planrate || selectedPlan?.serv_rates?.prices?.[0] || selectedPlan?.price || selectedPlan?.amount || selectedPlan?.rate || '0';
    
    return (
        <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
            {/* QR Scanner Modal — lazy loaded */}
            {showQRScanner && (
                <Suspense fallback={<Loader text="Loading scanner..." />}>
                    <QRScanner
                        onScan={handleQRCodeScanned}
                        onClose={handleQRScannerClose}
                        onError={handleQRScanError}
                    />
                </Suspense>
            )}

            {/* Blue/Indigo Gradient Header - Matching app theme */}
            <header className="sticky top-0 z-40 flex items-center px-4 pb-4 bg-gradient-to-r from-indigo-600 to-blue-600 shadow-lg" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top, 1rem))' }}>
                {/* When entered from Internet Service the route was
                    pushed by them — go back via React Router. Otherwise
                    pop one of our own history entries via the shared
                    popstate path. */}
                <button onClick={() => { if (fromInternet) navigate(-1); else goBackOneView(); }} className="p-1 mr-3">
                    <svg className="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                </button>
                <h1 className="text-xl font-medium text-white">{isLinkedDeviceSubscription ? 'Subscribe Package' : 'Link FO-FI Box'}</h1>
            </header>

            <div className="flex-1 px-4 py-4 space-y-4 pb-24 max-w-md mx-auto w-full">

                {/* Validation error banner — pinned at the TOP of the
                    content area so the operator sees the rejection
                    reason immediately, with no scrolling. The banner
                    used to render below the LINK FO-FI BOX button at
                    the bottom of the form, which on small phones was
                    completely off-screen after a click. The
                    scroll-into-view effect above brings it back into
                    sight even if the user has scrolled down.
                    Tap × to dismiss. */}
                {validationError && (
                    <div
                        ref={validationErrorRef}
                        role="alert"
                        aria-live="polite"
                        className="relative bg-red-50 dark:bg-red-900/30 border-l-4 border-red-500 rounded-lg p-4 shadow-sm"
                    >
                        <div className="flex items-start gap-3 pr-7">
                            <ExclamationCircleIcon className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                            <p className="text-sm text-red-800 dark:text-red-200 whitespace-pre-line break-words">
                                {validationError}
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setValidationError('')}
                            aria-label="Dismiss error"
                            className="absolute top-2 right-2 text-red-500 hover:text-red-800 dark:text-red-400 dark:hover:text-red-200"
                        >
                            <XMarkIcon className="h-4 w-4" />
                        </button>
                    </div>
                )}

                {/* ALREADY-LINKED DEVICE — read-only confirm card.
                    The box + MAC are already known (device is linked to the
                    customer with no active plan), so we do NOT show the
                    Scan / GET MAC / editable entry form again. The operator
                    just confirms the box and proceeds to package payment.
                    Same handleLinkFoFiBox submit (freeOTAService +
                    paymentinfo/fofi) runs underneath with these values. */}
                {isLinkedDeviceSubscription ? (
                    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-5">
                        <div className="flex items-center gap-2 mb-4">
                            <div className="w-1 h-6 bg-gradient-to-b from-indigo-600 to-blue-600 rounded-full"></div>
                            <h2 className="text-lg font-semibold text-indigo-600 dark:text-indigo-400">Linked TV Device</h2>
                        </div>
                        <div className="bg-gradient-to-br from-indigo-50 to-blue-50 dark:bg-gray-700/40 px-4 py-3 rounded-xl border border-indigo-200 dark:border-gray-600 space-y-1">
                            {isMeaningfulFoFiValue(boxId) && (
                                <p className="text-indigo-600 dark:text-indigo-300 font-semibold text-base break-all">{boxId}</p>
                            )}
                            {isMeaningfulFoFiValue(macAddress) && (
                                <p className="text-sm text-gray-700 dark:text-gray-300 font-mono break-all">MAC: {macAddress}</p>
                            )}
                        </div>
                        <p className="text-gray-500 dark:text-gray-400 text-xs mt-3">
                            This device is already linked. Confirm and proceed to subscribe the selected package.
                        </p>
                    </div>
                ) : (
                <>
                {/* FOFI Section Card */}
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-5">
                    {/* FOFI Header */}
                    <div className="flex items-center gap-2 mb-5">
                        <div className="w-1 h-6 bg-gradient-to-b from-indigo-600 to-blue-600 rounded-full"></div>
                        <h2 className="text-lg font-semibold text-indigo-600 dark:text-indigo-400">FOFI</h2>
                    </div>

                    {/* Scan From TV Button */}
                    <div className="flex justify-center mb-4">
                        <button
                            onClick={handleQRScan}
                            disabled={isLoading}
                            className="bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 disabled:from-gray-300 disabled:to-gray-400 text-white font-semibold py-3 px-6 rounded-lg flex items-center gap-2 transition-shadow duration-200 shadow-md hover:shadow-lg"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                            </svg>
                            Scan From TV
                        </button>
                    </div>

                    {/* OR Divider */}
                    <div className="flex items-center justify-center py-2">
                        <span className="text-gray-400 dark:text-gray-500 font-medium text-sm">OR</span>
                    </div>

                    {/* FOFI Box ID Input */}
                    <div className="space-y-3 mb-4">
                        <div className="relative">
                            <input
                                type="text"
                                value={boxId}
                                onChange={(e) => setBoxId(e.target.value)}
                                placeholder="FOFI Box Id*"
                                className="w-full px-4 py-3 pr-12 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-gray-800 dark:text-white bg-white dark:bg-gray-700 placeholder-gray-400 transition-[border-color,box-shadow] duration-200"
                            />
                            <button type="button" onClick={handleQRScan} className="absolute right-3 top-1/2 transform -translate-y-1/2 cursor-pointer">
                                {/* Barcode Icon */}
                                <svg className="w-6 h-6 text-gray-400 hover:text-indigo-600 transition-colors" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M2 4h2v16H2V4zm4 0h1v16H6V4zm2 0h2v16H8V4zm4 0h1v16h-1V4zm2 0h3v16h-3V4zm4 0h1v16h-1V4zm2 0h2v16h-2V4z"/>
                                </svg>
                            </button>
                        </div>
                    </div>

                    {/* GET MAC ID Button */}
                    <div className="flex justify-center mb-4">
                        <button
                            onClick={handleFetchMAC}
                            disabled={isLoading || !boxId}
                            className={`bg-gradient-to-r from-purple-500 to-violet-600 hover:from-purple-600 hover:to-violet-700 text-white font-bold py-3 px-10 rounded-full transition-shadow duration-200 uppercase text-sm shadow-md hover:shadow-lg inline-flex items-center justify-center gap-2 ${isLoading || !boxId ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                            {isLoading && (
                                <span className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                            )}
                            {isLoading ? 'Getting MAC...' : 'GET MAC ID'}
                        </button>
                    </div>

                    {/* FOFI MAC ID Input */}
                    <div className="space-y-3">
                        <div className="relative">
                            <input
                                type="text"
                                value={macAddress}
                                onChange={(e) => setMacAddress(e.target.value)}
                                placeholder="FOFI MAC ID*"
                                className="w-full px-4 py-3 pr-12 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-gray-800 dark:text-white bg-white dark:bg-gray-700 font-mono text-sm placeholder-gray-400 transition-[border-color,box-shadow] duration-200"
                            />
                            <button type="button" onClick={handleQRScan} className="absolute right-3 top-1/2 transform -translate-y-1/2 cursor-pointer">
                                {/* Barcode Icon */}
                                <svg className="w-6 h-6 text-gray-400 hover:text-indigo-600 transition-colors" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M2 4h2v16H2V4zm4 0h1v16H6V4zm2 0h2v16H8V4zm4 0h1v16h-1V4zm2 0h3v16h-3V4zm4 0h1v16h-1V4zm2 0h2v16h-2V4z"/>
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>
                </>
                )}

                {/* Select a Plan dropdown — sourced from
                    registrationNecessities (body.fofi_plans, the
                    FoFi-box-compatible list). Plans on this list
                    can carry either srvid or planid; the selected
                    plan's srvid/planid maps to the plan_id in the
                    freeOTAService submit payload. */}
                {!isUpgradeLinkContinuation && (
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4">
                    {linkPlansLoading && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Loading plans...</p>
                    )}
                    {linkPlansError && !linkPlansLoading && (
                        <div className="mb-2 flex items-center justify-between gap-2">
                            <p className="text-xs text-red-600 dark:text-red-400">{linkPlansError}</p>
                            <button
                                type="button"
                                onClick={() => { setLinkPlansError(''); setLinkPlansRetryKey((k) => k + 1); }}
                                className="flex-shrink-0 text-xs font-semibold text-indigo-600 dark:text-indigo-400 border border-indigo-300 dark:border-indigo-600 rounded-md px-3 py-1 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors"
                            >
                                Retry
                            </button>
                        </div>
                    )}
                    <select
                        value={selectedPlan ? getPlanSelectId(selectedPlan) : ''}
                        onChange={(e) => {
                            const v = e.target.value;
                            if (!v) { setSelectedPlan(null); return; }
                            const match = (fofiPlans || []).find((p, idx) => String(getPlanSelectId(p, idx)) === String(v));
                            setSelectedPlan(match || null);
                        }}
                        className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    >
                        <option value="">Select a Plan</option>
                        {(fofiPlans || []).map((p, idx) => {
                            const id = getPlanSelectId(p, idx);
                            const name = p.serv_name || p.planname || p.plan_name || p.name || `Plan ${idx + 1}`;
                            return (
                                <option key={`${id}-${idx}`} value={String(id)}>
                                    {name}
                                </option>
                            );
                        })}
                    </select>
                </div>
                )}

                {/* Loading is shown INLINE on the action buttons (spinner +
                    label). The previous fullscreen "Validating device…" overlay
                    was removed — it blocked the whole screen and blurred the
                    form, which operators found jarring and left the app looking
                    frozen. In-screen button spinners match every other flow. */}

                {/* Validation errors render inline below the SUBMIT
                    button (see further down). No fullscreen popup —
                    QA asked for the raw backend message shown in-place
                    so operators see exactly why the server rejected
                    the device (e.g. "Fo-Fi device (XX:XX) already
                    assigned") without a modal interrupting them. */}

                {/* Success Message */}
                {showValidationSuccess && macAddress && (
                    <div className="bg-green-50 dark:bg-green-900/20 border-l-4 border-green-500 rounded-lg p-4 shadow-sm">
                        <div className="flex items-start gap-3">
                            <svg className="w-6 h-6 text-green-500 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                            </svg>
                            <div>
                                <p className="text-sm font-semibold text-green-800 dark:text-green-300">Device validated successfully</p>
                                <p className="text-xs text-green-700 dark:text-green-400 mt-1 font-mono">MAC: {macAddress}</p>
                                {deviceInfo?.serialNumber && (
                                    <p className="text-xs text-green-700 dark:text-green-400 font-mono">Serial: {deviceInfo.serialNumber}</p>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* LINK FO-FI BOX Button.
                    Disabled when any of the four required fields for
                    freeOTAService are missing: Box ID, MAC, plan,
                    and a non-empty form. Serial isn't blocked here —
                    if it's missing the gate inside handleLinkFoFiBox
                    will report a clearer message than a disabled
                    button. */}
                <div className="flex justify-center pt-6 pb-4">
                    <button
                        onClick={handleLinkFoFiBox}
                        disabled={isLoading || !boxId || !macAddress || !selectedPlan}
                        className={`bg-gradient-to-r from-purple-500 to-violet-600 hover:from-purple-600 hover:to-violet-700 text-white font-bold py-4 px-12 rounded-full transition-shadow duration-200 uppercase text-sm shadow-lg hover:shadow-xl tracking-wide inline-flex items-center justify-center gap-2 ${isLoading || !boxId || !macAddress || !selectedPlan ? 'opacity-50 cursor-not-allowed' : ''}`}
                        title={!selectedPlan ? 'Please select a plan first' : !boxId ? 'Please scan or enter FOFI Box ID' : !macAddress ? 'Please get MAC ID first' : (isLinkedDeviceSubscription ? 'Subscribe this package' : 'Link this box')}
                    >
                        {isLoading && (
                            <span className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                        )}
                        {isLoading
                            ? (isLinkedDeviceSubscription ? 'Subscribing…' : 'Linking…')
                            : (isLinkedDeviceSubscription ? 'PROCEED TO PAYMENT' : 'LINK FO-FI BOX')}
                    </button>
                </div>

                {/* Validation error banner moved to the TOP of this
                    content area (see above) so it lands inside the
                    operator's viewport instead of below the bottom
                    LINK FO-FI BOX button. */}
            </div>

            <BottomNav />
        </div>
    );
}

export default FoFiSmartBox;
