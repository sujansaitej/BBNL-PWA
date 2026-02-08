import { useRef, useEffect } from "react";
import { motion } from "framer-motion";

export default function OtpInput({ length = 6, value, onChange }) {
  const inputsRef = useRef([]);

  useEffect(() => {
    inputsRef.current[0]?.focus();
  }, []);

  const digits = value.split("").concat(Array(length).fill("")).slice(0, length);

  const focusInput = (index) => {
    inputsRef.current[index]?.focus();
  };

  const handleChange = (e, index) => {
    const val = e.target.value;
    if (val && !/^\d$/.test(val)) return;

    const newDigits = [...digits];
    newDigits[index] = val;
    onChange(newDigits.join(""));

    if (val && index < length - 1) {
      focusInput(index + 1);
    }
  };

  const handleKeyDown = (e, index) => {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      focusInput(index - 1);
    }
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);
    if (pasted) {
      onChange(pasted);
      focusInput(Math.min(pasted.length, length - 1));
    }
  };

  return (
    <div className="flex justify-center gap-3">
      {digits.map((digit, i) => (
        <motion.input
          key={i}
          ref={(el) => (inputsRef.current[i] = el)}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={digit}
          onChange={(e) => handleChange(e, i)}
          onKeyDown={(e) => handleKeyDown(e, i)}
          onPaste={handlePaste}
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: i * 0.05, duration: 0.2 }}
          className="w-11 h-13 text-center text-xl font-bold text-gray-800 border-2 border-gray-300 rounded-lg outline-none transition-colors focus:border-purple-500 focus:ring-2 focus:ring-purple-200"
        />
      ))}
    </div>
  );
}
