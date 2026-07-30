"use client";

import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import PageHeader from "@/components/PageHeader";
import { useShell } from "@/components/ShellContext";
import { postApi } from "@/lib/apiClient";
import { listRows } from "@/lib/genericRepo";
import { setOverride } from "@/lib/maturity";
import { useVaultData } from "@/lib/hooks";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type UserSettings } from "@/lib/settings";
import { getSupabase } from "@/lib/supabase";
import { PRIVACY_CLASSES, TRUTH_STATUSES, type PrivacyClass, type TruthStatus } from "@/lib/types";
import type { GoogleConnection } from "@/lib/entities";

// Settings: profile placeholder, defaults, static privacy/RLS explanation
// (v2.2.2 C1) — plus operational surfaces the full product requires: AI
// availability, Google ingestion connections, and the logged owner override.
// No export (deferred by C1), no audit-log UI, no theming, no admin console.

export default function SettingsPage() {
  const { signOut, bump } = useShell();
  const db = getSupabase();
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setSettings(loadSettings());
    setLoaded(true);
    getSupabase().auth.getUser().then(({ data }) => setEmail(data.user?.email ?? ""));
  }, []);

  const loader = useCallback(async (dbc: SupabaseClient) => {
    const [connections, overrides] = await Promise.all([
      listRows<GoogleConnection>(dbc, "google_connections", { includeArchived: true }),
      listRows<{ id: string; override_key: string; enabled_bool: boolean; reason: string; created_at: string }>(dbc, "owner_overrides", { includeArchived: true }),
    ]);
    return { connections, overrides };
  }, []);
  const { data } = useVaultData(loader);

  function update(patch: Partial<UserSettings>) {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }

  if (!loaded) return null;
  const overrideOn = data?.overrides.some((o) => o.override_key === "maturity_dev_override" && o.enabled_bool) ?? false;

  return (
    <main>
      <PageHeader crumb="settings" title="Settings" />
      <div className="max-w-2xl space-y-6 px-4 py-6 md:px-8">
        <section className="panel p-5">
          <h2 className="microlabel mb-4">profile</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <span className="field-label">Name</span>
              <input className="field-input" value={settings.profile_name} onChange={(e) => update({ profile_name: e.target.value })} />
            </div>
            <div>
              <span className="field-label">Target role</span>
              <input className="field-input" value={settings.target_role} onChange={(e) => update({ target_role: e.target.value })} placeholder="Free text — link to archetypes happens in Intelligence" />
            </div>
          </div>
          {email && (
            <p className="mt-4 font-mono text-[11px] text-dim-500">
              signed in as {email}
              <button onClick={() => void signOut()} className="ml-2 text-dim-400 underline decoration-ink-600 hover:text-signal-red">sign out</button>
            </p>
          )}
        </section>

        <section className="panel p-5">
          <h2 className="microlabel mb-1">defaults for new entries</h2>
          <p className="mb-4 text-[12px] text-dim-500">
            Quick Log always creates drafts as NEEDS_PROOF / INTERNAL_ONLY (locked by the capture contract);
            these defaults seed the fuller metric/evidence forms.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <span className="field-label">Default truth status</span>
              <select className="field-input font-mono text-[12px]" value={settings.default_truth_status} onChange={(e) => update({ default_truth_status: e.target.value as TruthStatus })}>
                {TRUTH_STATUSES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <span className="field-label">Default privacy class</span>
              <select className="field-input font-mono text-[12px]" value={settings.default_privacy_class} onChange={(e) => update({ default_privacy_class: e.target.value as PrivacyClass })}>
                {PRIVACY_CLASSES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>
        </section>

        <section className="panel p-5">
          <h2 className="microlabel mb-2">ai</h2>
          <p className="text-[12px] leading-relaxed text-dim-400">
            AI (grading, JD extraction, asset generation) runs server-side through the Anthropic API
            with the model set by <span className="font-mono">ANTHROPIC_MODEL</span>. Without{" "}
            <span className="font-mono">ANTHROPIC_API_KEY</span> configured on the deployment, those
            surfaces show a calm unavailable state — nothing is fabricated. Truth/privacy checks run
            before every call; PRIVATE text never leaves the database; every call (including blocked
            ones) is recorded in the Intelligence audit.
          </p>
        </section>

        <section className="panel p-5">
          <h2 className="microlabel mb-2">google ingestion (gmail / calendar, read-only)</h2>
          {(data?.connections ?? []).filter((c) => !c.revoked_at).length === 0 ? (
            <p className="text-[12px] text-dim-400">Not connected.</p>
          ) : (
            (data?.connections ?? []).filter((c) => !c.revoked_at).map((c) => (
              <p key={c.id} className="flex items-center gap-3 text-[12px] text-dim-300">
                <span className="font-mono">{c.provider}</span> {c.account_email}
                <button
                  className="btn-quiet hover:text-signal-red"
                  onClick={async () => {
                    await postApi("/api/google/revoke", { connectionId: c.id });
                    bump();
                  }}
                >
                  revoke + purge
                </button>
              </p>
            ))
          )}
          <div className="mt-3 flex gap-2">
            {(["gmail", "calendar"] as const).map((provider) => (
              <button
                key={provider}
                className="btn"
                onClick={async () => {
                  const { data: s } = await getSupabase().auth.getSession();
                  const res = await postApi<{ url?: string; message?: string }>("/api/google/connect", {
                    provider,
                    accessToken: s.session?.access_token,
                  });
                  if (res.json.url) window.location.href = res.json.url;
                  else setNotice(res.json.message ?? "Google OAuth is not configured on this deployment.");
                }}
              >
                Connect {provider}
              </button>
            ))}
          </div>
          {notice && <p className="mt-2 text-[12px] text-signal-amber">{notice}</p>}
          <p className="mt-2 text-[11px] text-dim-500">
            gmail.readonly / calendar.readonly only. Tokens encrypted at rest; every sync logged; one-click revocation purges tokens and ingested metadata.
          </p>
        </section>

        <section className={`panel p-5 ${overrideOn ? "border-signal-amber/50" : ""}`}>
          <h2 className="microlabel mb-2 text-signal-amber">owner dev override — maturity gates</h2>
          <p className="text-[12px] leading-relaxed text-dim-400">
            Unlocks the P1 distribution surfaces for validation without the gates being met. It never
            fabricates gate completion, it is visibly labeled everywhere it takes effect, and every
            change is logged. Leave off in normal use.
          </p>
          <div className="mt-3 flex items-center gap-3">
            <span className={`font-mono text-[11px] uppercase ${overrideOn ? "text-signal-amber" : "text-dim-500"}`}>
              {overrideOn ? "active" : "off"}
            </span>
            <button
              className="btn"
              onClick={async () => {
                const reason = window.prompt(overrideOn ? "Reason for disabling (logged):" : "Reason for enabling (logged):");
                if (reason === null) return;
                try {
                  await setOverride(db, "maturity_dev_override", !overrideOn, reason);
                } catch (e) {
                  window.alert(e instanceof Error ? e.message : "override change failed");
                }
                bump();
              }}
            >
              {overrideOn ? "Disable" : "Enable"} override
            </button>
          </div>
          {(data?.overrides ?? []).length > 0 && (
            <ul className="mt-3 space-y-0.5 font-mono text-[10px] text-dim-500">
              {(data?.overrides ?? []).slice(0, 5).map((o) => (
                <li key={o.id}>{o.created_at.slice(0, 16).replace("T", " ")} · {o.override_key} → {o.enabled_bool ? "on" : "off"} · {o.reason}</li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel p-5">
          <h2 className="microlabel mb-3">privacy &amp; row-level security</h2>
          <div className="space-y-3 text-[12px] leading-relaxed text-dim-400">
            <p>
              This is a single-user system. Every row carries your user id, and the database enforces —
              through Row Level Security and same-user relational constraints, not application code —
              that only your authenticated session can read, write, or archive your rows.
            </p>
            <p>
              Privacy classes: <span className="font-mono text-signal-green">PUBLIC_SAFE</span> may reach
              external assets; <span className="font-mono text-signal-amber">INTERNAL_ONLY</span> is for
              personal prep and never enters external assets;{" "}
              <span className="font-mono text-signal-red">PRIVATE</span> never leaves the vault and never
              reaches an AI model — approved sanitized claims are the only bridge outward.
            </p>
            <p>
              Account bootstrap: sign-ups are closed in the product. Create the owner account from the
              Supabase dashboard (Authentication → Users → Add user), then sign in here. Disable public
              sign-ups under Authentication → Sign In / Up.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
