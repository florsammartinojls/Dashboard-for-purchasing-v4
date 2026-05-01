// src/components/Skeleton.jsx
// Lightweight skeletons for the main tabs while history/data loads.
import React from "react";

const PULSE = "animate-pulse bg-gray-800";

function Bar({ w = "w-full", h = "h-3", className = "" }) {
  return <div className={`rounded ${PULSE} ${w} ${h} ${className}`} />;
}

export function SkeletonTable({ rows = 8, cols = 6 }) {
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-12 gap-2 px-3 py-2">
        {Array.from({ length: cols }).map((_, i) => (
          <Bar key={i} w="col-span-2" h="h-3" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="grid grid-cols-12 gap-2 bg-gray-900/40 rounded px-3 py-2.5">
          {Array.from({ length: cols }).map((_, c) => (
            <Bar key={c} w="col-span-2" h="h-2.5" className="opacity-60" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonHero() {
  return (
    <div className="p-4">
      <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-5 mb-4">
        <Bar w="w-1/2" h="h-5" className="mb-3" />
        <Bar w="w-3/4" h="h-3" className="mb-2 opacity-70" />
        <Bar w="w-1/3" h="h-3" className="opacity-60" />
      </div>
      <div className="grid grid-cols-3 gap-3 mb-4">
        {[0, 1, 2].map(i => (
          <div key={i} className="bg-gray-900/60 border border-gray-800 rounded-xl p-4">
            <Bar w="w-1/2" h="h-3" className="mb-2 opacity-60" />
            <Bar w="w-1/3" h="h-5" />
          </div>
        ))}
      </div>
      <SkeletonTable rows={6} cols={5} />
    </div>
  );
}

export function HistoryProgressBanner({ pct, message }) {
  return (
    <div className="max-w-7xl mx-auto mt-2 px-3 py-1.5 bg-blue-500/10 border border-blue-500/30 rounded text-xs text-blue-300 flex items-center gap-2">
      <span>⏳</span>
      <span className="flex-1">{message || 'Loading history…'}</span>
      {pct != null && (
        <span className="font-mono text-[11px]">{Math.round(pct)}%</span>
      )}
    </div>
  );
}

export default { SkeletonTable, SkeletonHero, HistoryProgressBanner };
