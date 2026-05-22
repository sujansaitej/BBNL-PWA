import { getCustKYCPreview } from "../services/generalApis";

// Fetch the KYC preview for a customer with automatic retry when the
// backend responds with an operator-sync error.
//
// Background: right after an operator creates a new customer, the
// backend's operator-entitlement sync can take a few seconds to
// propagate. Until it does, getCustKYCPreview (and several other
// customer-scoped APIs) returns err_msg strings like:
//   - "Operator is disabled"
//   - "You are not a valid user to register"
//   - "device not belongs op(...)"
// Those aren't real errors — they're a race with backend sync. We
// retry up to `maxAttempts` with `delayMs` between attempts so the
// operator doesn't see a dead-end toast on the first click.
//
// Anything that is NOT in the retryable list is returned immediately
// so genuine errors (missing customer, bad cid, etc.) surface fast.
//
// Returns the last response (success OR final failure).

const RETRYABLE_MSG_PATTERNS = [
    'operator is disabled',
    'not a valid user to register',
    'device not belongs op',
];

function isRetryable(response) {
    const msg = (response?.status?.err_msg || '').toLowerCase();
    return RETRYABLE_MSG_PATTERNS.some(p => msg.includes(p));
}

export async function loadKycWithRetry({ cid, reqtype = 'update', maxAttempts = 3, delayMs = 3000, onAttempt }) {
    let last;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (typeof onAttempt === 'function') onAttempt(attempt, maxAttempts);
        try {
            last = await getCustKYCPreview({ cid, reqtype });
            // Success — return immediately.
            if (last?.status?.err_code === 0) return last;
            // Non-retryable backend error — return verbatim.
            if (!isRetryable(last)) return last;
        } catch (err) {
            // Network / timeout etc. — treat as retryable until we've
            // exhausted attempts, then re-throw.
            last = err;
            if (attempt === maxAttempts) throw err;
        }
        if (attempt < maxAttempts) {
            await new Promise(r => setTimeout(r, delayMs));
        }
    }
    return last;
}
