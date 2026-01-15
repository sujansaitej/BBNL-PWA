import { useState } from "react";
import Layout from "../layout/Layout";
import { useNavigate } from "react-router-dom";
import { getOnuHwDets, registerCustomer } from "../services/registrationApis";
import { Button, Badge, Input, FloatingInput } from "@/components/ui";

export default function Subscribe() {
  const navigate = useNavigate();
  const selectedPlan = JSON.parse(localStorage.getItem('selectedPlan')) || {};
  const groups = JSON.parse(localStorage.getItem('groups')) || [];

  const [form, setForm] = useState({ groupid: "", onumacid: "", internet_hardwareid: "", installationcharges : "", othercharges: "", otherchargesremarks: "" });
  const [errors, setErrors] = useState({});
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const logUname = JSON.parse(localStorage.getItem('user')).username;
  const op_id = JSON.parse(localStorage.getItem('user')).op_id;
  form.groupid = form.groupid ? form.groupid : (groups[0] ? groups[0].group_id : "");

    const handleChange = (e) =>
        setForm({ ...form, [e.target.name]: e.target.value });

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
        form.internet_hardwareid = "";
        try {
            const res = await getOnuHwDets(op_id, form.onumacid);
            form.internet_hardwareid = res?.body?.hardwareid || "";
            // if (!form.internet_hardwareid) {
            //     setErrors((p) => ({ ...p, onumacid: "Invalid ONU MAC" }));
            // }
        } catch (err) {
            setErrors((p) => ({ ...p, onumacid: "Invalid ONU MAC" }));
        } finally {
            setChecking(false);
        }setChecking(false);
    };

    const handleSubscribe = async (e) => {
        e.preventDefault();

        const newErrors = {};
        if (!form.groupid) newErrors.groupid = "Select Internet Group";
        if (!form.onumacid) newErrors.onumacid = "Enter ONU MAC";
        if (form.othercharges){
            if (!form.otherchargesremarks) newErrors.otherchargesremarks = "Enter the reason for other charges";
        }
        setErrors(newErrors);
        if (Object.keys(newErrors).length > 0) return;

        const regData = localStorage.getItem('registrationData');
        const regDataObj = regData ? JSON.parse(regData) : {};
        delete regDataObj.termsAccepted;
        const subscriptionData = {
            ...regDataObj,
            ...form,
            loginuname: logUname,
            op_id: op_id,
            fofiboxid: "",
            fofimac: "",
            fofiserailnumber: "",
            isRegistered: false,
            ispayement: false,
            payurl: "",
            planid: "",
            planname: "",
            priceid: "",
            services: [
                "internet"
            ]
        };
        
        // console.log("Subscription Data:", subscriptionData);
        localStorage.setItem('registrationData', JSON.stringify(subscriptionData));
        setSubmitting(true);
        try {
            const res = await registerCustomer(subscriptionData);
            // console.log("Registration response:", res);
            if (res?.status?.err_code !== 0) {
                alert("Registration failed: " + (res?.status?.err_msg || "Unknown error"));
                return;
            }else{
                setSubmitting(false);
                const keysToRemove = ['photoFileId', 'idcardIds', 'addrproofIds'];
                keysToRemove.forEach(key => localStorage.removeItem(key));
                alert("Registered successfully!");
                navigate('/paynow');
                // window.location.href = '/paynow';
            }
        } catch (err) {
            setErrors((p) => ({ ...p, onumacid: "Invalid ONU MAC" }));
        }finally {
            setSubmitting(false);
            setForm({ groupid: "", onumacid: "", internet_hardwareid: "", installationcharges : "", othercharges: "", otherchargesremarks: "" }); // Clear form
        }
    }
    
  return (
    <Layout>
      <div className="max-w-2xl mx-auto space-y-2 px-3 py-2">
        {/* <h1 className="text-medium font-bold text-gray-900 dark:text-white">Complete the Registration</h1> */}

        <div className="space-y-3">
            <div className="items-center justify-between bg-white p-3 rounded-xl shadow">
                <h2 className="text-md font-semibold dark:text-gray-700 mb-2">Plan Details</h2>
                <div className="flex flex-col gap-2 text-sm">
                    
                    <div className="flex">
                        <span className="w-28 font-medium text-gray-700 dark:text-gray-600">Service Type</span>
                        <span className="text-gray-500 dark:text-gray-600">Internet</span>
                    </div>

                    <div className="flex">
                        <span className="w-28 font-medium text-gray-700 dark:text-gray-600">Plan Name</span>
                        <span className="text-gray-500 dark:text-gray-600">{ selectedPlan.serv_name }</span>
                    </div>

                    <div className="flex gap-4">
                        <Badge color="indigo">{ selectedPlan.serv_rates?.labels[0] }</Badge>
                        <Badge color="purple" size="sm"> {import.meta.env.VITE_API_APP_DEFAULT_CURRENCY_SYMBOL +' '+ selectedPlan.serv_rates?.prices[0] }</Badge>
                    </div>
                </div>
            </div>

            <div className="rounded-xl bg-white p-4 shadow space-y-3">
                <h2 className="text-md font-semibold dark:text-gray-700">Internet Group</h2>
                <div className="flex gap-2 items-start">
                    <select
                        name="groupid"
                        value={form.groupid}
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
            </div>

            <div className="rounded-xl bg-white p-4 shadow space-y-3">
                <h2 className="text-md font-semibold dark:text-gray-700">ONU Details</h2>
                <div className="flex gap-2 items-start">
                    <Input
                        label="ONU MAC"
                        name="onumacid"
                        value={form.onumacid}
                        onChange={handleChange}
                        error={errors.onumacid}
                        required
                    />
                    <button type="button" onClick={handleGetMac} disabled={checking} className="w-32 rounded-lg border border-blue-500 py-3 text-sm text-blue-500 hover:bg-blue-50">
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
                {form.othercharges && parseFloat(form.othercharges) > 0 &&
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
                }
            </div>
            <Button fullWidth loadingText="Registering..." onClick={handleSubscribe} disabled={submitting} submitting={submitting}>
                Register
            </Button>
            {/* <div className="text-xs text-gray-500 dark:text-gray-400">Note: After registration, login credentials will be sent to the customer's email and mobile number provided during registration.</div> */}
        </div>

      </div>
    </Layout>
  );
}
