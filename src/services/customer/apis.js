// API services
import { apiFetch, getBaseUrl, getHeadersForm, readEnvelopeRaw } from "../apiCore";

/**
 * Ad carousel images.
 *
 * NOTE: `apis/webads` does NOT use the standard {status, body} envelope —
 * it returns `imglist` at the TOP LEVEL (see Dashboard.jsx, which reads
 * `data?.imglist` directly, not `data.body.imglist`). So this endpoint is
 * deliberately NOT gated on err_code: isEnvelopeOk() fails closed when
 * `status` is absent, which would turn every currently-working ads response
 * into a thrown error and blank the carousel.
 *
 * readEnvelopeRaw still guards the two failures that matter here — transport
 * (non-2xx) and malformed JSON — without asserting an envelope this endpoint
 * never had. Do not "upgrade" this to readEnvelope without first confirming
 * against a live prod response that webads actually returns a status block.
 */
export async function ads(type) {
  const url = `${getBaseUrl()}apis/webads`;
  const headers = getHeadersForm();

  const formData = new FormData();
  formData.append("type", type);

  const resp = await apiFetch(url, {
    method: "POST",
    headers,
    body: formData,
  }, "ads", { group: "Customer" });

  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return readEnvelopeRaw(resp, "ads");
}
