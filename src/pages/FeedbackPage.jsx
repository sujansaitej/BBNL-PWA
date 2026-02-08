import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, Star, Send, CheckCircle } from "lucide-react";
import AppLayout from "../components/AppLayout";
import { ButtonSpinner } from "../components/Loader";
import { submitFeedback } from "../services/api";

export default function FeedbackPage() {
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem("user") || "{}");

  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const ratingLabels = ["", "Poor", "Fair", "Good", "Very Good", "Excellent"];

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (rating === 0) {
      setError("Please select a rating");
      return;
    }
    if (!feedback.trim()) {
      setError("Please enter your feedback");
      return;
    }

    setLoading(true);
    setError("");

    console.group(
      "%c🔵 [Feedback] Submit Feedback",
      "color: #3b82f6; font-weight: bold; font-size: 13px;"
    );
    console.log("%c📱 mobile:", "color: #6366f1; font-weight: bold;", user.mobile);
    console.log("%c⭐ rate_count:", "color: #6366f1; font-weight: bold;", rating);
    console.log("%c💬 feedback:", "color: #6366f1; font-weight: bold;", feedback.trim());

    try {
      const data = await submitFeedback({
        mobile: user.mobile,
        rate_count: rating,
        feedback: feedback.trim(),
      });
      console.log(
        "%c🟢 SUCCESS",
        "color: #22c55e; font-weight: bold; font-size: 13px;",
        data?.status?.err_msg
      );
      console.groupEnd();
      setSuccess(true);
      setTimeout(() => navigate(-1), 2000);
    } catch (err) {
      console.log(
        "%c🔴 ERROR",
        "color: #ef4444; font-weight: bold; font-size: 13px;",
        err.message
      );
      console.groupEnd();
      setError(err.message || "Failed to submit feedback.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppLayout>
      <div className="px-4 py-5 max-w-lg mx-auto">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3 mb-6"
        >
          <button
            onClick={() => navigate(-1)}
            className="w-11 h-11 rounded-xl bg-gray-100 flex items-center justify-center hover:bg-gray-200 active:bg-gray-300 transition-colors flex-shrink-0"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <div>
            <h2 className="text-lg font-bold text-gray-800">Feedback</h2>
            <p className="text-xs text-gray-400">We value your opinion</p>
          </div>
        </motion.div>

        {/* Success State */}
        {success && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center justify-center py-16"
          >
            <div className="w-20 h-20 rounded-full bg-green-50 flex items-center justify-center mb-4">
              <CheckCircle className="w-10 h-10 text-green-500" />
            </div>
            <h3 className="text-lg font-bold text-gray-800 mb-1">Thank You!</h3>
            <p className="text-sm text-gray-500 text-center">
              Your feedback has been submitted successfully.
            </p>
          </motion.div>
        )}

        {/* Feedback Form */}
        {!success && (
          <motion.form
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            onSubmit={handleSubmit}
            className="space-y-5"
          >
            {/* Rating Card */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-1">
                How was your experience?
              </h3>
              <p className="text-xs text-gray-400 mb-4">Tap a star to rate</p>

              <div className="flex items-center justify-center gap-2 mb-3">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    onClick={() => { setRating(star); setError(""); }}
                    onMouseEnter={() => setHoverRating(star)}
                    onMouseLeave={() => setHoverRating(0)}
                    className="p-1 transition-transform active:scale-90"
                  >
                    <Star
                      className={`w-9 h-9 transition-colors ${
                        star <= (hoverRating || rating)
                          ? "text-yellow-400 fill-yellow-400"
                          : "text-gray-200"
                      }`}
                    />
                  </button>
                ))}
              </div>

              {rating > 0 && (
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-center text-sm font-medium text-gray-600"
                >
                  {ratingLabels[rating]}
                </motion.p>
              )}
            </div>

            {/* Feedback Text */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Tell us more</h3>
              <textarea
                value={feedback}
                onChange={(e) => { setFeedback(e.target.value); setError(""); }}
                placeholder="Share your thoughts, suggestions, or report an issue..."
                rows={4}
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-700 placeholder-gray-400 resize-none focus:outline-none focus:border-purple-400 focus:ring-1 focus:ring-purple-200 transition-all"
              />
            </div>

            {/* Error */}
            {error && (
              <motion.p
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-sm text-red-500 text-center font-medium"
              >
                {error}
              </motion.p>
            )}

            {/* Submit */}
            <motion.button
              type="submit"
              disabled={loading}
              whileTap={{ scale: 0.98 }}
              className={`w-full flex items-center justify-center gap-2 py-3.5 rounded-xl text-white font-semibold text-sm shadow-lg transition-all min-h-[48px] ${
                loading
                  ? "bg-gray-400 cursor-not-allowed"
                  : "bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700"
              }`}
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <ButtonSpinner />
                  Submitting...
                </span>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  Submit Feedback
                </>
              )}
            </motion.button>
          </motion.form>
        )}
      </div>
    </AppLayout>
  );
}
