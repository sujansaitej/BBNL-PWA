/**
 * Dirty-check for the customer Profile screen.
 *
 * Mirrors Android ProfileFragment L226-236 exactly: raw (untrimmed) !=
 * comparison against the last values fetched from custViewProfile. Any
 * difference in any of the four fields submits; none means "No changes made!".
 * Extracted so it can be tested without rendering the page.
 */
export const PROFILE_FIELDS = ["firstname", "lastname", "mobileno", "emailid"];

export function isDirty(form, saved) {
  if (!saved) return false;
  return PROFILE_FIELDS.some((k) => (form[k] ?? "") !== (saved[k] ?? ""));
}
