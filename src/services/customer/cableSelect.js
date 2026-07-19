// Cable TV channel/package selection helpers — PURE, side-effect-free.
//
// Ported from the Android CableTV package/channel picker. No React, no network,
// no imports: every function takes state in and returns new state out, so the
// selection rules can be unit-tested without a DOM or a backend.
//
// STATE SHAPES:
//   selectedPackages: [{ pkgid, pkgcode, pkgctg }]   pkgctg = category id (string)
//   selectedChannels: [{ chid, lcochid }]
//
// A package or channel that is already active on the box ("subscribed") is
// shown but locked — it cannot be toggled. The base pack of a mandatory
// category is likewise locked once selected: the box requires it.

/** True when the package is already active on the box → cannot be toggled. */
export function isPackageSubscribed(pkg) {
  if (String(pkg?.disable).toLowerCase() === "yes") return true;
  const s = pkg?.issubscribed;
  if (s == null) return false;
  const v = String(s).toLowerCase();
  return v !== "" && v !== "no" && v !== "0";
}

/** True when the channel is already active on the box → cannot be toggled. */
export function isChannelSubscribed(chan) {
  if (String(chan?.disable).toLowerCase() === "yes") return true;
  const s = chan?.issubscribed;
  return s != null && String(s).toLowerCase() !== "no";
}

/**
 * True when pkg is the base pack of a category flagged mandatory. Such a pack
 * is required by the box and may not be deselected.
 */
export function isMandatoryBasePack(pkg, categories) {
  const code = String(pkg?.pkgcode);
  return (categories || []).some(
    (c) => c?.mandatory === "yes" && String(c?.basepack) === code
  );
}

/** Is a package with this pkgid in the selection? (string-compare) */
export function isPackageSelected(selectedPackages, pkgid) {
  const id = String(pkgid);
  return (selectedPackages || []).some((p) => String(p?.pkgid) === id);
}

/** Is a channel with this chid in the selection? (string-compare) */
export function isChannelSelected(selectedChannels, chid) {
  const id = String(chid);
  return (selectedChannels || []).some((c) => String(c?.chid) === id);
}

/**
 * Toggle a package in/out of the selection. Returns a NEW array (or the same
 * reference unchanged when the action is blocked/locked).
 *
 *  - subscribed → blocked (unchanged)
 *  - already selected → remove, unless it is a mandatory base pack (locked)
 *  - not selected → add; a "single" category replaces its current pick,
 *    a "multi" category appends.
 */
export function togglePackage(selectedPackages, pkg, category, categories) {
  if (isPackageSubscribed(pkg)) return selectedPackages;

  if (isPackageSelected(selectedPackages, pkg.pkgid)) {
    if (isMandatoryBasePack(pkg, categories)) return selectedPackages; // locked
    const id = String(pkg.pkgid);
    return selectedPackages.filter((p) => String(p.pkgid) !== id);
  }

  const ctg = String(category?.id);
  const entry = { pkgid: String(pkg.pkgid), pkgcode: String(pkg.pkgcode), pkgctg: ctg };
  if (category?.selectiontype === "single") {
    // Replace whatever was selected within this category.
    return [...selectedPackages.filter((p) => String(p.pkgctg) !== ctg), entry];
  }
  return [...selectedPackages, entry];
}

/**
 * Toggle a channel in/out of the selection by chid. Returns a NEW array (or the
 * same reference unchanged when the channel is subscribed).
 */
export function toggleChannel(selectedChannels, chan) {
  if (isChannelSubscribed(chan)) return selectedChannels;
  const id = String(chan.chid);
  if (isChannelSelected(selectedChannels, chan.chid)) {
    return selectedChannels.filter((c) => String(c.chid) !== id);
  }
  return [...selectedChannels, { chid: chan.chid, lcochid: chan.lcochid }];
}

/**
 * Ensure every mandatory category has a selected package, defaulting to its
 * base pack. Returns a NEW array. If the base pack isn't in the category's
 * package list, that category is skipped (no throw).
 */
export function applyMandatoryBasePacks(selectedPackages, categories, packagesByCategory) {
  const out = [...(selectedPackages || [])];
  for (const c of categories || []) {
    if (c?.mandatory !== "yes") continue;
    const ctg = String(c.id);
    if (out.some((p) => String(p.pkgctg) === ctg)) continue; // already picked
    const list = packagesByCategory?.[ctg] || [];
    const base = list.find((p) => String(p?.pkgcode) === String(c.basepack));
    if (!base) continue; // base pack absent from list → skip
    out.push({ pkgid: String(base.pkgid), pkgcode: String(base.pkgcode), pkgctg: ctg });
  }
  return out;
}

/**
 * Flatten the selection into the parallel string arrays the renewal endpoint
 * expects. NOTE pkgcode is a distinct value from pkgid — do not equate them.
 */
export function assembleSelectionIds(selectedPackages, selectedChannels) {
  return {
    packageid: (selectedPackages || []).map((p) => String(p.pkgid)),
    pkgcode: (selectedPackages || []).map((p) => String(p.pkgcode)),
    channelid: (selectedChannels || []).map((c) => String(c.chid)),
    lcochid: (selectedChannels || []).map((c) => String(c.lcochid)),
  };
}

/** The Proceed button is enabled once anything is selected. */
export function canProceed(selectedPackages, selectedChannels) {
  return (selectedPackages?.length || 0) > 0 || (selectedChannels?.length || 0) > 0;
}
