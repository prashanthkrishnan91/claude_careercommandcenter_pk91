"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { listProjects, quickLogAchievement } from "@/lib/repos";
import { getSupabase } from "@/lib/supabase";
import type { Project } from "@/lib/types";
import { QUICKLOG_EVENT, useShell } from "./ShellContext";

// Quick Log (v2.2 §5): an inline, non-blocking capture surface. Required
// fields are headline + project only. Submit creates a draft achievement
// (NEEDS_PROOF, INTERNAL_ONLY by the database defaults), the surface stays
// open, and focus returns to the headline — batch entry is the default
// mental model. `N` / `⌘N` focuses this bar; `presetProjectId` binds it to
// the current context on project/achievement pages.

export default function QuickLogBar({ presetProjectId }: { presetProjectId?: string }) {
  const { bump, version } = useShell();
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState(presetProjectId ?? "");
  const [headline, setHeadline] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastLogged, setLastLogged] = useState<string | null>(null);
  const headlineRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listProjects(getSupabase())
      .then((p) => {
        setProjects(p);
        setProjectId((cur) => cur || presetProjectId || p[0]?.id || "");
      })
      .catch(() => setProjects([]));
  }, [presetProjectId, version]);

  useEffect(() => {
    function onQuickLog(e: Event) {
      e.preventDefault(); // signal the shell that a surface handled it
      headlineRef.current?.focus();
    }
    window.addEventListener(QUICKLOG_EVENT, onQuickLog);
    return () => window.removeEventListener(QUICKLOG_EVENT, onQuickLog);
  }, []);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("ql") === "1") {
      headlineRef.current?.focus();
    }
  }, []);

  const submit = useCallback(async () => {
    if (!headline.trim() || !projectId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const a = await quickLogAchievement(getSupabase(), { project_fk: projectId, headline });
      setLastLogged(a.headline);
      setHeadline("");
      bump();
    } catch (e) {
      setError(e instanceof Error ? e.message : "capture failed");
    } finally {
      setBusy(false);
      headlineRef.current?.focus(); // batch entry: focus returns to headline
    }
  }, [headline, projectId, busy, bump]);

  return (
    <div className="panel flex flex-col gap-2 border-signal-blue/25 p-3 sm:flex-row sm:items-center">
      <span className="microlabel shrink-0 text-signal-blue/80">quick log</span>
      <input
        ref={headlineRef}
        className="field-input flex-1"
        placeholder='Achievement headline — e.g. "Reduced churn forecast error by 18%"'
        value={headline}
        onChange={(e) => setHeadline(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void submit();
        }}
      />
      <select
        className="field-input sm:w-56"
        value={projectId}
        onChange={(e) => setProjectId(e.target.value)}
        aria-label="Project"
      >
        {projects.length === 0 && <option value="">— add a project first —</option>}
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <button className="btn-primary shrink-0" onClick={() => void submit()} disabled={busy || !projectId}>
        {busy ? "Logging…" : "Log draft"}
      </button>
      <span className="font-mono text-[10px] text-dim-500">
        {error ? <span className="text-signal-red">{error}</span> : lastLogged ? `logged: ${lastLogged.slice(0, 40)} → draft` : "→ draft · needs proof · internal"}
      </span>
    </div>
  );
}
