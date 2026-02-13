import { useState, useRef, useCallback, useEffect } from "react";

const VOICE_LANGS = [
  { code: "en-IN", label: "EN" },
  { code: "hi-IN", label: "HI" },
  { code: "te-IN", label: "TE" },
  { code: "ta-IN", label: "TA" },
  { code: "kn-IN", label: "KN" },
];

const hasSpeechSupport =
  typeof window !== "undefined" &&
  ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

/**
 * Reusable voice search hook.
 * @param {function} onResult - called with the transcript string when speech is recognized
 * @param {object} [options]
 * @param {boolean} [options.parseNumbers=false] - parse spoken numbers (Hindi/English) into digits
 * @returns {{ listening, voiceLang, voiceLangs, voiceError, micBlocked, hasSpeechSupport, startVoiceSearch, stopVoice, cycleVoiceLang }}
 */
export default function useVoiceSearch(onResult, { parseNumbers = false } = {}) {
  const [listening, setListening] = useState(false);
  const [voiceLang, setVoiceLang] = useState("en-IN");
  const [voiceError, setVoiceError] = useState("");
  const [micBlocked, setMicBlocked] = useState(false);
  const recognitionRef = useRef(null);
  const timeoutRef = useRef(null);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  // Check mic permission on mount
  useEffect(() => {
    if (!hasSpeechSupport) return;
    navigator.permissions
      ?.query({ name: "microphone" })
      .then((status) => {
        setMicBlocked(status.state === "denied");
        status.onchange = () => setMicBlocked(status.state === "denied");
      })
      .catch(() => {});
  }, []);

  const parseSpokenNumber = useCallback((text) => {
    if (!parseNumbers) return text;

    let t = text.toLowerCase().trim();
    t = t.replace(
      /\b(channel|number|no\.?|play|open|search|find|go to|switch to|tune to|dikhao|chalao|lagao|batao|sunao)\b/gi,
      ""
    ).trim();

    // Hindi number words
    const hindiMap = {
      sunya: 0, ek: 1, do: 2, teen: 3, char: 4, paanch: 5, panch: 5, chhe: 6, che: 6, cheh: 6,
      saat: 7, sat: 7, aath: 8, aat: 8, nau: 9, das: 10, gyarah: 11, barah: 12, terah: 13,
      chaudah: 14, pandrah: 15, solah: 16, satrah: 17, atharah: 18, unnis: 19, bees: 20,
      ikkees: 21, bais: 22, teis: 23, chaubis: 24, pachchis: 25, chhabbis: 26, sattais: 27,
      attais: 28, untees: 29, tees: 30, ikatees: 31, battis: 32, tentis: 33, chautis: 34,
      paintis: 35, chhattis: 36, saintis: 37, adhtis: 38, untalis: 39, chalis: 40,
      iktalis: 41, bayalis: 42, tentalis: 43, chavalis: 44, paintalis: 45, chhiyalis: 46,
      saintalis: 47, adhtalis: 48, unchas: 49, pachas: 50, ikyavan: 51, bavan: 52,
      tirpan: 53, chauvan: 54, pachpan: 55, chhappan: 56, sattavan: 57, atthavan: 58,
      unsath: 59, saath: 60, iksath: 61, basath: 62, tirsath: 63, chausath: 64, painsath: 65,
      chhiyasath: 66, sarsath: 67, adsath: 68, unahattar: 69, sattar: 70, ikattar: 71,
      bahattar: 72, tihattar: 73, chauhattar: 74, pachattar: 75, chhihattar: 76,
      satattar: 77, athattar: 78, unasi: 79, assi: 80, ikyasi: 81, bayasi: 82,
      tirasi: 83, chaurasi: 84, pachasi: 85, chhiyasi: 86, sattasi: 87, aththasi: 88,
      navasi: 89, nabbe: 90, ikyaanbe: 91, bayaanbe: 92, tiraanbe: 93, chauraanbe: 94,
      pachaanbe: 95, chhiyaanbe: 96, sattaanbe: 97, athaanbe: 98, ninyaanbe: 99,
      sau: 100, hazaar: 1000, hazar: 1000,
      pachaas: 50, pachass: 50, aathh: 8, paach: 5,
    };

    const hindiClean = t.replace(/[^a-z\s]/g, "").trim();
    if (hindiMap[hindiClean] !== undefined) return String(hindiMap[hindiClean]);

    const hindiCompound = hindiClean.split(/\s+/);
    if (hindiCompound.length >= 2 && hindiCompound.length <= 4) {
      const allHindi = hindiCompound.every((w) => hindiMap[w] !== undefined);
      if (allHindi) {
        const nums = hindiCompound.map((w) => hindiMap[w]);
        let result = 0, i = 0;
        while (i < nums.length) {
          if (i + 1 < nums.length && nums[i + 1] === 1000) { result += nums[i] * 1000; i += 2; }
          else if (i + 1 < nums.length && nums[i + 1] === 100) { result += nums[i] * 100; i += 2; }
          else { result += nums[i]; i++; }
        }
        if (result > 0) return String(result);
      }
    }

    // English number words
    const engUnits = {
      zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
      ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
      seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
      sixty: 60, seventy: 70, eighty: 80, ninety: 90,
    };
    const engMult = { hundred: 100, thousand: 1000 };

    const engWords = t.replace(/\band\b/g, "").replace(/[^a-z\s]/g, "").trim().split(/\s+/).filter(Boolean);
    if (engWords.length >= 1 && engWords.length <= 6) {
      const allEng = engWords.every((w) => engUnits[w] !== undefined || engMult[w] !== undefined);
      if (allEng) {
        let result = 0, current = 0;
        for (const w of engWords) {
          if (engUnits[w] !== undefined) { current += engUnits[w]; }
          else if (w === "hundred") { current = (current === 0 ? 1 : current) * 100; }
          else if (w === "thousand") { current = (current === 0 ? 1 : current) * 1000; result += current; current = 0; }
        }
        result += current;
        if (result > 0) return String(result);
      }
    }

    if (engWords.length === 2) {
      const a = engUnits[engWords[0]], b = engUnits[engWords[1]];
      if (a !== undefined && b !== undefined && a >= 1 && a <= 9 && b >= 10 && b <= 90 && b % 10 === 0) {
        return String(a * 100 + b);
      }
    }

    const digits = t.replace(/[^\d]/g, "");
    if (digits.length > 0) return digits;

    return t;
  }, [parseNumbers]);

  const stopVoice = useCallback(() => {
    recognitionRef.current?.stop();
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
    setListening(false);
  }, []);

  const startVoiceSearch = useCallback(async () => {
    if (listening) { stopVoice(); return; }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setVoiceError("Voice search not supported on this device");
      setTimeout(() => setVoiceError(""), 3000);
      return;
    }

    if (navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
      } catch (err) {
        setMicBlocked(true);
        setVoiceError(err.name === "NotAllowedError" ? "Microphone blocked — enable it in site settings" : "Microphone not available");
        setTimeout(() => setVoiceError(""), 4000);
        return;
      }
    }

    setVoiceError("");
    const recognition = new SpeechRecognition();
    recognition.lang = voiceLang;
    recognition.interimResults = true;
    recognition.maxAlternatives = 3;
    recognition.continuous = false;
    recognitionRef.current = recognition;

    timeoutRef.current = setTimeout(() => { recognition.stop(); }, 8000);

    recognition.onstart = () => { setListening(true); setMicBlocked(false); };

    recognition.onresult = (event) => {
      let best = "";
      for (const result of event.results) { best = result[0].transcript; }
      const parsed = parseSpokenNumber(best.trim());
      onResultRef.current(parsed);
    };

    recognition.onerror = (event) => {
      if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
      setListening(false);
      const errMap = {
        "not-allowed": "Microphone blocked — enable it in site settings",
        "audio-capture": "No microphone found on this device",
        "network": "Network error — voice search needs internet",
        "no-speech": "No speech detected — try again",
        "aborted": "",
      };
      const msg = errMap[event.error] || "";
      if (event.error === "not-allowed") setMicBlocked(true);
      if (msg) { setVoiceError(msg); setTimeout(() => setVoiceError(""), 4000); }
    };

    recognition.onend = () => {
      if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
      setListening(false);
    };

    try {
      recognition.start();
    } catch {
      setListening(false);
      setVoiceError("Could not start voice search");
      setTimeout(() => setVoiceError(""), 3000);
    }
  }, [listening, voiceLang, parseSpokenNumber, stopVoice]);

  const cycleVoiceLang = useCallback(() => {
    setVoiceLang((prev) => {
      const idx = VOICE_LANGS.findIndex((l) => l.code === prev);
      return VOICE_LANGS[(idx + 1) % VOICE_LANGS.length].code;
    });
  }, []);

  return {
    listening,
    voiceLang,
    voiceLangs: VOICE_LANGS,
    voiceError,
    micBlocked,
    hasSpeechSupport,
    startVoiceSearch,
    stopVoice,
    cycleVoiceLang,
  };
}
