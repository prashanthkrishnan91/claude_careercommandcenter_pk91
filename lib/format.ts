// Dates are calendar dates entered by the user; render them exactly, compactly.
export function fmtDate(d: string | null | undefined): string {
  return d ?? "—";
}

export function fmtRange(start: string | null, end: string | null): string {
  if (!start && !end) return "";
  return `${start ?? "…"} → ${end ?? "ongoing"}`;
}
