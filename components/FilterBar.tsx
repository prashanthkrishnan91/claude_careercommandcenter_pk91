"use client";

import { EMPTY_FILTERS, type FilterState, hasActiveFilters } from "@/lib/filters";
import { PRIVACY_CLASSES, TRUTH_STATUSES } from "@/lib/types";

// Global P0A filters (v2.2 §4): lifecycle, truth, privacy, employer, date
// range, candidate flag. No full-text search.

export default function FilterBar({
  filters,
  onChange,
  employers,
  statusOptions,
}: {
  filters: FilterState;
  onChange: (f: FilterState) => void;
  employers: string[];
  statusOptions: string[];
}) {
  const set = (patch: Partial<FilterState>) => onChange({ ...filters, ...patch });
  const sel = "rounded-sm border border-ink-600 bg-ink-900 px-1.5 py-1 font-mono text-[10px] uppercase text-dim-300 outline-none focus:border-signal-blue/50";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="microlabel">filter</span>
      <select className={sel} value={filters.status ?? ""} onChange={(e) => set({ status: e.target.value || null })}>
        <option value="">status: all</option>
        {statusOptions.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
      <select className={sel} value={filters.truth ?? ""} onChange={(e) => set({ truth: (e.target.value || null) as FilterState["truth"] })}>
        <option value="">truth: all</option>
        {TRUTH_STATUSES.map((t) => (
          <option key={t} value={t}>{t.toLowerCase()}</option>
        ))}
      </select>
      <select className={sel} value={filters.privacy ?? ""} onChange={(e) => set({ privacy: (e.target.value || null) as FilterState["privacy"] })}>
        <option value="">privacy: all</option>
        {PRIVACY_CLASSES.map((p) => (
          <option key={p} value={p}>{p.toLowerCase()}</option>
        ))}
      </select>
      <select className={sel} value={filters.employer ?? ""} onChange={(e) => set({ employer: e.target.value || null })}>
        <option value="">employer: all</option>
        {employers.map((emp) => (
          <option key={emp} value={emp}>{emp}</option>
        ))}
      </select>
      <input type="date" className={sel} value={filters.dateFrom ?? ""} onChange={(e) => set({ dateFrom: e.target.value || null })} aria-label="From date" />
      <span className="text-[10px] text-dim-500">→</span>
      <input type="date" className={sel} value={filters.dateTo ?? ""} onChange={(e) => set({ dateTo: e.target.value || null })} aria-label="To date" />
      <label className="flex cursor-pointer items-center gap-1 font-mono text-[10px] uppercase text-dim-300">
        <input type="checkbox" className="accent-[#5b9dff]" checked={filters.candidateOnly} onChange={(e) => set({ candidateOnly: e.target.checked })} />
        ext-candidates
      </label>
      {hasActiveFilters(filters) && (
        <button className="btn-quiet" onClick={() => onChange(EMPTY_FILTERS)}>
          clear
        </button>
      )}
    </div>
  );
}
