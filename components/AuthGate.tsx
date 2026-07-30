"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";

// Client-side session guard: everything under (app) requires a signed-in
// user. RLS is the real enforcement; this is the UX layer.
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<"loading" | "authed" | "anon">("loading");

  useEffect(() => {
    const db = getSupabase();
    db.auth.getSession().then(({ data }) => {
      setState(data.session ? "authed" : "anon");
    });
    const { data: sub } = db.auth.onAuthStateChange((_event, session) => {
      setState(session ? "authed" : "anon");
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (state === "anon") router.replace("/login");
  }, [state, router]);

  if (state !== "authed") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <span className="microlabel animate-pulse">checking credentials…</span>
      </div>
    );
  }
  return <>{children}</>;
}
