"use client";

import { getSupabase } from "./supabase";

// Client → server route calls, authenticated with the user's Supabase session
// token. Server routes re-bind the token so RLS still governs every query.
export async function postApi<T>(path: string, body: unknown): Promise<{ status: number; json: T }> {
  const { data } = await getSupabase().auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as T };
}
