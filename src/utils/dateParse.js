// Parse the backend's expiry-date strings into a millisecond
// timestamp. The server returns dates in several formats depending
// on the endpoint:
//
//   "25-03-2026 11:59:59 pm"  ← DD-MM-YYYY with 12-hour am/pm
//   "25-03-2026 23:59:59"     ← DD-MM-YYYY with 24-hour
//   "25-03-2026"              ← DD-MM-YYYY date only
//   "2026-03-25T11:59:59Z"    ← ISO (rare — customer-scoped APIs use DD-MM-YYYY)
//   "2026-03-25 23:59:59"     ← YYYY-MM-DD
//
// `new Date()` only reliably parses the ISO variants, so
// `new Date("25-03-2026 11:59:59 pm").getTime()` returns NaN and the
// isExpired check silently treats every expired customer as active.
// This helper tries the common formats explicitly.
//
// Returns a millisecond timestamp or null if unparseable.

export function parseBackendDate(raw) {
    if (raw == null) return null;
    const s = String(raw).trim();
    if (!s || s === 'N/A') return null;

    // Fast path: ISO / RFC formats that `new Date` handles natively.
    const native = Date.parse(s);
    if (!Number.isNaN(native)) return native;

    // DD-MM-YYYY [HH:mm[:ss]] [am/pm]
    // Allow "-" "/" or "." as date separator to be lenient.
    const ddmmyyyy = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?\s*(am|pm|AM|PM)?$/.exec(s);
    if (ddmmyyyy) {
        const [, dd, mm, yyyy, hh, min, ss, ampm] = ddmmyyyy;
        let hour = hh ? parseInt(hh, 10) : 0;
        if (ampm) {
            const isPm = /pm/i.test(ampm);
            if (isPm && hour < 12) hour += 12;
            if (!isPm && hour === 12) hour = 0;
        }
        const d = new Date(
            parseInt(yyyy, 10),
            parseInt(mm, 10) - 1,
            parseInt(dd, 10),
            hour,
            min ? parseInt(min, 10) : 0,
            ss ? parseInt(ss, 10) : 0
        );
        const t = d.getTime();
        return Number.isNaN(t) ? null : t;
    }

    // YYYY-MM-DD [HH:mm[:ss]] [am/pm]
    const yyyymmdd = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?\s*(am|pm|AM|PM)?$/.exec(s);
    if (yyyymmdd) {
        const [, yyyy, mm, dd, hh, min, ss, ampm] = yyyymmdd;
        let hour = hh ? parseInt(hh, 10) : 0;
        if (ampm) {
            const isPm = /pm/i.test(ampm);
            if (isPm && hour < 12) hour += 12;
            if (!isPm && hour === 12) hour = 0;
        }
        const d = new Date(
            parseInt(yyyy, 10),
            parseInt(mm, 10) - 1,
            parseInt(dd, 10),
            hour,
            min ? parseInt(min, 10) : 0,
            ss ? parseInt(ss, 10) : 0
        );
        const t = d.getTime();
        return Number.isNaN(t) ? null : t;
    }

    return null;
}

// Convenience: returns true only when `raw` parses to a timestamp
// strictly before `now` (defaults to current time). Unparseable and
// N/A values return false — we never want to hide CTAs on ambiguous
// data.
export function isExpiredDate(raw, now = Date.now()) {
    const t = parseBackendDate(raw);
    if (t == null) return false;
    return t < now;
}
