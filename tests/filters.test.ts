import { describe, expect, it } from "vitest";
import {
  achievementMatches,
  EMPTY_FILTERS,
  evidenceMatches,
  hasActiveFilters,
  metricMatches,
  projectMatches,
  type FilterState,
} from "../lib/filters";
import type { Achievement, Project } from "../lib/types";

// Release blocker #7 (filter half): the Vault stripped the status filter
// before matching projects. These tests pin the matcher semantics the Vault
// hierarchy now relies on — status included.

const project = (over: Partial<Project> = {}): Project =>
  ({
    id: "p1",
    user_id: "u1",
    name: "Churn overhaul",
    employer: "DIRECTV",
    role_at_time: "",
    start_date: "2025-01-01",
    end_date: "2025-06-30",
    description: "",
    business_context: "",
    my_scope: "",
    team_size: null,
    stakeholders: [],
    privacy_class: "INTERNAL_ONLY",
    status: "active",
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
    ...over,
  }) as Project;

const achievement = (over: Partial<Achievement> = {}): Achievement =>
  ({
    id: "a1",
    user_id: "u1",
    project_fk: "p1",
    headline: "Reduced churn 18%",
    narrative: "",
    action_taken: "",
    outcome: "",
    start_date: null,
    end_date: null,
    claimed_seniority_level: null,
    truth_status: "NEEDS_PROOF",
    privacy_class: "INTERNAL_ONLY",
    has_metric_bool: false,
    candidate_for_external_bool: false,
    status: "draft",
    created_at: "2025-03-01T00:00:00Z",
    updated_at: "2025-03-01T00:00:00Z",
    ...over,
  }) as Achievement;

const f = (over: Partial<FilterState>): FilterState => ({ ...EMPTY_FILTERS, ...over });

describe("status filter is applied — never stripped", () => {
  it("projects match their own lifecycle status", () => {
    expect(projectMatches(f({ status: "archived" }), project({ status: "archived" }))).toBe(true);
    expect(projectMatches(f({ status: "archived" }), project({ status: "active" }))).toBe(false);
    expect(projectMatches(f({ status: "active" }), project({ status: "active" }))).toBe(true);
  });

  it("achievements match draft/active/archived exactly", () => {
    expect(achievementMatches(f({ status: "draft" }), achievement(), project())).toBe(true);
    expect(achievementMatches(f({ status: "active" }), achievement(), project())).toBe(false);
    expect(achievementMatches(f({ status: "archived" }), achievement({ status: "archived" }), project())).toBe(true);
  });
});

describe("filter combinations", () => {
  it("status + truth + privacy + employer + candidate all constrain together", () => {
    const a = achievement({
      status: "active",
      truth_status: "VERIFIED",
      privacy_class: "PUBLIC_SAFE",
      candidate_for_external_bool: true,
    });
    const combined = f({
      status: "active",
      truth: "VERIFIED",
      privacy: "PUBLIC_SAFE",
      employer: "DIRECTV",
      candidateOnly: true,
    });
    expect(achievementMatches(combined, a, project())).toBe(true);
    expect(achievementMatches(combined, a, project({ employer: "Other Corp" }))).toBe(false);
    expect(achievementMatches({ ...combined, truth: "DISPUTED" }, a, project())).toBe(false);
    expect(achievementMatches({ ...combined, privacy: "PRIVATE" }, a, project())).toBe(false);
    expect(achievementMatches({ ...combined, status: "draft" }, a, project())).toBe(false);
  });

  it("truth and candidate filters exclude projects (they carry neither) so only matching achievements surface them", () => {
    expect(projectMatches(f({ truth: "VERIFIED" }), project())).toBe(false);
    expect(projectMatches(f({ candidateOnly: true }), project())).toBe(false);
  });

  it("date-range intersects the entity span; created_at is the fallback", () => {
    const a = achievement({ start_date: "2025-02-01", end_date: "2025-04-01" });
    expect(achievementMatches(f({ dateFrom: "2025-03-01" }), a, project())).toBe(true);
    expect(achievementMatches(f({ dateFrom: "2025-05-01" }), a, project())).toBe(false);
    expect(achievementMatches(f({ dateTo: "2025-01-15" }), a, project())).toBe(false);
    const dateless = achievement({ start_date: null, end_date: null });
    expect(achievementMatches(f({ dateFrom: "2025-03-01", dateTo: "2025-03-02" }), dateless, project())).toBe(true);
  });

  it("metric and evidence rows honor status/privacy/employer and never match candidateOnly", () => {
    const m = { id: "m1", status: "active", truth_status: "VERIFIED", privacy_class: "PUBLIC_SAFE", created_at: "2025-03-01T00:00:00Z" } as never;
    expect(metricMatches(f({ status: "active", privacy: "PUBLIC_SAFE" }), m, "DIRECTV")).toBe(true);
    expect(metricMatches(f({ status: "archived" }), m, "DIRECTV")).toBe(false);
    expect(metricMatches(f({ candidateOnly: true }), m, "DIRECTV")).toBe(false);
    const e = { id: "e1", status: "active", privacy_class: "PUBLIC_SAFE", created_at: "2025-03-01T00:00:00Z" } as never;
    expect(evidenceMatches(f({ employer: "DIRECTV" }), e, "DIRECTV")).toBe(true);
    expect(evidenceMatches(f({ employer: "Other" }), e, "DIRECTV")).toBe(false);
    expect(evidenceMatches(f({ truth: "VERIFIED" }), e, "DIRECTV")).toBe(false);
  });

  it("hasActiveFilters reflects every dimension", () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
    for (const over of [
      { status: "draft" },
      { truth: "VERIFIED" as const },
      { privacy: "PRIVATE" as const },
      { employer: "DIRECTV" },
      { dateFrom: "2025-01-01" },
      { dateTo: "2025-01-01" },
      { candidateOnly: true },
    ]) {
      expect(hasActiveFilters(f(over))).toBe(true);
    }
  });
});
