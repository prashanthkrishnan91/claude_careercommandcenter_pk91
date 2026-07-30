"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";

// Single-operator sign-in. There is deliberately no public account creation:
// the owner account is created once from the Supabase dashboard
// (Authentication → Users → Add user), and public sign-ups stay disabled.

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSupabase().auth.getSession().then(({ data }) => {
      if (data.session) router.replace("/home");
    });
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await getSupabase().auth.signInWithPassword({ email, password });
    setBusy(false);
    if (err) setError(err.message);
    else router.replace("/home");
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <header className="mb-8 text-center">
          <div className="microlabel mb-3">single-operator system</div>
          <h1 className="font-mono text-lg font-semibold uppercase tracking-[0.22em] text-dim-100">
            Career Command Center
          </h1>
          <p className="mt-3 text-[13px] leading-relaxed text-dim-400">
            A private career evidence engine. It stores what is true, attributable, and useful —
            and blocks everything else from reaching the outside.
          </p>
        </header>

        <form onSubmit={submit} className="panel p-5">
          <label className="field-label" htmlFor="email">Email</label>
          <input id="email" type="email" required autoComplete="email" className="field-input mb-3" value={email} onChange={(e) => setEmail(e.target.value)} />
          <label className="field-label" htmlFor="password">Password</label>
          <input id="password" type="password" required autoComplete="current-password" className="field-input mb-4" value={password} onChange={(e) => setPassword(e.target.value)} />
          {error && <p className="mb-3 border-l-2 border-signal-red pl-2 text-[12px] text-signal-red">{error}</p>}
          <button type="submit" disabled={busy} className="btn-primary w-full justify-center py-2">
            {busy ? "Checking…" : "Enter the cockpit"}
          </button>
        </form>

        <p className="mt-4 text-center font-mono text-[10px] uppercase tracking-[0.12em] text-dim-500">
          owner account is provisioned in supabase · public sign-up disabled
        </p>
      </div>
    </main>
  );
}
