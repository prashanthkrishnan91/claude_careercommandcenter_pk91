"use client";

import type { PrivacyClass, TruthStatus } from "@/lib/types";

// Semantic encoding (v2.2 §3): truth = blue spectrum (VERIFIED strong,
// NEEDS_PROOF muted/warning, DISPUTED red); privacy = green / amber / red;
// lifecycle = opacity + dashed/italic handled at the row level.

const TRUTH: Record<TruthStatus, { cls: string; label: string }> = {
  VERIFIED: { cls: "text-signal-blue", label: "verified" },
  ATTESTED_WITH_METRIC: { cls: "text-signal-bluedim", label: "attested+metric" },
  ATTESTED_NO_METRIC: { cls: "text-signal-bluedim", label: "attested·no·metric" },
  INFERRED: { cls: "text-dim-400", label: "inferred" },
  NEEDS_PROOF: { cls: "text-signal-amber", label: "needs proof" },
  DISPUTED: { cls: "text-signal-red", label: "disputed" },
};

const PRIVACY: Record<PrivacyClass, { cls: string; label: string }> = {
  PUBLIC_SAFE: { cls: "text-signal-green", label: "public-safe" },
  INTERNAL_ONLY: { cls: "text-signal-amber", label: "internal" },
  PRIVATE: { cls: "text-signal-red", label: "private" },
};

export function TruthBadge({ value }: { value: TruthStatus }) {
  const t = TRUTH[value];
  return (
    <span className={`inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.1em] ${t.cls}`} title={`Truth status: ${value}`}>
      <span aria-hidden>●</span>
      {t.label}
    </span>
  );
}

export function PrivacyBadge({ value }: { value: PrivacyClass }) {
  const p = PRIVACY[value];
  return (
    <span className={`font-mono text-[10px] uppercase tracking-[0.1em] ${p.cls}`} title={`Privacy class: ${value}`}>
      [{p.label}]
    </span>
  );
}

export function StatusBadge({ value }: { value: string }) {
  const cls =
    value === "draft"
      ? "text-signal-amber"
      : value === "active" || value === "complete" || value === "confirmed" || value === "accepted"
        ? "text-signal-green"
        : value === "archived" || value === "not_started"
          ? "text-dim-500"
          : value === "blocked" || value === "declined" || value === "do_not_ask" || value === "abandoned"
            ? "text-signal-red"
            : "text-dim-300";
  return (
    <span className={`font-mono text-[10px] uppercase tracking-[0.1em] ${cls}`}>{value.replace(/_/g, " ")}</span>
  );
}

export function CandidateBadge({ value }: { value: boolean }) {
  if (!value) return null;
  return (
    <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-signal-blue" title="Candidate for external use (final approval comes from P0B/P0E gates)">
      ↗ ext-candidate
    </span>
  );
}

export function CountPill({ n, label }: { n: number; label: string }) {
  return (
    <span className="font-mono text-[10px] text-dim-500">
      {n} {label}
    </span>
  );
}
