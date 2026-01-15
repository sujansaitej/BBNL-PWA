import React, { useState, useEffect } from "react";
import { TicketIcon } from '@heroicons/react/24/outline'
const TicketDialog = ({
  open,
  type = "close", // "close" | "transfer"
  ticket = {},
  employees = [],
  onSubmit,
  onCancel,
}) => {
  const [reason, setReason] = React.useState("");
  const [selectedEmp, setSelectedEmp] = React.useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  React.useEffect(() => {
    if (!open) {
      setReason("");
      setSelectedEmp("");
      setError("");
      setLoading(false);
    }
  }, [open]);

  const handleSubmit = async () => {
    if (type === "close" && !reason.trim()) {
      setError("Reason/remark is required.");
      return;
    }
    if (type === "transfer" && !selectedEmp) {
      setError("Please select an employee to transfer.");
      return;
    }

    setError("");
    setLoading(true);
    try {
      await onSubmit(
        type === "close"
          ? { reason }
          : { employeeId: selectedEmp }
      );
    } catch (e) {
      console.error("Submission failed:", e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Overlay */}
      <div
        className={`fixed inset-0 bg-black/40 backdrop-blur-sm z-40 transition-opacity duration-300 ${
          open ? "opacity-100 visible" : "opacity-0 invisible"
        }`}
      />

      {/* Dialog container */}
      <div
        className={`fixed inset-0 z-50 flex items-center justify-center p-4 transition-all duration-300 ${
          open
            ? "opacity-100 scale-100 translate-y-0 visible"
            : "opacity-0 scale-95 translate-y-4 invisible"
        }`}
      >
        <div className="bg-white w-full max-w-md rounded-2xl shadow-xl p-6 flex flex-col gap-2">
          <h2 className="text-lg font-semibold text-blue-600 dark:text-blue-500 mb-2 justify-center flex">
            <TicketIcon className="h-6 w-6 text-indigo-700 dark:text-indigo-500 mt-0.5 mr-2" />
            {type === "close" ? "Close Job" : "Transfer Job"}
          </h2>
          <div className={`flex`}>
            <p className="w-24 text-sm text-gray-600">Job ID</p>
            <p className="font-medium text-gray-600 dark:text-gray-500">: #{ticket?.tid}</p>
          </div>
          <div className={`flex`}>
            <p className="w-24 text-sm text-gray-600 dark:text-gray-500">Cust. Name</p>
            <p className="font-sm text-gray-600 capitalize">: {ticket?.customername}</p>
          </div>
          <div className={`flex`}>
            <p className="w-24 text-sm text-gray-600 dark:text-gray-500">Complaint</p>
            <p className="text-sm text-gray-600 capitalize">: {ticket?.subject}</p>
          </div>

          {/* Conditional fields */}
          {type === "close" ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-500 mb-1">
                Reason / Remarks <span className="text-red-500">*</span>
              </label>
              <textarea
                className={`w-full border rounded-lg p-2 text-sm dark:text-gray-500 focus:ring-1 focus:outline-none ${
                  error && type === "close"
                    ? "border-red-500"
                    : "border-gray-300"
                }`}
                rows="3"
                value={reason}
                onChange={(e) => { setReason(e.target.value); setError(""); }}
                placeholder="Enter reason/remarks for closing the job..."
                disabled={loading}
              />
              {error && type === "close" && (
                <p className="text-red-500 text-xs">{error}</p>
              )}
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-500 mb-1">
                Transfer To
              </label>
              <select
                className={`w-full border rounded-lg p-2 text-sm dark:text-gray-500 focus:ring-2 focus:outline-none ${
                  error && type === "transfer"
                    ? "border-red-500"
                    : "border-gray-300"
                }`}
                value={selectedEmp}
                onChange={(e) => { setSelectedEmp(e.target.value); setError(""); }}
                disabled={loading}
              >
                <option value="">Select Employee</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name}
                  </option>
                ))}
              </select>
              {error && type === "transfer" && (
                <p className="text-red-500 text-xs">{error}</p>
              )}
            </div>
          )}

          {/* Buttons */}
          <div className="mt-2 flex justify-center gap-3">
            {type === "close" ? (
              <button
                onClick={handleSubmit}
                // disabled={!reason.trim()}
                disabled={loading}
                className={`px-4 py-2 text-sm text-white bg-blue-600 dark:bg-blue-400 rounded-lg flex items-center justify-center ${loading ? "opacity-75 cursor-wait" : ""}`}
              >
                {loading && (
                <svg
                  className="w-4 h-4 animate-spin text-white"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  ></circle>
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                  ></path>
                </svg>
              )}
              {loading
                ? "Processing..."
                : type === "close"
                ? "Close"
                : "Transfer"}
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                // disabled={!selectedEmp}
                disabled={loading}
                className="px-4 py-2 text-sm text-white bg-blue-600 dark:bg-blue-400 rounded-lg transition-colors"
              >
                Transfer Job
              </button>
            )}
            <button
              onClick={onCancel}
              disabled={loading}
              className={`px-4 py-2 text-sm text-white bg-gray-500 dark:bg-gray-400 rounded-lg transition-colors ${
                loading
                  ? "text-gray-400 border-gray-300 cursor-not-allowed"
                  : "text-gray-600 hover:text-gray-800"
              }`}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

export default TicketDialog;
