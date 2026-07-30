"use client";

import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useShell } from "@/components/ShellContext";
import { getSupabase } from "./supabase";

// Loads vault data and reloads whenever the shell's data version bumps
// (i.e. after any create/edit/delete anywhere in the app).
export function useVaultData<T>(loader: (db: SupabaseClient) => Promise<T>) {
  const { version } = useShell();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    let cancelled = false;
    setError(null);
    loader(getSupabase())
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Load failed");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loader]);

  useEffect(() => reload(), [reload, version]);

  return { data, loading, error };
}
