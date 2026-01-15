// useOpenWhatsApp.js
import { useCallback } from "react";

/**
 * useOpenWhatsApp(phone, message, opts)
 * - phone: E.164 phone number string WITHOUT '+' (e.g. "919812345678") or null to open generic chat
 * - message: prefilled text (optional)
 * - opts: { preferWebOnDesktop: boolean } (default true)
 *
 * Returns openWhatsApp() which must be called in a user gesture.
 */
export default function useOpenWhatsApp(phone = null, message = "", opts = {}) {
  const { preferWebOnDesktop = true } = opts;

  const openWhatsApp = useCallback(() => {
    const encodedText = message ? `&text=${encodeURIComponent(message)}` : "";
    const phonePart = phone ? phone.replace(/^\+/, "") : "";

    // scheme for native app
    const appScheme =
      phonePart.length > 0
        ? `whatsapp://send?phone=${phonePart}${encodedText}`
        : `whatsapp://send?text=${encodeURIComponent(message)}`;

    // short web link works well across mobile
    const waMe = phonePart.length > 0
      ? `https://wa.me/${phonePart}?text=${encodeURIComponent(message)}`
      : `https://wa.me/?text=${encodeURIComponent(message)}`;

    // desktop web.whatsapp.com
    const webWhatsappDesktop = phonePart.length > 0
      ? `https://web.whatsapp.com/send?phone=${phonePart}&text=${encodeURIComponent(message)}`
      : `https://web.whatsapp.com/`;

    const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

    // Try to open native app first (user gesture required). Then fallback to web link.
    // We use location.href as primary attempt (works in many browsers). If it fails (scheme not handled),
    // we fallback to opening the web URL in a new tab/window.
    try {
      if (isMobile) {
        // On mobile prefer app scheme first
        window.location.href = appScheme;
        // Some browsers don't throw but won't open; fallback by opening wa.me in new tab.
        // Use setTimeout only as a short-lived fallback attempt triggered after user gesture.
        setTimeout(() => {
          // In case app didn't open, open wa.me
          window.open(waMe, "_blank", "noopener,noreferrer");
        }, 800);
      } else {
        // desktop: prefer web.whatsapp if requested
        if (preferWebOnDesktop) {
          window.open(webWhatsappDesktop, "_blank", "noopener,noreferrer");
        } else {
          // attempt app scheme then fallback to web
          window.location.href = appScheme;
          setTimeout(() => {
            window.open(webWhatsappDesktop, "_blank", "noopener,noreferrer");
          }, 800);
        }
      }
    } catch (e) {
      // final fallback
      window.open(waMe, "_blank", "noopener,noreferrer");
    }
  }, [phone, message, preferWebOnDesktop]);

  return openWhatsApp;
}
