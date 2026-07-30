# Deployment (browser-only workflow)

Everything needed to run is checked in; the Supabase URL and publishable key
in `lib/config.ts` are public-by-design (RLS + same-user constraints protect
the data). No CLI required at any step.

## 1. Deploy the app

1. Open <https://vercel.com/new> → Import `prashanthkrishnan91/claude_careercommandcenter_pk91`.
2. Framework auto-detects as Next.js. Deploy. (Direct MCP deploy from the build
   session was refused — the connected Vercel credential cannot create
   projects — hence this one-click import path.)

## 2. Bootstrap the owner account (single-user)

Public sign-up is not part of the product surface. In the Supabase dashboard
(project `claude_careercommandcenter_pk91` / ref `loejfyzocsuzzmifxxhw`):

1. Authentication → Users → **Add user** → your email + password (check
   "auto-confirm").
2. Authentication → Sign In / Up → disable new sign-ups.
3. Sign in at the deployed URL.

## 3. REQUIRED server secret

| Secret | Where | Why |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel → Settings → Environment Variables (Production + Preview). Copy from Supabase → Project Settings → API → `service_role` key. | Creating an asset version is a server-only operation. The low-level database functions (`ccc_commit_asset_version`, `ccc_author_manual_version`, `ccc_record_ai_audit`) are revoked from PUBLIC, `anon` and `authenticated`, so only the server — holding this key — can commit a version, and it does so together with the version's audit record in one transaction. |

Without it, `/api/ai/generate-asset` and `/api/assets/manual-version` return an
honest 503 and no version can be created. Everything else keeps working.

**Handling rules, non-negotiable:**

- Set it **only** in server environment configuration. It must never be given a
  `NEXT_PUBLIC_` name — that prefix is what makes Next.js inline a value into
  browser bundles.
- There is deliberately **no committed fallback**. The repository contains the
  publishable key (safe by design, protected by RLS) and nothing else; an unset
  service-role key makes the privileged path unavailable rather than quietly
  weak.
- Never paste it into a client component, a response body, a log line, an error
  message, a screenshot, or a commit.
- It bypasses RLS. That is why every function it reaches takes the acting user
  id **explicitly** and scopes each read and write to it: a service-role call
  still cannot touch another user's asset.
- Rotate it in the Supabase dashboard if it is ever exposed; update Vercel and
  redeploy.

## 4. Optional integrations (each requires your credentials)

| Capability | Environment variables (Vercel → Settings → Environment Variables) | Behavior when absent |
|---|---|---|
| AI (grader, JD extraction, asset generation) | `ANTHROPIC_API_KEY`, optional `ANTHROPIC_MODEL` | Calm "AI unavailable" state; manual paths still work |
| Gmail / Calendar ingestion (read-only) | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `CCC_TOKEN_ENCRYPTION_KEY` (64 hex chars) | Settings shows "not configured"; connect buttons explain |
| Supabase override (not normally needed) | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Checked-in fallbacks used |

For Google: create an OAuth client (Web) in Google Cloud Console with redirect
URI `https://<your-domain>/api/google/callback`, scopes `gmail.readonly` /
`calendar.readonly`.

## 5. CI secrets (for live/integration workflows)

GitHub → Settings → Secrets and variables → Actions:
`CCC_TEST_EMAIL_A`, `CCC_TEST_EMAIL_B`, `CCC_TEST_PASSWORD` — the two
dedicated CI accounts (rotated during this build; password supplied to you
privately, never committed). Both workflows fail closed without them.

## 5. Never

Service-role or secret keys in the repo or client (none exist here); touching
the Travel/Finance Supabase projects; LinkedIn automation of any kind.
