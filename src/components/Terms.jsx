import React from "react";

export default function Terms() {
    return (
        <div className="rounded-lg max-h-[68vh] overflow-y-auto space-y-2 text-gray-800 text-sm leading-relaxed">
            <p className="text-lg font-bold">Terms and Conditions</p>
            <p className="text-bold">Please read these terms and conditions carefully before subscribing to our internet service.</p>

            <strong>Commitment Period:</strong> The minimum commitment period for our internet service is 6 months from the date of activation.
            <ul className="list-disc pl-6 space-y-2">
                <li>If the customer disconnects the service during this time, they will have to pay for the remaining months.</li>
                <li>During this time temporary disconnection is allowed, a maintenance fee of ₹100 will be charged to keep the account active. The 6 months commitment will get extended to subsequent month/s in order to maintain the committed months.</li>
                <li>During this time customers cannot downgrade the bandwidth but they can upgrade.</li>
                <li>Payment has to be done online or in the nearby office of BBNL. If payment needs to be collected at the premises, a collection fee of ₹30 will be charged extra apart from the monthly service charge.</li>
                <li>The Security Deposit will be refunded only after 1 year completion. Service is prepaid.</li>
                <li>Since this is a prepaid service, the customer has to pay in advance to avail the service.</li>
                <li>Billing cycle starts from the 1st to end of the month.</li>
                <li>If you avail the service after 1st of the month, you will be charged based on a prorated model, and from the subsequent month you will be billed from the 1st of every month.</li>
            </ul>

            <p className="font-bold">Device installed in the customer premises......</p>
            <ul className="list-disc pl-6 space-y-2">
                <li>Devices installed are the sole property of BBNL and any tampering or manhandling of the hardware is not allowed. If found, the customer is liable to bear the cost of the hardware.</li>
                <li>Device will be replaced only if there is any manufacturing defect.</li>
                <li>If the device is burnt due to power fluctuation or any high voltage issues, customers need to pay for the device.</li>
                <li>BBNL will replace devices due to natural calamity like lightning and thunder or any manufacturing defect.</li>
                <li>Devices should be returned to the Franchisee of BBNL at the time of disconnection. If not returned, a collection agency will be involved to retrieve the hardware.</li>
            </ul>

            <p className="font-bold">Documents to provide service.......</p>
            <ul className="list-disc pl-6 space-y-2">
                <li>This is a Government Rule. Customer should provide the following:
                    <ul className="list-[lower-alpha] pl-6 space-y-1">
                        <li>A photo</li>
                        <li>Id proof</li>
                        <li>Address proof</li>
                    </ul>
                </li>
                <li>Email/Phone number should be valid, as only through the email your confirmation, maintenance, or payment is tracked or billed.</li>
                <li>If the address is not available immediately, a grace period of 2 weeks will be given. Within this period the document should be provided, otherwise, the connection will be disabled until provided.</li>
            </ul>

            <p>I hereby abite by the rules which has been laid by BBNL.</p>
        </div>
    );
}
