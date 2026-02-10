import { motion } from "framer-motion";

// ── Branded Spinner (used for full-page loaders) ──
export function BrandedLoader({ text = "Loading..." }) {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <div className="relative w-14 h-14 mb-4">
        {/* Outer ring */}
        <div className="absolute inset-0 rounded-full border-[3px] border-gray-100" />
        {/* Spinning gradient arc */}
        <svg className="absolute inset-0 w-full h-full animate-spin" viewBox="0 0 56 56">
          <circle
            cx="28" cy="28" r="25.5"
            fill="none"
            strokeWidth="3"
            strokeLinecap="round"
            stroke="url(#loaderGrad)"
            strokeDasharray="80 80"
          />
          <defs>
            <linearGradient id="loaderGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#3B82F6" />
              <stop offset="100%" stopColor="#8B5CF6" />
            </linearGradient>
          </defs>
        </svg>
        {/* Center logo */}
        <div className="absolute inset-0 flex items-center justify-center">
          <img
            src="/icon-192.png"
            alt=""
            className="w-7 h-7 rounded-md object-contain animate-pulse-ring"
          />
        </div>
      </div>
      <p className="text-sm text-gray-400 font-medium">{text}</p>
    </div>
  );
}

// ── Stream Loading Overlay ──
export function StreamOverlay({ text = "Connecting to stream..." }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex flex-col items-center justify-center">
      <div className="relative w-20 h-20 mb-5">
        {/* Pulsing rings */}
        <div className="absolute inset-0 rounded-full border-2 border-white/10 animate-ping" style={{ animationDuration: "2s" }} />
        <div className="absolute inset-2 rounded-full border-2 border-white/10 animate-ping" style={{ animationDuration: "2s", animationDelay: "0.3s" }} />
        {/* Spinning arc */}
        <svg className="absolute inset-0 w-full h-full animate-spin" style={{ animationDuration: "1.2s" }} viewBox="0 0 80 80">
          <circle
            cx="40" cy="40" r="36"
            fill="none"
            strokeWidth="3"
            strokeLinecap="round"
            stroke="url(#streamGrad)"
            strokeDasharray="60 120"
          />
          <defs>
            <linearGradient id="streamGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#EF4444" />
              <stop offset="100%" stopColor="#F59E0B" />
            </linearGradient>
          </defs>
        </svg>
        {/* Center icon */}
        <div className="absolute inset-0 flex items-center justify-center">
          <img
            src="/icon-192.png"
            alt=""
            className="w-9 h-9 rounded-lg object-contain"
          />
        </div>
      </div>
      <p className="text-sm text-white font-semibold">{text}</p>
      <div className="flex items-center gap-1.5 mt-3">
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            className="w-1.5 h-1.5 rounded-full bg-white/50"
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
          />
        ))}
      </div>
    </div>
  );
}

// ── Button Spinner (inline for buttons) ──
export function ButtonSpinner() {
  return (
    <svg className="animate-spin h-4 w-4 text-white" viewBox="0 0 40 40">
      <circle cx="20" cy="20" r="16" fill="none" strokeWidth="3" stroke="rgba(255,255,255,0.2)" />
      <circle
        cx="20" cy="20" r="16"
        fill="none" strokeWidth="3"
        strokeLinecap="round"
        stroke="white"
        strokeDasharray="30 50"
      />
    </svg>
  );
}

// ── Skeleton Blocks ──
export function SkeletonBox({ className = "" }) {
  return <div className={`skeleton ${className}`} />;
}

// ── Ad Carousel Skeleton ──
export function AdCarouselSkeleton() {
  return (
    <div className="rounded-2xl overflow-hidden mb-5 bg-white shadow-lg shadow-black/5">
      <div className="aspect-[16/7] skeleton" />
    </div>
  );
}

// ── Channel Grid Skeleton ──
export function ChannelGridSkeleton({ count = 6 }) {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="aspect-video skeleton" />
          <div className="px-3 py-2.5 space-y-2">
            <div className="skeleton h-3 w-3/4" />
            <div className="skeleton h-2.5 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Channel List Skeleton ──
export function ChannelListSkeleton({ count = 6 }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 bg-white rounded-xl px-3 py-2.5 border border-gray-100 shadow-sm"
        >
          <div className="skeleton w-7 h-4 rounded" />
          <div className="skeleton w-11 h-11 rounded-xl flex-shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="skeleton h-3.5 w-3/4" />
            <div className="skeleton h-2.5 w-1/3" />
          </div>
          <div className="skeleton w-9 h-9 rounded-full flex-shrink-0" />
        </div>
      ))}
    </div>
  );
}

// ── Language Grid Skeleton ──
export function LanguageListSkeleton({ count = 8 }) {
  return (
    <div className="grid grid-cols-4 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex flex-col items-center">
          <div className="skeleton w-16 h-16 rounded-2xl mb-2" />
          <div className="skeleton h-2.5 w-10 rounded" />
        </div>
      ))}
    </div>
  );
}

// ── App Info Skeleton ──
export function AppInfoSkeleton() {
  return (
    <div className="space-y-5">
      {/* Brand card */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 flex flex-col items-center">
        <div className="skeleton w-16 h-16 rounded-2xl mb-4" />
        <div className="skeleton h-5 w-28 mb-2" />
        <div className="skeleton h-3 w-36 mb-3" />
        <div className="skeleton h-8 w-24 rounded-full" />
      </div>
      {/* Links */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden divide-y divide-gray-100">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-4">
            <div className="skeleton w-10 h-10 rounded-xl flex-shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="skeleton h-3.5 w-1/3" />
              <div className="skeleton h-2.5 w-2/3" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Featured Cards Skeleton ──
export function FeaturedSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-2.5">
      {[1, 2].map((i) => (
        <div key={i} className="rounded-2xl overflow-hidden aspect-video skeleton" />
      ))}
    </div>
  );
}
