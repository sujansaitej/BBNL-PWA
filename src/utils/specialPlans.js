/**
 * Special-internet-plan helpers.
 *
 * `specialInternetPlans` returns a bare array of { srvid, serv_name } rows
 * (verified live). Native's FreeOTTlinkFragment maps serv_name → srvid and
 * sends the selected plan's srvid to freeOTAService. For a unicast / linked-TV
 * device the backend (FreeOTTPaidChannels.php:54-81) accepts ONLY the
 * LINK_FOFIBOX plan — so its srvid is what the PWA must send there (a fofi
 * `planid` is NOT a special-plan srvid → "Requested plan not found").
 */

/**
 * Find a special plan's srvid by its serv_name (case-insensitive).
 * @param {Array<{srvid:(string|number), serv_name:string}>} rows
 * @param {string} servName
 * @returns {string} the srvid as a string, or '' when not found.
 */
export function findSpecialPlanSrvid(rows, servName) {
    if (!Array.isArray(rows)) return '';
    const target = String(servName || '').trim().toLowerCase();
    if (!target) return '';
    const row = rows.find(
        (r) => String(r?.serv_name || '').trim().toLowerCase() === target
    );
    if (!row) return '';
    const srvid = row.srvid;
    return (srvid === 0 || srvid) ? String(srvid) : '';
}

/** Convenience: the LINK_FOFIBOX srvid (unicast/linked-TV device link plan). */
export function findLinkFofiboxSrvid(rows) {
    return findSpecialPlanSrvid(rows, 'link_fofibox');
}
