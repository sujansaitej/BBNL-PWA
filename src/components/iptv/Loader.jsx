import { motion } from "framer-motion";

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
