"use client";

import { useCallback, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { StatusBadge } from "@/components/Badges";
import PageHeader from "@/components/PageHeader";
import { useShell } from "@/components/ShellContext";
import { SpecAddForm, SpecCard, normalizeSpecValues, type FieldSpec } from "@/components/SpecForm";
import { postApi } from "@/lib/apiClient";
import { archiveRow, createRow, listRows, updateRow } from "@/lib/genericRepo";
import { useVaultData } from "@/lib/hooks";
import { computeMaturity } from "@/lib/maturity";
import { getSupabase } from "@/lib/supabase";
import type {
  Application,
  Company,
  Contact,
  GoogleConnection,
  Interview,
  Outreach,
  Referral,
} from "@/lib/entities";

// Career pipeline (P1 distribution layer). Fully implemented, but locked
// behind the Maturity Gates (v2.1 §15): before every gate is met the surfaces
// are read-only previews, mutating actions are unavailable, and the exact
// remaining conditions are listed. Nothing here fabricates usage history.

const COMPANY_SPECS: FieldSpec[] = [
  { key: "name", label: "Company", kind: "text", required: true },
  { key: "tier", label: "Tier", kind: "text", placeholder: "tier-1 / tier-2 / …" },
  { key: "gc_sponsorship_history", label: "GC sponsorship history", kind: "textarea", span: 2 },
  { key: "notes", label: "Notes", kind: "textarea", span: 2 },
];
const CONTACT_SPECS: FieldSpec[] = [
  { key: "name", label: "Name", kind: "text", required: true },
  { key: "role_title", label: "Role", kind: "text" },
  { key: "email", label: "Email", kind: "text", mono: true },
  { key: "source", label: "Source", kind: "text", placeholder: "e.g. linkedin_paste, referral, event" },
  { key: "last_touch", label: "Last touch", kind: "date" },
  { key: "linkedin_paste_raw", label: "LinkedIn paste-in (manual, ToS-safe)", kind: "textarea", span: 2, placeholder: "Paste profile text here — nothing is scraped or automated" },
  { key: "notes", label: "Notes", kind: "textarea", span: 2 },
];
const APPLICATION_SPECS: FieldSpec[] = [
  { key: "role_title", label: "Role title", kind: "text", required: true },
  { key: "channel", label: "Channel", kind: "select", options: ["referral", "direct", "recruiter", "other"] },
  { key: "stage", label: "Stage", kind: "select", options: ["draft", "applied", "screening", "interviewing", "offer", "rejected", "withdrawn", "closed"] },
  { key: "applied_at", label: "Applied", kind: "date" },
  { key: "notes", label: "Notes", kind: "textarea", span: 2 },
];
const INTERVIEW_SPECS: FieldSpec[] = [
  { key: "round", label: "Round", kind: "text", placeholder: "phone screen / loop / onsite" },
  { key: "occurred_at", label: "Date", kind: "date" },
  { key: "interviewer", label: "Interviewer", kind: "text" },
  { key: "outcome", label: "Outcome", kind: "select", options: ["pending", "passed", "failed", "canceled", "unknown"] },
  { key: "debrief_markdown", label: "Structured debrief", kind: "textarea", span: 2, placeholder: "What was asked, how it landed, follow-ups" },
];
const OUTREACH_SPECS: FieldSpec[] = [
  { key: "channel", label: "Channel", kind: "select", options: ["email", "linkedin", "phone", "in_person", "other"] },
  { key: "direction", label: "Direction", kind: "select", options: ["outbound", "inbound"] },
  { key: "occurred_at", label: "Date", kind: "date" },
  { key: "followup_due", label: "Follow-up due", kind: "date" },
  { key: "summary", label: "Summary", kind: "textarea", span: 2 },
];

export default function CareerPage() {
  const { bump } = useShell();
  const db = getSupabase();
  const [syncNotice, setSyncNotice] = useState<string | null>(null);

  const loader = useCallback(async (dbc: SupabaseClient) => {
    const [maturity, companies, contacts, applications, interviews, referrals, outreach, connections] =
      await Promise.all([
        computeMaturity(dbc),
        listRows<Company>(dbc, "companies", {}),
        listRows<Contact>(dbc, "contacts", {}),
        listRows<Application>(dbc, "applications", {}),
        listRows<Interview>(dbc, "interviews", {}),
        listRows<Referral>(dbc, "referrals", {}),
        listRows<Outreach>(dbc, "outreach", {}),
        listRows<GoogleConnection>(dbc, "google_connections", { includeArchived: true }),
      ]);
    return { maturity, companies, contacts, applications, interviews, referrals, outreach, connections };
  }, []);
  const { data, loading, error } = useVaultData(loader);
  if (loading) return <p className="microlabel animate-pulse p-8">loading…</p>;
  if (error || !data) return <p className="p-8 text-[13px] text-signal-red">{error}</p>;

  const unlocked = data.maturity.unlocked;
  const unmet = data.maturity.criteria.filter((c) => !c.met);
  const companyName = new Map(data.companies.map((c) => [c.id, c.name]));
  const contactName = new Map(data.contacts.map((c) => [c.id, c.name]));

  return (
    <main>
      <PageHeader crumb="career pipeline · distribution layer (P1)" title="Career" />
      <div className="space-y-8 px-4 py-5 md:px-8">
        {/* maturity lock */}
        <section className={`panel p-4 ${unlocked ? "border-signal-green/30" : "border-signal-amber/40"}`}>
          <h2 className={`microlabel mb-2 ${unlocked ? "text-signal-green" : "text-signal-amber"}`}>
            {unlocked
              ? data.maturity.allMet
                ? "distribution layer unlocked — all maturity gates met"
                : "UNLOCKED VIA DEV OVERRIDE — gates below are not actually met"
              : "locked — read-only preview until every maturity gate is met"}
          </h2>
          {!data.maturity.allMet && (
            <ul className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
              {unmet.map((c) => (
                <li key={c.key} className="flex items-baseline gap-2 text-[12px] text-dim-400">
                  <span className="text-signal-amber">□</span> {c.label}
                  <span className="font-mono text-[10px] text-dim-500">({c.detail})</span>
                </li>
              ))}
            </ul>
          )}
          {!unlocked && (
            <p className="mt-2 text-[12px] text-dim-500">
              These are output gates, not calendar gates. The system unlocks when the work exists —
              an owner-only development override lives in Settings and is logged whenever used.
            </p>
          )}
        </section>

        {/* companies + contacts */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="microlabel">companies · {data.companies.length}</h2>
              {unlocked && (
                <SpecAddForm title="Add company" specs={COMPANY_SPECS} onCreate={async (v) => { await createRow(db, "companies", normalizeSpecValues(COMPANY_SPECS, v)); bump(); }} />
              )}
            </div>
            {data.companies.length === 0 ? (
              <p className="border border-dashed border-ink-600 px-4 py-3 text-[12px] text-dim-500">No companies tracked.</p>
            ) : (
              <div className="space-y-2">
                {data.companies.map((c) => (
                  <details key={c.id} className="panel px-4 py-2">
                    <summary className="flex cursor-pointer items-baseline gap-3">
                      <span className="min-w-0 flex-1 truncate text-[13px] text-dim-100">{c.name}</span>
                      {c.tier && <span className="font-mono text-[10px] uppercase text-dim-500">{c.tier}</span>}
                      {unlocked && <button className="btn-quiet" onClick={(e) => { e.preventDefault(); void archiveRow(db, "companies", c.id).then(bump); }}>archive</button>}
                    </summary>
                    {unlocked && (
                      <div className="mt-3 border-t border-ink-700 pt-3">
                        <SpecCard row={c as never} specs={COMPANY_SPECS} onPatch={async (p) => { await updateRow(db, "companies", c.id, p); }} />
                      </div>
                    )}
                  </details>
                ))}
              </div>
            )}
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="microlabel">contacts · {data.contacts.length}</h2>
              {unlocked && (
                <SpecAddForm title="Add contact" specs={CONTACT_SPECS} onCreate={async (v) => { await createRow(db, "contacts", normalizeSpecValues(CONTACT_SPECS, v)); bump(); }} />
              )}
            </div>
            {data.contacts.length === 0 ? (
              <p className="border border-dashed border-ink-600 px-4 py-3 text-[12px] text-dim-500">
                No contacts. Capture is manual — paste-in only, no LinkedIn automation, no scraping.
              </p>
            ) : (
              <div className="space-y-2">
                {data.contacts.map((c) => (
                  <details key={c.id} className="panel px-4 py-2">
                    <summary className="flex cursor-pointer items-baseline gap-3">
                      <span className="min-w-0 flex-1 truncate text-[13px] text-dim-100">{c.name}</span>
                      <span className="text-[12px] text-dim-400">{c.role_title}</span>
                      {c.last_touch && <span className="font-mono text-[10px] text-dim-500">touch {c.last_touch}</span>}
                    </summary>
                    {unlocked && (
                      <div className="mt-3 border-t border-ink-700 pt-3">
                        <SpecCard row={c as never} specs={CONTACT_SPECS} onPatch={async (p) => { await updateRow(db, "contacts", c.id, p); }} />
                        <div className="mt-3">
                          <SpecAddForm
                            title="Log outreach"
                            specs={OUTREACH_SPECS}
                            onCreate={async (v) => { await createRow(db, "outreach", { contact_fk: c.id, ...normalizeSpecValues(OUTREACH_SPECS, v) }); bump(); }}
                          />
                        </div>
                      </div>
                    )}
                  </details>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* applications + interviews + referrals */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="microlabel">applications · {data.applications.length}</h2>
            {unlocked && (
              <SpecAddForm title="Track application" specs={APPLICATION_SPECS} onCreate={async (v) => { await createRow(db, "applications", normalizeSpecValues(APPLICATION_SPECS, v)); bump(); }} />
            )}
          </div>
          {data.applications.length === 0 ? (
            <p className="border border-dashed border-ink-600 px-4 py-3 text-[12px] text-dim-500">
              No applications tracked. The app records applications; it never submits them.
            </p>
          ) : (
            <div className="space-y-2">
              {data.applications.map((app) => {
                const rounds = data.interviews.filter((i) => i.application_fk === app.id);
                const refs = data.referrals.filter((r) => r.application_fk === app.id);
                return (
                  <details key={app.id} className="panel px-4 py-2">
                    <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="min-w-0 flex-1 truncate text-[13px] text-dim-100">{app.role_title}</span>
                      {app.company_fk && <span className="text-[12px] text-dim-400">{companyName.get(app.company_fk)}</span>}
                      <StatusBadge value={app.stage} />
                      <span className="font-mono text-[10px] text-dim-500">{rounds.length} interview(s) · {refs.length} referral(s)</span>
                    </summary>
                    {unlocked && (
                      <div className="mt-3 space-y-3 border-t border-ink-700 pt-3">
                        <SpecCard row={app as never} specs={APPLICATION_SPECS} onPatch={async (p) => { await updateRow(db, "applications", app.id, p); }} />
                        {rounds.map((i) => (
                          <details key={i.id} className="border border-ink-700 px-3 py-2">
                            <summary className="flex cursor-pointer items-baseline gap-3 text-[12px] text-dim-200">
                              <span>{i.round || "round"}</span>
                              <span className="font-mono text-[10px] text-dim-500">{i.occurred_at ?? "unscheduled"}</span>
                              <StatusBadge value={i.outcome} />
                            </summary>
                            <div className="mt-2 border-t border-ink-700 pt-2">
                              <SpecCard row={i as never} specs={INTERVIEW_SPECS} onPatch={async (p) => { await updateRow(db, "interviews", i.id, p); }} />
                            </div>
                          </details>
                        ))}
                        <div className="flex gap-2">
                          <SpecAddForm title="Add interview" specs={INTERVIEW_SPECS} onCreate={async (v) => { await createRow(db, "interviews", { application_fk: app.id, ...normalizeSpecValues(INTERVIEW_SPECS, v) }); bump(); }} />
                          {data.contacts.length > 0 && (
                            <button
                              className="btn"
                              onClick={async () => {
                                const name = window.prompt(`Referral contact name (existing contact): ${data.contacts.map((c) => c.name).join(", ")}`);
                                const contact = data.contacts.find((c) => c.name.toLowerCase() === name?.toLowerCase());
                                if (!contact) return;
                                await createRow(db, "referrals", { contact_fk: contact.id, application_fk: app.id });
                                bump();
                              }}
                            >
                              + Referral
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </details>
                );
              })}
            </div>
          )}
        </section>

        {/* referrals + outreach logs */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <section>
            <h2 className="microlabel mb-2">referrals · {data.referrals.length}</h2>
            {data.referrals.length === 0 ? (
              <p className="border border-dashed border-ink-600 px-4 py-3 text-[12px] text-dim-500">
                None. Referral *asks* stay dormant until Visa Gate 6 clears (see Rhythm → market motion).
              </p>
            ) : (
              <ul className="panel divide-y divide-ink-700/70">
                {data.referrals.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2">
                    <span className="min-w-0 flex-1 truncate text-[13px] text-dim-100">{contactName.get(r.contact_fk)}</span>
                    <StatusBadge value={r.stage} />
                    {unlocked && (
                      <select
                        className="rounded-sm border border-ink-600 bg-ink-900 px-1 py-0.5 font-mono text-[10px] uppercase text-dim-300"
                        value={r.stage}
                        onChange={(e) => void updateRow(db, "referrals", r.id, { stage: e.target.value }).then(bump)}
                      >
                        {["identified", "prepped", "requested", "agreed", "submitted", "declined", "closed"].map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className="microlabel mb-2">gmail / calendar ingestion (real OAuth)</h2>
            <div className="panel p-4 text-[12px] text-dim-400">
              {data.connections.filter((c) => !c.revoked_at).length === 0 ? (
                <p>
                  Not connected. Connect from Settings — requires GOOGLE_CLIENT_ID / SECRET configured
                  server-side. Read-only scopes; manual, idempotent syncs; one-click revocation.
                </p>
              ) : (
                data.connections.filter((c) => !c.revoked_at).map((c) => (
                  <div key={c.id} className="flex flex-wrap items-center gap-3">
                    <span className="font-mono text-[11px] text-dim-200">{c.provider} · {c.account_email || "connected"}</span>
                    <span className="font-mono text-[10px] text-dim-500">{c.last_sync_status || "never synced"}</span>
                    <button
                      className="btn"
                      onClick={async () => {
                        const res = await postApi<{ inserted?: number; error?: string; message?: string }>("/api/google/sync", { provider: c.provider });
                        setSyncNotice(res.status === 200 ? `synced: ${res.json.inserted} new item(s)` : res.json.message ?? res.json.error ?? "sync failed");
                        bump();
                      }}
                    >
                      Sync now
                    </button>
                  </div>
                ))
              )}
              {syncNotice && <p className="mt-2 text-signal-amber">{syncNotice}</p>}
              <p className="mt-2 text-[11px] text-dim-500">
                Hard prohibitions stand: no LinkedIn automation, no scraping, no scheduled sweeps, no direct application submission.
              </p>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
