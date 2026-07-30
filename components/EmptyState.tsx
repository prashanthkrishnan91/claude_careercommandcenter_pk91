"use client";

// The six approved empty states, verbatim from v2.2 §6. Cockpit-grade:
// no illustrations, no marketing copy, no emoji, no welcome language.

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-xl border border-dashed border-ink-600 px-6 py-8 text-[13px] leading-relaxed text-dim-400 [&>p+p]:mt-3">
      {children}
    </div>
  );
}

export function VaultEmpty() {
  return (
    <EmptyState>
      <p className="font-medium text-dim-200">Your evidence vault is empty.</p>
      <p>
        Start by logging one project from your current role at DIRECTV. A project is a body of
        work — a system you built, a problem you owned, a function you led. Achievements come
        next, inside projects.
      </p>
      <p>
        Press <kbd>Cmd+N</kbd> or <span className="font-mono text-dim-300">Add Project</span>.
      </p>
    </EmptyState>
  );
}

export function ProjectNoAchievements({ name }: { name: string }) {
  return (
    <EmptyState>
      <p>
        No achievements yet for <span className="font-medium text-dim-200">{name}</span>.
      </p>
      <p>
        Achievements are discrete outcomes within this body of work. Examples: &ldquo;Reduced churn
        forecast error by 18%&rdquo;, &ldquo;Launched the executive retention dashboard&rdquo;, &ldquo;Led the
        migration from SAS to Python.&rdquo;
      </p>
      <p>
        Add the first one — <kbd>Cmd+N</kbd>.
      </p>
    </EmptyState>
  );
}

export function AchievementNoMetrics() {
  return (
    <EmptyState>
      <p className="font-medium text-dim-200">No quantified impact yet for this achievement.</p>
      <p>
        Director-level achievements typically carry at least one metric — revenue, retention,
        cost, scale, time, accuracy. If the impact wasn&apos;t measured, note that explicitly in the
        narrative so future grading reflects it accurately.
      </p>
    </EmptyState>
  );
}

export function AchievementNoEvidence() {
  return (
    <EmptyState>
      <p className="font-medium text-dim-200">No evidence linked.</p>
      <p>
        Without evidence, this achievement remains NEEDS_PROOF and cannot be promoted to external
        use. Evidence can be a document reference, a link, an email reference, a peer
        testimonial, or a metric source. Even a one-line note about where the proof exists
        strengthens the record.
      </p>
    </EmptyState>
  );
}

export function PipelineEmpty() {
  return (
    <EmptyState>
      <p className="font-medium text-dim-200">No drafts. No recent activity.</p>
      <p>
        The Pipeline view shows your working layer — incomplete achievements, recent edits, and
        archived items. As you log evidence, this is where you&apos;ll triage and refine.
      </p>
    </EmptyState>
  );
}

export function ArchivedEmpty() {
  return (
    <EmptyState>
      <p className="font-medium text-dim-200">Nothing archived.</p>
      <p>
        Archive is for items you&apos;ve decided not to use but don&apos;t want to lose — weak
        achievements, duplicates, exploratory drafts. Nothing here is deleted.
      </p>
    </EmptyState>
  );
}
