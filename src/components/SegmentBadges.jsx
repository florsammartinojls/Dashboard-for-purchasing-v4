// src/components/SegmentBadges.jsx
// Sprint 3 Fix 6: extracted from SegmentsTab so consumers (BundleTab,
// PurchTab, TodaysActionTab, WhyBuyPanel) can pull just the badges
// without forcing the full SegmentsTab bundle (incl. virtualization,
// override management, etc.) into the main chunk.

import React from "react";
import { SEGMENT_LABELS, SEGMENT_COLORS, CONFIDENCE_COLORS } from "../lib/segmentClassifier";

export function SegmentBadge({ segment, override, small }) {
  if (!segment) return null;
  const eff = override || segment;
  const cls = SEGMENT_COLORS[eff] || SEGMENT_COLORS.STABLE;
  const label = SEGMENT_LABELS[eff] || eff;
  const tip = override
    ? `Override: ${label}. Auto-detected was ${SEGMENT_LABELS[segment] || segment}.`
    : `Auto: ${label}.`;
  return (
    <span
      className={`inline-flex items-center gap-1 ${small ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-0.5'} rounded font-medium ${cls}`}
      title={tip}
    >
      {label}
      {override && <span className="text-[9px] opacity-80">✎</span>}
    </span>
  );
}

export function ConfidenceBadge({ confidence }) {
  if (!confidence) return null;
  const cls = CONFIDENCE_COLORS[confidence] || CONFIDENCE_COLORS.medium;
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase font-semibold ${cls}`}>
      {confidence}
    </span>
  );
}
