// src/components/SegmentsTab.jsx
// ============================================================
// Segments Tab — full-catalog override management
// ============================================================
// Default sort puts review priority FIRST: low-confidence + the
// "critical" segments (SEASONAL_PEAKED, GROWING, DECLINING,
// DORMANT_REVIVED). STABLE/high-confidence is hidden behind the
// "Show stable" toggle so the user lands on the ~200 that matter.
//
// Virtualization is hand-rolled (~50 LOC) — no extra deps.
// ============================================================

import React, { useContext, useMemo, useRef, useState, useEffect } from "react";
import { SegmentCtx } from "../App";
import {
  SEGMENTS,
  SEGMENT_LABELS,
  SEGMENT_COLORS,
  SEGMENT_PRIORITY,
  CONFIDENCE_COLORS,
} from "../lib/segmentClassifier";
import {
  exportOverrides,
  importOverrides,
  clearAllOverrides,
  bulkSetOverrides,
} from "../lib/segments";

const ROW_HEIGHT = 44;
const VISIBLE_BUFFER = 8;
const CRITICAL_SEGMENTS = new Set(['SEASONAL_PEAKED', 'GROWING', 'DECLINING', 'DORMANT_REVIVED']);

function fmt1(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  return Number(n).toFixed(1);
}
function fmt2(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  return Number(n).toFixed(2);
}
function fmt0(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  return Math.round(n).toLocaleString('en-US');
}

function Sparkline({ values, color = '#3b82f6' }) {
  if (!values || values.length < 2) return <span className="text-gray-700 text-[10px]">—</span>;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const W = 80, H = 18;
  const step = W / Math.max(1, values.length - 1);
  const pts = values.map((v, i) => {
    const x = i * step;
    const y = H - ((v - min) / range) * H;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg width={W} height={H} className="inline-block flex-shrink-0">
      <polyline fill="none" stroke={color} strokeWidth="1" points={pts} />
    </svg>
  );
}

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

export default function SegmentsTab({ data, vendorRecs, goBundle, openWhyBuy }) {
  const { autoMap, overrides, effectiveMap, setOverride, refreshOverrides } = useContext(SegmentCtx);

  const [search, setSearch] = useState('');
  const [filterSegment, setFilterSegment] = useState('');
  const [filterConfidence, setFilterConfidence] = useState('');
  const [filterVendor, setFilterVendor] = useState('');
  const [showStable, setShowStable] = useState(false);
  const [showStableHigh, setShowStableHigh] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [sortMode, setSortMode] = useState('review');

  const bundleMeta = useMemo(() => {
    const out = {};
    for (const b of (data.bundles || [])) {
      if (!b || !b.j) continue;
      out[b.j] = {
        title: b.ti || '',
        vendor: (b.vendors || '').split(',')[0]?.trim() || '',
        active: b.active,
      };
    }
    return out;
  }, [data.bundles]);

  const abcMap = useMemo(() => {
    const m = {};
    for (const a of (data.abcA || [])) {
      if (a?.j) m[a.j] = a.profABC || null;
    }
    return m;
  }, [data.abcA]);

  // Pre-compute "last 30d daily" arrays per bundle for sparklines.
  const sparklineMap = useMemo(() => {
    const out = {};
    const days = data.bundleDaysForecast || data.bundleDays || [];
    const byBundle = new Map();
    for (const d of days) {
      if (!d || !d.j) continue;
      let arr = byBundle.get(d.j);
      if (!arr) { arr = []; byBundle.set(d.j, arr); }
      arr.push(d);
    }
    for (const [j, arr] of byBundle.entries()) {
      arr.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      out[j] = arr.slice(-30).map(p => Number(p.dsr) || 0);
    }
    return out;
  }, [data.bundleDaysForecast, data.bundleDays]);

  const dsrMap = useMemo(() => {
    const m = {};
    for (const b of (data.bundles || [])) {
      if (b?.j) m[b.j] = Number(b.cd) || 0;
    }
    return m;
  }, [data.bundles]);

  const lastSaleMap = useMemo(() => {
    const m = {};
    for (const [j, vals] of Object.entries(sparklineMap)) {
      // Find last index with non-zero
      const days = data.bundleDaysForecast || data.bundleDays || [];
      const rows = days.filter(d => d?.j === j).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      const lastWithSale = rows.find(r => Number(r.dsr) > 0);
      m[j] = lastWithSale?.date || null;
    }
    return m;
  }, [sparklineMap, data.bundleDaysForecast, data.bundleDays]);

  // Build complete row set
  const allRows = useMemo(() => {
    const out = [];
    for (const [bid, rec] of Object.entries(effectiveMap)) {
      const meta = bundleMeta[bid] || {};
      out.push({
        bundleId: bid,
        title: meta.title,
        vendor: meta.vendor,
        active: meta.active,
        autoSegment: rec.segment,
        override: rec.override,
        effective: rec.effective,
        confidence: rec.confidence,
        reason: rec.reason,
        features: rec.features,
        abc: abcMap[bid] || null,
        dsr: dsrMap[bid] || 0,
        sparkline: sparklineMap[bid] || [],
        lastSale: lastSaleMap[bid] || null,
      });
    }
    return out;
  }, [effectiveMap, bundleMeta, abcMap, dsrMap, sparklineMap, lastSaleMap]);

  const counts = useMemo(() => {
    const c = {};
    for (const r of allRows) {
      c[r.effective] = (c[r.effective] || 0) + 1;
    }
    return c;
  }, [allRows]);

  // Vendor list
  const vendorOptions = useMemo(() => {
    const set = new Set();
    for (const r of allRows) {
      if (r.vendor) set.add(r.vendor);
    }
    return [...set].sort();
  }, [allRows]);

  // Filter + sort
  const filteredRows = useMemo(() => {
    let rows = allRows.slice();
    if (filterSegment) rows = rows.filter(r => r.effective === filterSegment);
    if (filterConfidence) rows = rows.filter(r => r.confidence === filterConfidence);
    if (filterVendor) rows = rows.filter(r => r.vendor === filterVendor);
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(r =>
        (r.bundleId || '').toLowerCase().includes(q) ||
        (r.title || '').toLowerCase().includes(q) ||
        (r.vendor || '').toLowerCase().includes(q)
      );
    }
    if (!showStable) {
      rows = rows.filter(r => r.effective !== 'STABLE');
    }
    if (!showStableHigh && showStable) {
      // Even with showStable on, allow hiding STABLE/high-confidence noise
      rows = rows.filter(r => !(r.effective === 'STABLE' && r.confidence === 'high'));
    }

    // Sort
    if (sortMode === 'review') {
      rows.sort((a, b) => {
        const lowFirst = (x) => x.confidence === 'low' ? 0 : x.confidence === 'medium' ? 1 : 2;
        const segP = (x) => SEGMENT_PRIORITY[x.effective] ?? 99;
        const da = lowFirst(a) - lowFirst(b);
        if (da !== 0) return da;
        const dp = segP(a) - segP(b);
        if (dp !== 0) return dp;
        return (a.bundleId || '').localeCompare(b.bundleId || '');
      });
    } else if (sortMode === 'segment') {
      rows.sort((a, b) => (SEGMENT_PRIORITY[a.effective] ?? 99) - (SEGMENT_PRIORITY[b.effective] ?? 99) || (a.bundleId || '').localeCompare(b.bundleId || ''));
    } else if (sortMode === 'dsr') {
      rows.sort((a, b) => b.dsr - a.dsr);
    } else if (sortMode === 'id') {
      rows.sort((a, b) => (a.bundleId || '').localeCompare(b.bundleId || ''));
    }
    return rows;
  }, [allRows, filterSegment, filterConfidence, filterVendor, search, showStable, showStableHigh, sortMode]);

  // Virtualization
  const scrollerRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(560);
  useEffect(() => {
    if (scrollerRef.current) setViewportH(scrollerRef.current.clientHeight);
  }, []);
  const onScroll = (e) => setScrollTop(e.target.scrollTop);
  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - VISIBLE_BUFFER);
  const visibleCount = Math.ceil(viewportH / ROW_HEIGHT) + VISIBLE_BUFFER * 2;
  const endIdx = Math.min(filteredRows.length, startIdx + visibleCount);
  const padTop = startIdx * ROW_HEIGHT;
  const padBottom = (filteredRows.length - endIdx) * ROW_HEIGHT;

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleSelectVisible = () => {
    const visibleIds = filteredRows.slice(startIdx, endIdx).map(r => r.bundleId);
    setSelectedIds(prev => {
      const allIn = visibleIds.every(id => prev.has(id));
      const next = new Set(prev);
      if (allIn) visibleIds.forEach(id => next.delete(id));
      else visibleIds.forEach(id => next.add(id));
      return next;
    });
  };
  const clearSelection = () => setSelectedIds(new Set());

  const bulkSetSelected = (segment) => {
    if (selectedIds.size === 0) return;
    const updates = {};
    for (const id of selectedIds) updates[id] = segment;
    bulkSetOverrides(updates);
    refreshOverrides();
    clearSelection();
  };
  const bulkResetSelected = () => {
    if (selectedIds.size === 0) return;
    const updates = {};
    for (const id of selectedIds) updates[id] = null;
    bulkSetOverrides(updates);
    refreshOverrides();
    clearSelection();
  };

  // Export / Import handlers
  const handleExport = () => {
    const json = exportOverrides();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const stamp = new Date().toISOString().slice(0, 10);
    a.download = `segment_overrides_${stamp}.json`;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  const handleExportSeed = () => {
    // Format suitable for src/data/segment_overrides_seed.json
    const json = exportOverrides();
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(json);
      alert('Seed JSON copied to clipboard. Paste it into src/data/segment_overrides_seed.json to make this the new default for fresh installs.');
    } else {
      handleExport();
    }
  };
  const handleImport = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const txt = String(reader.result || '');
      const res = importOverrides(txt);
      if (res.ok) {
        refreshOverrides();
        alert(`Imported ${res.count} overrides.`);
      } else {
        alert(`Import failed: ${res.error}`);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };
  const handleResetAll = () => {
    if (!confirm('Reset ALL segment overrides? This will leave every bundle on its auto classification.')) return;
    clearAllOverrides();
    refreshOverrides();
    clearSelection();
  };

  return (
    <div className="p-4">
      <div className="mb-4">
        <h2 className="text-xl font-bold text-white mb-1">Segments</h2>
        <p className="text-xs text-gray-500">
          Auto-classified per bundle (read-only in the engine until v4 recommender ships).
          Review-priority sort puts low-confidence + critical segments at the top.
        </p>
      </div>

      {/* Top counts strip */}
      <div className="flex flex-wrap gap-2 mb-3">
        {SEGMENTS.map(seg => {
          const n = counts[seg] || 0;
          const cls = SEGMENT_COLORS[seg];
          const active = filterSegment === seg;
          return (
            <button
              key={seg}
              onClick={() => setFilterSegment(active ? '' : seg)}
              className={`text-xs px-2 py-1 rounded ${cls} ${active ? 'ring-2 ring-offset-1 ring-offset-gray-950 ring-blue-400' : 'opacity-90 hover:opacity-100'}`}
            >
              {SEGMENT_LABELS[seg]} <span className="opacity-70 ml-1">{n}</span>
            </button>
          );
        })}
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-2 mb-2 items-center">
        <input
          type="text"
          placeholder="Search bundle ID, name, vendor…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="bg-gray-800 border border-gray-700 text-white rounded px-3 py-1.5 text-sm w-72"
        />
        <select
          value={filterConfidence}
          onChange={e => setFilterConfidence(e.target.value)}
          className="bg-gray-800 border border-gray-700 text-gray-200 text-xs rounded px-2 py-1.5"
        >
          <option value="">All confidence</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
        <select
          value={filterVendor}
          onChange={e => setFilterVendor(e.target.value)}
          className="bg-gray-800 border border-gray-700 text-gray-200 text-xs rounded px-2 py-1.5"
        >
          <option value="">All vendors</option>
          {vendorOptions.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
        <select
          value={sortMode}
          onChange={e => setSortMode(e.target.value)}
          className="bg-gray-800 border border-gray-700 text-gray-200 text-xs rounded px-2 py-1.5"
          title="Default 'Review priority' surfaces low-confidence + critical segments first."
        >
          <option value="review">Sort: Review priority</option>
          <option value="segment">Sort: Segment</option>
          <option value="dsr">Sort: DSR ↓</option>
          <option value="id">Sort: Bundle ID</option>
        </select>
        <label className="text-xs text-gray-300 flex items-center gap-1.5 ml-2">
          <input type="checkbox" checked={showStable} onChange={e => setShowStable(e.target.checked)} className="accent-blue-500" />
          Show stable
        </label>
        {showStable && (
          <label className="text-xs text-gray-400 flex items-center gap-1.5">
            <input type="checkbox" checked={showStableHigh} onChange={e => setShowStableHigh(e.target.checked)} className="accent-blue-500" />
            …including high-confidence
          </label>
        )}
        <span className="text-xs text-gray-500 ml-auto">
          {filteredRows.length.toLocaleString()} of {allRows.length.toLocaleString()}
        </span>
      </div>

      {/* Action bar */}
      <div className="flex flex-wrap gap-2 mb-3 items-center text-xs">
        <button onClick={handleExport} className="bg-gray-800 border border-gray-700 text-gray-200 rounded px-2 py-1 hover:bg-gray-700">Export overrides JSON</button>
        <button onClick={handleExportSeed} className="bg-gray-800 border border-gray-700 text-gray-200 rounded px-2 py-1 hover:bg-gray-700" title="Copies overrides JSON to clipboard so you can paste into src/data/segment_overrides_seed.json">Export to seed file</button>
        <label className="bg-gray-800 border border-gray-700 text-gray-200 rounded px-2 py-1 hover:bg-gray-700 cursor-pointer">
          Import overrides
          <input type="file" accept="application/json" onChange={handleImport} className="hidden" />
        </label>
        <button onClick={handleResetAll} className="bg-red-500/15 border border-red-500/40 text-red-300 rounded px-2 py-1 hover:bg-red-500/25">Reset all to auto</button>
        {selectedIds.size > 0 && (
          <>
            <span className="text-gray-400 ml-2 mr-1">Selected: <span className="text-white font-semibold">{selectedIds.size}</span></span>
            <select
              onChange={e => { if (e.target.value) bulkSetSelected(e.target.value); e.target.value = ''; }}
              className="bg-gray-800 border border-gray-700 text-gray-200 rounded px-2 py-1"
              defaultValue=""
            >
              <option value="">Set selected to…</option>
              {SEGMENTS.map(seg => <option key={seg} value={seg}>{SEGMENT_LABELS[seg]}</option>)}
            </select>
            <button onClick={bulkResetSelected} className="bg-gray-800 border border-gray-700 text-gray-300 rounded px-2 py-1">Reset selected</button>
            <button onClick={clearSelection} className="text-gray-500 hover:text-white">✕ clear</button>
          </>
        )}
      </div>

      {/* Header */}
      <div className="grid grid-cols-[28px_minmax(120px,1.2fr)_minmax(180px,2fr)_minmax(140px,1fr)_minmax(170px,1fr)_minmax(150px,1fr)_70px_55px_60px_90px_64px] gap-2 px-2 py-2 text-[10px] uppercase text-gray-500 border-b border-gray-800 sticky top-[100px] bg-gray-950 z-10">
        <span><input type="checkbox" onChange={toggleSelectVisible} className="accent-blue-500" /></span>
        <span>Bundle</span>
        <span>Name</span>
        <span>Vendor</span>
        <span>Auto → Effective</span>
        <span>Override</span>
        <span className="text-right">DSR</span>
        <span>ABC</span>
        <span>Conf</span>
        <span>30d</span>
        <span className="text-right">Actions</span>
      </div>

      {/* Virtualized scroll container */}
      <div
        ref={scrollerRef}
        onScroll={onScroll}
        className="overflow-y-auto border border-gray-800 rounded bg-gray-950"
        style={{ height: '70vh' }}
      >
        <div style={{ height: padTop }} />
        {filteredRows.slice(startIdx, endIdx).map(r => {
          const isSel = selectedIds.has(r.bundleId);
          return (
            <div
              key={r.bundleId}
              className={`grid grid-cols-[28px_minmax(120px,1.2fr)_minmax(180px,2fr)_minmax(140px,1fr)_minmax(170px,1fr)_minmax(150px,1fr)_70px_55px_60px_90px_64px] gap-2 px-2 items-center text-xs border-b border-gray-900 ${isSel ? 'bg-blue-500/10' : 'hover:bg-gray-900/50'}`}
              style={{ height: ROW_HEIGHT }}
            >
              <input
                type="checkbox"
                checked={isSel}
                onChange={() => toggleSelect(r.bundleId)}
                className="accent-blue-500"
              />
              <button
                onClick={() => goBundle && goBundle(r.bundleId)}
                className="text-blue-400 hover:text-blue-300 font-mono text-left truncate"
                title={r.bundleId}
              >
                {r.bundleId}
              </button>
              <span className="text-gray-300 truncate" title={r.title}>{r.title}</span>
              <span className="text-gray-400 truncate" title={r.vendor}>{r.vendor}</span>
              <span className="flex items-center gap-1.5 truncate" title={r.reason}>
                <SegmentBadge segment={r.autoSegment} override={r.override !== r.autoSegment ? r.override : null} small />
              </span>
              <select
                value={r.override || ''}
                onChange={e => setOverride(r.bundleId, e.target.value || null)}
                className="bg-gray-800 border border-gray-700 text-gray-200 rounded px-1.5 py-0.5 text-[11px]"
              >
                <option value="">(auto)</option>
                {SEGMENTS.map(seg => <option key={seg} value={seg}>{SEGMENT_LABELS[seg]}</option>)}
              </select>
              <span className="text-right text-gray-300 font-mono">{fmt1(r.dsr)}</span>
              <span className="text-gray-400">{r.abc || '—'}</span>
              <ConfidenceBadge confidence={r.confidence} />
              <Sparkline values={r.sparkline} color={CRITICAL_SEGMENTS.has(r.effective) ? '#a78bfa' : '#3b82f6'} />
              <span className="text-right flex items-center justify-end gap-1">
                {openWhyBuy && (
                  <button
                    onClick={() => openWhyBuy({ bundleId: r.bundleId })}
                    className="text-xs bg-emerald-500/20 text-emerald-300 px-1.5 py-0.5 rounded hover:bg-emerald-500/30"
                    title="Why Buy?"
                  >
                    📊
                  </button>
                )}
                <button
                  onClick={() => goBundle && goBundle(r.bundleId)}
                  className="text-xs text-gray-400 hover:text-white"
                  title="Open bundle detail"
                >
                  ↗
                </button>
              </span>
            </div>
          );
        })}
        <div style={{ height: padBottom }} />
        {filteredRows.length === 0 && (
          <div className="text-center text-gray-500 text-sm py-12">
            No bundles match the current filters.
          </div>
        )}
      </div>

      {/* Footer hint */}
      <p className="text-[10px] text-gray-600 mt-3">
        Sparklines show last 30 days of daily DSR. Hover the Auto badge to see the
        classifier's reasoning. Use bulk select for sweeping a vendor or segment.
      </p>
    </div>
  );
}
