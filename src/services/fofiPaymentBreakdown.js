/**
 * FoFi / Cable "Review" screen figures — Operator Share and Amount Deductable.
 *
 * Port of what the Android app renders from `service/paymentinfo/{servicekey}`
 * (the PaymentInfoSummaryModel path). Source of truth, both identical:
 *
 *   RegistrationPaymentOverviewActivity.requestFinished()  :357-362
 *   EmployeeCommonPaymentInfoFragment.requestFinished()    :231-236
 *
 *     amountdeductable = body.total_amt
 *                      - body.final_split_data.OPERATOR.amount
 *
 *     setPaymentSplitups("Operator Share",  final_split_data.OPERATOR.amount,
 *                        "", "", "", "", "", "",
 *                        "Amount Deductable", amountdeductable)
 *
 * That is the whole rule. Two rows, one subtraction, no special cases — which
 * is why this screen shows only Operator Share and Amount Deductable and not
 * the ISP/Software/TDS rows the internet screen has.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The PWA had TWO divergent copies of this calculation — one in
 * FoFiSmartBox.jsx, one in FofiPayment.jsx — each a ladder of guesses:
 * `deduction.totalamount` → `fofishare` → `final_split_data.FOFI.amount` →
 * total, plus two hardcoded plan-name rules. Neither matched Android.
 *
 * The plan-name rules were the live bug. `isFoFiFtaOnlyPlan()` compacted the
 * name and tested `.includes('ftaonly')`, so "FOFI-Box + FTA ONLY" — a REAL
 * ₹334.52 plan — returned 0 and the operator saw "Amount Deductable ₹0.00"
 * where the app showed ₹181.12.
 *
 * This is a REGRESSION of a production incident already diagnosed in May 2026.
 * "FTA" in a BBNL plan name denotes the included channel tier (Free To Air),
 * NOT that the plan is free. There is no plan-name test that can tell you what
 * a plan costs. If you ever need to know whether money must move, ask the
 * numbers: `operatorShare > 0` or `total_amt > 0`. Never the name.
 *
 * The second hardcoded rule (`isFoFiDhamakaOfferPlan → 35.40`) is the same
 * mistake wearing a different hat: a single operator's split, frozen into the
 * client, that silently goes wrong the moment BBNL re-prices the offer.
 *
 * NOTE ON THE WIRE: this value is DISPLAY ONLY. `cabletv/generateorder` takes
 * `paidamount = total_amt` for every plan (native parity — see FofiPayment.jsx),
 * and the wallet split is settled server-side. Changing what this function
 * returns must never change what is charged.
 */

/** Parse a backend amount. Returns null when there is genuinely no number. */
export function parseFofiAmount(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "object") return null;
  const amount = parseFloat(String(value).replace(/,/g, ""));
  return Number.isFinite(amount) ? amount : null;
}

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * The operator's share of the bill.
 *
 * Native reads `final_split_data.OPERATOR.amount`. `oprtrshare` is a sibling
 * top-level field that usually carries the same number; it is kept only as a
 * fallback for responses that omit the split block.
 */
export function fofiOperatorShare(body) {
  const fromSplit = parseFofiAmount(
    body?.final_split_data?.OPERATOR?.amount ??
    body?.final_split_data?.operator?.amount
  );
  if (fromSplit !== null) return round2(fromSplit);

  const fromField = parseFofiAmount(body?.oprtrshare ?? body?.optrshare);
  return fromField === null ? 0 : round2(fromField);
}

/**
 * What comes out of the operator's wallet: the customer bill minus the
 * operator's own share.
 *
 * Deliberately NOT clamped at zero — native doesn't clamp, and a negative here
 * means the split block disagrees with the total, which is worth seeing rather
 * than hiding.
 *
 * @param {object} body            paymentinfo response body
 * @param {object} [opts]
 * @param {number} [opts.fallback] used only when `total_amt` is absent entirely
 */
export function fofiAmountDeductable(body, { fallback = null } = {}) {
  const total = parseFofiAmount(
    body?.total_amt ?? body?.totalamount ?? body?.grandtotal
  );

  if (total === null) {
    const fb = parseFofiAmount(fallback);
    return fb === null ? 0 : round2(fb);
  }

  return round2(total - fofiOperatorShare(body));
}

/**
 * Every row of the Review screen, mapped exactly as native does.
 * `tax_details` is a list of {title, amt} — native switches on the title.
 */
export function buildFofiBreakdown(body, { fallbackPlanName = "" } = {}) {
  const taxes = Array.isArray(body?.tax_details) ? body.tax_details : [];
  const taxByTitle = (want) => {
    const hit = taxes.find(
      (t) => String(t?.title ?? "").trim().toUpperCase() === want
    );
    const amt = parseFofiAmount(hit?.amt ?? hit?.amount ?? hit?.value);
    return amt === null ? 0 : round2(amt);
  };

  const num = (v) => {
    const n = parseFofiAmount(v);
    return n === null ? 0 : round2(n);
  };

  const operatorShare = fofiOperatorShare(body);

  return {
    planName:
      String(body?.planname ?? body?.plan_name ?? body?.serv_name ?? "").trim() ||
      String(fallbackPlanName ?? "").trim() ||
      "N/A",
    planRate: num(body?.planrate),
    cgst: taxByTitle("CGST"),
    sgst: taxByTitle("SGST"),
    otherCharges: num(body?.other_amt),
    balanceAmount: num(body?.balance_amt),
    totalAmount: num(body?.total_amt),
    operatorShare,
    amountDeductable: fofiAmountDeductable(body),
    transactionId: String(body?.transactionid ?? "").trim(),
  };
}
