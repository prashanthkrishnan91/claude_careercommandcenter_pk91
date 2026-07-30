import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Real Google OAuth ingestion (P1, v2 §8): gmail.readonly / calendar.readonly
// only, refresh tokens encrypted at rest, one-click revocation, idempotent
// syncs. Configuration comes exclusively from the environment; when absent,
// the surface reports an honest unavailable state.

export function googleConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET &&
      process.env.CCC_TOKEN_ENCRYPTION_KEY,
  );
}

export const GOOGLE_SCOPES: Record<"gmail" | "calendar", string> = {
  gmail: "https://www.googleapis.com/auth/gmail.readonly",
  calendar: "https://www.googleapis.com/auth/calendar.readonly",
};

function encryptionKey(): Buffer {
  const hex = process.env.CCC_TOKEN_ENCRYPTION_KEY ?? "";
  const key = Buffer.from(hex, "hex");
  if (key.length !== 32) throw new Error("CCC_TOKEN_ENCRYPTION_KEY must be 32 bytes of hex");
  return key;
}

export function encryptToken(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv.toString("base64"), enc.toString("base64"), cipher.getAuthTag().toString("base64")].join(".");
}

export function decryptToken(stored: string): string {
  const [iv, data, tag] = stored.split(".").map((p) => Buffer.from(p, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

export function authUrl(provider: "gmail" | "calendar", redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: redirectUri,
    response_type: "code",
    scope: `${GOOGLE_SCOPES[provider]} email`,
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeCode(code: string, redirectUri: string) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status}`);
  return (await res.json()) as { access_token: string; refresh_token?: string; id_token?: string };
}

export async function refreshAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`token refresh failed: ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

export async function revokeGoogleToken(refreshToken: string): Promise<void> {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`, {
    method: "POST",
  });
}

export interface IngestCandidate {
  external_id: string;
  kind: "job_alert" | "profile_views" | "connection_request" | "recruiter_inmail" | "calendar_event" | "other";
  summary: string;
  occurred_at: string | null;
}

function classifyGmail(subject: string, from: string): IngestCandidate["kind"] {
  const s = subject.toLowerCase();
  if (!from.toLowerCase().includes("linkedin")) return "other";
  if (s.includes("job alert") || s.includes("jobs for you")) return "job_alert";
  if (s.includes("viewed your profile")) return "profile_views";
  if (s.includes("invitation") || s.includes("connect")) return "connection_request";
  if (s.includes("inmail") || s.includes("message from")) return "recruiter_inmail";
  return "other";
}

/** Gmail metadata sweep: subjects/dates only — message bodies are not stored. */
export async function fetchGmailCandidates(accessToken: string): Promise<IngestCandidate[]> {
  const listRes = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages?q=from:linkedin.com newer_than:30d&maxResults=25",
    { headers: { authorization: `Bearer ${accessToken}` } },
  );
  if (!listRes.ok) throw new Error(`gmail list failed: ${listRes.status}`);
  const list = (await listRes.json()) as { messages?: Array<{ id: string }> };
  const out: IngestCandidate[] = [];
  for (const m of list.messages ?? []) {
    const msgRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
      { headers: { authorization: `Bearer ${accessToken}` } },
    );
    if (!msgRes.ok) continue;
    const msg = (await msgRes.json()) as {
      id: string;
      payload?: { headers?: Array<{ name: string; value: string }> };
    };
    const header = (n: string) => msg.payload?.headers?.find((h) => h.name === n)?.value ?? "";
    out.push({
      external_id: `gmail:${msg.id}`,
      kind: classifyGmail(header("Subject"), header("From")),
      summary: header("Subject"),
      occurred_at: header("Date") ? new Date(header("Date")).toISOString() : null,
    });
  }
  return out;
}

/** Calendar sweep: upcoming events flagged as possible interviews (read-only). */
export async function fetchCalendarCandidates(accessToken: string): Promise<IngestCandidate[]> {
  const now = new Date().toISOString();
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(now)}&maxResults=25&singleEvents=true&orderBy=startTime`,
    { headers: { authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) throw new Error(`calendar list failed: ${res.status}`);
  const json = (await res.json()) as {
    items?: Array<{ id: string; summary?: string; start?: { dateTime?: string; date?: string } }>;
  };
  return (json.items ?? []).map((e) => ({
    external_id: `gcal:${e.id}`,
    kind: "calendar_event" as const,
    summary: e.summary ?? "(untitled event)",
    occurred_at: e.start?.dateTime ?? (e.start?.date ? `${e.start.date}T00:00:00Z` : null),
  }));
}
