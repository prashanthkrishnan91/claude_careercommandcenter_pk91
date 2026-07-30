// Supabase connection values. Both are publishable-by-design (they ship in the
// browser bundle; Row Level Security is what protects the data), so they are
// checked in as fallbacks to keep the browser-based deploy workflow zero-config.
// Environment variables take precedence when set.
export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://loejfyzocsuzzmifxxhw.supabase.co";

export const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "sb_publishable_FlnSD3icCQdrtIBIcjaaqA_QXgYJgvn";
