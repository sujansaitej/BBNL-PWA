import { useMemo, useState } from "react";
import Layout from "../layout/Layout";
import { useNavigate } from "react-router-dom";
import { getOnuHwDets, registerCustomer } from "../services/registrationApis";
import {
  planHasVoice,
  planNeedsBox,
  planNeedsInternet,
  registrationServices,
  serviceLabels,
} from "../services/registrationPlans";
import { Button, Badge, Input, FloatingInput } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { getUser, safeGetJSON } from "../services/safeStorage";
import { lsRemove } from "../services/lsCache";

const CUSTLIST_CACHES = [
  "custlist_all",
  "custlist_live",
  "custlist_expiring",
  "custlist_expired",
  "custlist_inactive",
];

export default function Subscribe() {
  const navigate = useNavigate();
  const toast = useToast();
  const selectedPlan = safeGetJSON("selectedPlan", {});
  const groups = safeGetJSON("groups", []);

  // Which sections this registration actually needs. Previously every
  // registration was hardcoded to `services: ["internet"]` with the FoFi box
  // fields blanked, so a bundled plan — the only kind that provisions a VOIP
  // line — could not be registered at all.
  const needsInternet = planNeedsInternet(selectedPlan);
  const needsBox = planNeedsBox(selectedPlan);
  const hasVoice = planHasVoice(selectedPlan);
  const services = useMemo(() => registrationServices(selectedPlan), [selectedPlan.key]);

  const [form, setForm] = useState({
    groupid: "",
    onumacid: "",
    internet_hardwareid: "",
    fofiboxid: "",
    fofimac: "",
    fofiserailnumber: "",
    installationcharges: "",
    othercharges: "",
    otherchargesremarks: "",
  });
  const [errors, setErrors] = useState({});
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const user = getUser();
  const logUname = user.username || "";
  const op_id = user.op_id || "";

  const effectiveGroupId =
    form.groupid || (groups[0] ? String(groups[0].group_id) : "");

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleFormChange = (val, field) => {
    setForm((prev) => ({ ...prev, [field]: val }));
  };

  const handleGetMac = async () => {
    setErrors((p) => ({ ...p, onumacid: null }));
    if (!form.onumacid) {
      setErrors((p) => ({ ...p, onumacid: "Enter ONU MAC" }));
      return;
    }

    setChecking(true);
    try {
      const res = await getOnuHwDets(op_id, form.onumacid);
      const hw = res?.body?.hardwareid || "";
      // setState, not a direct mutation of `form`. The old code assigned to
      // form.internet_hardwareid, which React never re-rendered from — the
      // field only appeared to fill in because an unrelated render followed.
      setForm((prev) => ({ ...prev, internet_hardwareid: hw }));
      if (!hw) {
        setErrors((p) => ({ ...p, onumacid: res?.status?.err_msg || "Could not resolve this ONU MAC" }));
      }
    } catch (err) {
      setErrors((p) => ({ ...p, onumacid: "Invalid ONU MAC" }));
    } finally {
      setChecking(false);
    }
  };

  const handleSubscribe = async (e) => {
    e.preventDefault();

    const newErrors = {};
    if (needsInternet) {
      if (!effectiveGroupId) newErrors.groupid = "Select Internet Group";
      if (!form.onumacid) newErrors.onumacid = "Enter ONU MAC";
    }
    if (needsBox) {
      // Android gates the same two fields before upgradeRegistration
      // (ServiceSubscriptionsActivity.requesrServerPlanUpgradation).
      if (!form.fofiboxid) newErrors.fofiboxid = "Enter the FoFi Box ID";
      if (!form.fofimac) newErrors.fofimac = "Enter the FoFi Box MAC";
    }
    if (form.othercharges && parseFloat(form.othercharges) > 0) {
      if (!form.otherchargesremarks) {
        newErrors.otherchargesremarks = "Enter the reason for other charges";
      }
    }
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;

    const regDataObj = safeGetJSON("registrationData", {});
    delete regDataObj.termsAccepted;

    const subscriptionData = {
      ...regDataObj,
      // Internet section — blank unless this plan provisions a connection.
      groupid: needsInternet ? effectiveGroupId : "",
      onumacid: needsInternet ? form.onumacid : "",
      internet_hardwareid: needsInternet ? form.internet_hardwareid : "",
      installationcharges: form.installationcharges,
      othercharges: form.othercharges,
      otherchargesremarks: form.otherchargesremarks,
      loginuname: logUname,
      op_id: op_id,
      // FoFi box hardware — blank unless the plan carries fofi/cabletv.
      fofiboxid: needsBox ? form.fofiboxid : "",
      fofimac: needsBox ? form.fofimac : "",
      fofiserailnumber: needsBox ? form.fofiserailnumber : "",
      isRegistered: false,
      ispayement: false,
      // Plan identity comes from the plan the operator picked, not from a
      // hardcoded internet-only stub. Set on the row by Plans.selectPlan.
      internet_servid: selectedPlan.internet_servid ?? regDataObj.internet_servid ?? "",
      payurl: selectedPlan.payurl ?? "",
      planid: selectedPlan.planid ?? "",
      planname: selectedPlan.planname ?? "",
      priceid: selectedPlan.priceid ?? "",
      servid_pay: selectedPlan.servid_pay ?? "",
      services,
    };

    localStorage.setItem("registrationData", JSON.stringify(subscriptionData));
    setSubmitting(true);
    try {
      const res = await registerCustomer(subscriptionData);
      if (res?.status?.err_code !== 0) {
        toast.add("Registration failed: " + (res?.status?.err_msg || "Unknown error"), { type: "error" });
        return;
      }

      // ── VOIP allocation ────────────────────────────────────────────────
      // The operator never types a VOIP number; the backend allocates one and
      // returns it here. Android reads exactly this field and carries it into
      // the payment request as `voipnumber`
      // (ServiceSubscriptionsActivity.java:1218-1220). The PWA previously
      // discarded the whole response body, so a registered line was invisible
      // and unpayable.
      const voipnumber = res?.body?.voipno || "";
      const registered = { ...subscriptionData, isRegistered: true, voipnumber };
      localStorage.setItem("registrationData", JSON.stringify(registered));

      ["photoFileId", "idcardIds", "addrproofIds"].forEach((k) => localStorage.removeItem(k));
      CUSTLIST_CACHES.forEach(lsRemove);

      if (voipnumber) {
        toast.add(`Registered. VOIP number allocated: ${voipnumber}`, { type: "success" });
      } else {
        toast.add("Registered successfully!", { type: "success" });
      }

      if (needsInternet) {
        // Unchanged path: the internet registration payment
        // (apis/makepayment + apis/savePaymentApi).
        navigate("/paynow");
      } else {
        // Non-internet plans are billed through service/paymentinfo +
        // cabletv/generateorder, which in this app lives on the per-service
        // screens rather than in the registration flow. Hand the operator
        // straight there instead of inventing a second money path here.
        navigate(`/customer/${encodeURIComponent(subscriptionData.username || "")}/services`, {
          state: { justRegistered: true, voipnumber, planname: selectedPlan.planname },
        });
      }
    } catch (err) {
      toast.add(err?.message || "Registration failed. Please try again.", { type: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  const planPrice = selectedPlan?.price ?? "";
  const currency = import.meta.env.VITE_API_APP_DEFAULT_CURRENCY_SYMBOL;

  return (
    <Layout>
      <div className="max-w-2xl mx-auto space-y-2 px-3 py-2">
        <div className="space-y-3">
          <div className="items-center justify-between bg-white dark:bg-gray-800 p-3 rounded-xl shadow">
            <h2 className="text-md font-semibold dark:text-gray-100 mb-2">Plan Details</h2>
            <div className="flex flex-col gap-2 text-sm">
              <div className="flex">
                <span className="w-28 font-medium text-gray-700 dark:text-gray-300">Services</span>
                <span className="text-gray-500 dark:text-gray-400">
                  {serviceLabels(selectedPlan).join(", ") || "Internet"}
                </span>
              </div>

              <div className="flex">
                <span className="w-28 font-medium text-gray-700 dark:text-gray-300">Plan Name</span>
                <span className="text-gray-500 dark:text-gray-400">{selectedPlan?.name || "—"}</span>
              </div>

              <div className="flex gap-4">
                {selectedPlan?.label && <Badge color="indigo">{selectedPlan.label}</Badge>}
                <Badge color="purple" size="sm">{currency + " " + planPrice}</Badge>
              </div>

              {hasVoice && (
                <p className="text-xs text-emerald-600">
                  This plan registers a VOIP line. The number is allocated by the
                  server when the registration is submitted.
                </p>
              )}
            </div>
          </div>

          {needsInternet && (
            <>
              <div className="rounded-xl bg-white dark:bg-gray-800 p-4 shadow space-y-3">
                <h2 className="text-md font-semibold dark:text-gray-100">Internet Group</h2>
                <div className="flex gap-2 items-start">
                  <select
                    name="groupid"
                    value={effectiveGroupId}
                    onChange={handleChange}
                    className="px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-500 text-gray-900 dark:text-white shadow-sm w-full"
                  >
                    <option value="">Select</option>
                    {groups.map((g) => (
                      <option key={g.group_id} value={g.group_id}>
                        {g.group_name}
                      </option>
                    ))}
                  </select>
                </div>
                {errors.groupid && <p className="text-xs text-red-500">{errors.groupid}</p>}
              </div>

              <div className="rounded-xl bg-white dark:bg-gray-800 p-4 shadow space-y-3">
                <h2 className="text-md font-semibold dark:text-gray-100">ONU Details</h2>
                <div className="flex gap-2 items-start">
                  <Input
                    label="ONU MAC"
                    name="onumacid"
                    value={form.onumacid}
                    onChange={handleChange}
                    error={errors.onumacid}
                    required
                  />
                  <button
                    type="button"
                    onClick={handleGetMac}
                    disabled={checking}
                    className="w-32 rounded-lg border border-blue-500 py-3 text-sm text-blue-500 hover:bg-blue-50"
                  >
                    {checking ? "Checking..." : "Get MAC"}
                  </button>
                </div>
                <Input
                  label="ONU Box(Hardware) ID"
                  name="internet_hardwareid"
                  value={form.internet_hardwareid}
                  onChange={handleChange}
                  error={errors.internet_hardwareid}
                />
              </div>
            </>
          )}

          {needsBox && (
            <div className="rounded-xl bg-white dark:bg-gray-800 p-4 shadow space-y-3">
              <h2 className="text-md font-semibold dark:text-gray-100">FoFi Box</h2>
              <Input
                label="FoFi Box ID"
                name="fofiboxid"
                value={form.fofiboxid}
                onChange={handleChange}
                error={errors.fofiboxid}
                required
              />
              <Input
                label="FoFi Box MAC"
                name="fofimac"
                value={form.fofimac}
                onChange={handleChange}
                error={errors.fofimac}
                required
              />
              <Input
                label="FoFi Serial Number"
                name="fofiserailnumber"
                value={form.fofiserailnumber}
                onChange={handleChange}
                error={errors.fofiserailnumber}
              />
              <p className="text-[11px] text-gray-400">
                Scan-and-validate for a box lives on the customer’s Fo-Fi Smart Box
                screen. Entered here, the ID and MAC are validated by the server on
                submit.
              </p>
            </div>
          )}

          <div className="rounded-xl bg-white dark:bg-gray-800 p-4 shadow space-y-3">
            <h2 className="text-md font-semibold dark:text-gray-100">Charges</h2>
            <FloatingInput
              label="Installation charges if any"
              name="installationcharges"
              value={form.installationcharges}
              onChange={handleFormChange}
              onlyNumbers
              len={6}
            />
            <FloatingInput
              label="Other charges if any"
              name="othercharges"
              value={form.othercharges}
              onChange={handleFormChange}
              onlyNumbers
              len={6}
            />
            {form.othercharges && parseFloat(form.othercharges) > 0 && (
              <FloatingInput
                label="Other charges reason"
                name="otherchargesremarks"
                value={form.otherchargesremarks}
                onChange={handleFormChange}
                error={errors.otherchargesremarks}
                onlyLetters
                len={150}
                required={true}
              />
            )}
          </div>

          <Button
            fullWidth
            loadingText="Registering..."
            onClick={handleSubscribe}
            disabled={submitting}
            submitting={submitting}
          >
            Register
          </Button>
        </div>
      </div>
    </Layout>
  );
}
