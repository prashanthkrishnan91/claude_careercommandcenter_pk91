import type {
  Achievement,
  EvidenceItem,
  Metric,
  PrivacyClass,
  Project,
  TruthStatus,
} from "./types";

// Global P0A filters (v2.2 §4): lifecycle status, truth status, privacy
// class, employer, date range, candidate_for_external_bool. Applied across
// Vault and Pipeline. No full-text search in P0A.

export interface FilterState {
  status: string | null; // lifecycle: draft/active/archived (per-entity sets)
  truth: TruthStatus | null;
  privacy: PrivacyClass | null;
  employer: string | null;
  dateFrom: string | null; // YYYY-MM-DD
  dateTo: string | null;
  candidateOnly: boolean;
}

export const EMPTY_FILTERS: FilterState = {
  status: null,
  truth: null,
  privacy: null,
  employer: null,
  dateFrom: null,
  dateTo: null,
  candidateOnly: false,
};

export function hasActiveFilters(f: FilterState): boolean {
  return (
    f.status !== null ||
    f.truth !== null ||
    f.privacy !== null ||
    f.employer !== null ||
    f.dateFrom !== null ||
    f.dateTo !== null ||
    f.candidateOnly
  );
}

// The date-range filter matches an entity when its date span (start/end where
// the entity has one, otherwise its creation date) intersects [from, to].
function inRange(
  f: FilterState,
  start: string | null,
  end: string | null,
  createdAt: string,
): boolean {
  const effStart = start ?? createdAt.slice(0, 10);
  const effEnd = end ?? effStart;
  if (f.dateFrom && effEnd < f.dateFrom) return false;
  if (f.dateTo && effStart > f.dateTo) return false;
  return true;
}

export function projectMatches(f: FilterState, p: Project): boolean {
  if (f.status && p.status !== f.status) return false;
  if (f.truth) return false; // projects carry no truth_status (canonical model)
  if (f.privacy && p.privacy_class !== f.privacy) return false;
  if (f.employer && p.employer !== f.employer) return false;
  if (f.candidateOnly) return false; // projects carry no candidate flag
  return inRange(f, p.start_date, p.end_date, p.created_at);
}

export function achievementMatches(
  f: FilterState,
  a: Achievement,
  project: Project | undefined,
): boolean {
  if (f.status && a.status !== f.status) return false;
  if (f.truth && a.truth_status !== f.truth) return false;
  if (f.privacy && a.privacy_class !== f.privacy) return false;
  if (f.employer && project?.employer !== f.employer) return false;
  if (f.candidateOnly && !a.candidate_for_external_bool) return false;
  return inRange(f, a.start_date, a.end_date, a.created_at);
}

export function metricMatches(f: FilterState, m: Metric, employer: string | undefined): boolean {
  if (f.status && m.status !== f.status) return false;
  if (f.truth && m.truth_status !== f.truth) return false;
  if (f.privacy && m.privacy_class !== f.privacy) return false;
  if (f.employer && employer !== f.employer) return false;
  if (f.candidateOnly) return false; // metrics carry no candidate flag
  return inRange(f, null, null, m.created_at);
}

export function evidenceMatches(
  f: FilterState,
  e: EvidenceItem,
  employer: string | undefined,
): boolean {
  if (f.status && e.status !== f.status) return false;
  if (f.truth) return false; // evidence items carry no truth_status (canonical model)
  if (f.privacy && e.privacy_class !== f.privacy) return false;
  if (f.employer && employer !== f.employer) return false;
  if (f.candidateOnly) return false;
  return inRange(f, null, null, e.created_at);
}
