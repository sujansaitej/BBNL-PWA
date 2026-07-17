/**
 * raceForFirstMatch — resolve as soon as ANY task yields an accepted value,
 * without waiting for slower tasks; if none is accepted, resolve once all
 * settle.
 *
 * Why this exists: the netmon backend is wildly variable per servkey. Verified
 * live that the SAME cable box returned in 4.2s via getUserAssignedItems
 * (servkey="cabletv") but 41.7s via servkey="fofi". Awaiting one key first (or
 * Promise.allSettled) makes the caller hostage to the slowest key. This races
 * them and returns the moment a usable result lands.
 *
 * @param {Array<() => Promise<any>>} tasks  Thunks (called here, so they start
 *        together). A thunk that throws is captured as a rejected result.
 * @param {(value:any)=>boolean} accept  Predicate on a fulfilled value; the
 *        first task whose value passes wins the race.
 * @returns {Promise<Array<{status:'fulfilled',value:any}|{status:'rejected',reason:any}>>}
 *        Settled-result objects indexed to `tasks`. Entries for tasks that had
 *        not settled at win-time are `undefined` (the winner short-circuits the
 *        wait) — callers should treat `undefined` as "no result".
 */
export function raceForFirstMatch(tasks, accept) {
    return new Promise((resolve) => {
        const results = new Array(tasks.length);
        let remaining = tasks.length;
        let settled = false;
        if (remaining === 0) { resolve(results); return; }
        tasks.forEach((task, i) => {
            Promise.resolve()
                .then(task)
                .then(
                    (value) => ({ status: 'fulfilled', value }),
                    (reason) => ({ status: 'rejected', reason })
                )
                .then((r) => {
                    results[i] = r;
                    remaining -= 1;
                    const matched = r.status === 'fulfilled' && accept(r.value);
                    if (!settled && (matched || remaining === 0)) {
                        settled = true;
                        resolve(results);
                    }
                });
        });
    });
}
