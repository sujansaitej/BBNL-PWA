/**
 * Internet payment breakdown — the numbers on the Proceed-to-Pay review screen.
 *
 * This is a field-for-field port of what the Android app renders from the
 * `apis/makepayment` response, so the PWA and the app show the SAME figures for
 * the same customer and plan. Source of truth (crmapp-new-master):
 *
 *   EmployeeCommonPaymentInfoFragment.requestFinished()      :270-302  (renewal)
 *   RegistrationPaymentOverviewActivity.requestFinished()    :411-446  (registration)
 *
 * Both read the SAME six lines off `result.planrates["1"]`:
 *
 *   Plan Rate        planamt
 *   CGST / SGST      taxdetails.subtaxes.{CGST,SGST}.value
 *   Other Charges    result.othcharge.amt            ← top level, not the entry
 *   Balance Amount   shareinfo.balamt
 *   Total Amount     total
 *   Operator Share   shareinfo.optrshare
 *   ISP/BBNL Share   shareinfo.bbnlshare
 *   Software Charges shareinfo.softcharge
 *   TDS              shareinfo.tds
 *   Amount Deductable  total − optrshare            ← DERIVED, see below
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The PWA previously derived most of these itself and diverged from the app on
 * live data. Four divergences, all reproduced against the captured production
 * response in tools/api-response-output.txt:
 *
 *  1. Plan Rate read `planrate`, the app reads `planamt`. The backend returns
 *     BOTH on every entry and they are not the same number when the entry
 *     covers more than one month of billing — that is the ₹700-vs-₹2100 gap in
 *     the QA screenshots.
 *  2. CGST/SGST were RECOMPUTED as subtotal × perc/100 instead of read. The
 *     backend rounds its own tax values and bills the rounded figure; on the
 *     captured ₹1 plan the backend says CGST 0 and the recompute says 0.09.
 *     The invoice is the backend's, so the screen must show the backend's.
 *  3. Total was recomputed as planRate+cgst+sgst+other. Once 1 and 2 are wrong
 *     the total is wrong too, and any gap between the recomputed total and the
 *     backend's was then surfaced as a phantom "Balance Amount". Reading
 *     `total` verbatim removes the whole class of error at the source.
 *  4. Amount Deductable used `shareinfo.totbbnlshare`. The app derives it as
 *     total − optrshare. These agree on some plans and not others: on the
 *     captured ₹1 plan totbbnlshare is 10 while total − optrshare is 1.
 *
 * FAILING CLOSED
 * --------------
 * If the response carries no usable 1-month entry there is NO breakdown to
 * show. The previous code filled the screen with zeros and the plan rate it had
 * been handed by the previous page, which looks like a real ₹700 bill, and left
 * PROCEED TO PAY armed with that number as `cashpaid`. That under-bills the
 * customer and mis-settles the operator wallet. `ok: false` is returned instead
 * and the caller must show `message` (the backend's own, as the app does) and
 * refuse to pay. A missing breakdown is an error, never a zero.
 */

/** Parse a backend amount. Returns null when there is genuinely no number. */
export function toNumberOrNull(value) {
  if (value === null || typeof value === "undefined" || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "object") return null;
  const cleaned = String(value).replace(/[^\d.-]/g, "");
  if (!cleaned || cleaned === "-" || cleaned === "." || cleaned === "-.") return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

/** Parse to a 2-decimal rupee amount, treating "absent" as 0 (display use). */
export function amount(value) {
  const num = toNumberOrNull(value);
  return num === null ? 0 : Math.round(num * 100) / 100;
}

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * The 1-month entry, which is the only one either app ever bills.
 *
 * Android indexes `planrates` by the literal key "1"
 * (InternetPaymentInfoRegModel.PlanratesBean, @SerializedName("1")), so that is
 * tried first. The two later shapes are defensive: production also returns the
 * same entries as a `planrates_android` ARRAY, and an older revision keyed the
 * object by month with the month only inside `shareinfo`.
 */
export function pickMonthOneEntry(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;

  const isMonthOne = (entry, key) =>
    Number(entry?.month ?? entry?.shareinfo?.month ?? key) === 1;

  const rates = result.planrates;
  if (rates && typeof rates === "object" && !Array.isArray(rates)) {
    if (rates["1"] && typeof rates["1"] === "object") return rates["1"];
    for (const [key, entry] of Object.entries(rates)) {
      if (entry && typeof entry === "object" && isMonthOne(entry, key)) return entry;
    }
  }
  if (Array.isArray(rates)) {
    const hit = rates.find((entry) => entry && typeof entry === "object" && isMonthOne(entry));
    if (hit) return hit;
  }

  const android = result.planrates_android;
  if (Array.isArray(android)) {
    const hit = android.find((entry) => entry && typeof entry === "object" && isMonthOne(entry));
    if (hit) return hit;
  }

  return null;
}

/**
 * The backend's own explanation for an unusable response.
 *
 * `result.message` is a string array the app reads as `message.get(0)` and puts
 * straight on screen. On a hard failure the endpoint answers with `result` as a
 * bare string instead, and some deployments use the standard envelope's
 * err_msg — all three are checked so the operator sees the real reason rather
 * than a generic retry prompt.
 */
export function backendMessage(response) {
  const result = response?.result;

  if (typeof result === "string" && result.trim()) return result.trim();

  const message = result?.message;
  if (Array.isArray(message)) {
    const first = message.find((m) => String(m ?? "").trim());
    if (first) return String(first).trim();
  } else if (typeof message === "string" && message.trim()) {
    return message.trim();
  }

  const errMsg = response?.status?.err_msg;
  if (typeof errMsg === "string" && errMsg.trim()) return errMsg.trim();

  return "";
}

const NO_BREAKDOWN =
  "This customer's internet plan details could not be loaded. Please go back and try again, or contact support if it keeps happening.";

/**
 * Build the review-screen figures from a raw `apis/makepayment` response.
 *
 * @returns {{ok: true, ...figures} | {ok: false, message: string, walletBalance: number|null}}
 */
export function buildInternetBreakdown(response) {
  const result = response?.result;
  const walletBalance = toNumberOrNull(result?.wallet?.avlbal);

  const fail = () => ({
    ok: false,
    message: backendMessage(response) || NO_BREAKDOWN,
    walletBalance,
  });

  if (!result || typeof result !== "object" || Array.isArray(result)) return fail();

  const planName = String(result.planname ?? "").trim();
  const entry = pickMonthOneEntry(result);
  // Native gates the whole screen on planname (it renders nothing without one)
  // and then dereferences planrates["1"] unconditionally. Requiring both, plus
  // a real `total`, is the same gate without the crash on a partial response.
  if (!planName || !entry) return fail();

  const total = toNumberOrNull(entry.total ?? entry.totalamt);
  if (total === null) return fail();

  const share = entry.shareinfo && typeof entry.shareinfo === "object" ? entry.shareinfo : {};
  const subtaxes =
    entry.taxdetails?.subtaxes && typeof entry.taxdetails.subtaxes === "object"
      ? entry.taxdetails.subtaxes
      : {};

  const subTax = (key) => {
    const node = subtaxes[key] ?? subtaxes[key.toLowerCase()];
    // Some revisions inline the amount instead of nesting it under `value`.
    return amount(node?.value ?? node?.amt ?? node?.amount ?? node);
  };

  // planamt is native's field. planrate / shareinfo.prate are fallbacks for
  // older payloads that predate planamt; `??` (not `||`) so a legitimate 0
  // is not mistaken for "missing".
  const planRate = amount(entry.planamt ?? entry.planrate ?? share.prate ?? result.planrate);
  const cgst = subTax("CGST");
  const sgst = subTax("SGST");
  // Native reads the TOP-LEVEL othcharge here, not the entry's.
  const otherCharges = amount(result.othcharge?.amt ?? entry.othcharge?.amt);
  const balanceAmount = amount(share.balamt);
  const totalAmount = round2(total);
  const operatorShare = amount(share.optrshare);
  const ispShare = amount(share.bbnlshare);
  const softwareCharges = amount(share.softcharge);
  const tds = amount(share.tds);

  return {
    ok: true,
    planName,
    planRate,
    cgst,
    sgst,
    otherCharges,
    balanceAmount,
    totalAmount,
    operatorShare,
    ispShare,
    softwareCharges,
    tds,
    // EmployeeCommonPaymentInfoFragment.java:287 — derived, never read from a
    // field. `totbbnlshare` is a different quantity and disagrees on live data.
    amountDeductable: round2(totalAmount - operatorShare),
    // What native sends as savePaymentApi's `cashpaid`: the customer's full
    // bill (:282 totalAmount = planrates.get_$1().getTotal() → :434 cashpaid).
    // The wallet debit is settled server-side from the share split.
    cashpaid: totalAmount,
    walletBalance,
    // Native shows a "payment pending" notice for anything but "no" (:298).
    isPending: String(result.ispending ?? "no").trim().toLowerCase() !== "no",
  };
}
