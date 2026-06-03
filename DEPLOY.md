# Hagerstone Facade System — Deployment & SSO Guide (Phase 9)

The app is **build-ready**. This guide covers local testing, Vercel deployment, and
wiring the facade URL into the hub portal for SSO. Nothing here has been executed
against production yet — run it when you're ready.

---

## 1. Local testing (do this first)

```powershell
cd d:\hs\facade
npm install        # already done
npm run dev        # serves http://localhost:5173
```

Open **http://localhost:5173** and sign in.

- **Email/password** (most reliable locally): use a hub account that has facade access —
  `admin@hagerstone.com`, `world@hagerstone.com` (founder), `projects@hagerstone.com`
  (management), or `ai@hagerstone.com` (granted explicitly).
- **Google sign-in** redirects to `http://localhost:5173/auth/callback`. For this to work,
  add that URL to **Supabase → Authentication → URL Configuration → Redirect URLs**
  (see §3). Email/password needs no extra config.

What to verify:
- Dashboard → **Rate Calculator** → open any system → live build-up; **Verification** page shows all 6 systems within ₹1.
- **Projects** → create a project → estimate with 2 systems → Generate quotation → Export PDF.
- Approve the quotation → **Execution stages** appear → start/complete a stage.
- (Optional) **AI take-off** in the estimate editor: upload an elevation PDF.

> Note: every signed-in user must be an **active hub employee whose role includes the
> `facade` module** (admin / ai / founder / management / project_manager), or have an
> explicit `employee_module_access` grant. This was set up in Phase 1b.

---

## 2. Deploy to Vercel

Same stack/flow as cps. From the repo root:

```powershell
cd d:\hs\facade
npm i -g vercel          # if not installed
vercel                   # first run: link/create the project
vercel --prod            # production deploy
```

`vercel.json` already rewrites all routes to `/index.html` (SPA).

### Environment variables (Vercel → Project → Settings → Environment Variables)
Set these for **Production** (and Preview). Values match cps / the Hub Project:

| Key | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://tpfvnerrjhqwipyonngf.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | (the Hub Project anon key — same as cps `.env`) |
| `VITE_GOOGLE_CLIENT_ID` | `295040883412-…apps.googleusercontent.com` (same as cps) |

> **Redeploy after changing env vars** — Vite inlines them at build time.

No server secrets in the frontend. The Anthropic key lives only in the Hub Project's
`claude-proxy` edge function (already deployed; reused by facade).

---

## 3. Supabase Auth — allow the facade origin (SSO)

In **Supabase → Authentication → URL Configuration**, add the facade origin so OAuth
and token-handoff redirects are accepted:

- **Redirect URLs** — add:
  - `http://localhost:5173/auth/callback` (local)
  - `https://<your-facade-domain>.vercel.app/auth/callback` (prod)
  - `https://<your-facade-domain>.vercel.app/dashboard`
- If using a custom domain later, add it too.

The Google OAuth client (`VITE_GOOGLE_CLIENT_ID`) must also list the facade domain under
**Authorized redirect URIs** in Google Cloud Console (same client cps uses).

---

## 4. Add the facade module to the hub portal (SSO entry)

The facade module is already registered in the hub data model (Phase 1b: `facade` added
to `roles.default_modules` for admin/ai/founder/management/project_manager, plus
`employee_module_access` grants). To surface it in the **hub portal UI**, add a module
tile/link that points at the deployed facade URL — mirroring how the hub links to cps.

Typical hub module-tile shape (adjust to the hub portal's actual config):

```
{ id: "facade", label: "Facade System", url: "https://<your-facade-domain>.vercel.app", icon: "building-2" }
```

SSO model: the hub and facade share the **same Supabase project + auth**. When a
signed-in hub user opens the facade URL, the existing Supabase session is picked up by
`AuthContext` (and `/auth/callback` handles explicit token handoff if the hub passes
tokens in the URL). No separate login required.

> You said you'll handle the hub-portal wiring — these are the exact values to plug in.

---

## 5. Post-deploy smoke test

1. From the hub portal, click the **Facade System** tile → lands on the facade dashboard, already signed in (SSO).
2. Open **Verification** → all 6 systems green (within ₹1).
3. Create a test project → estimate → quotation → PDF → approve → stages.
4. Confirm a non-facade role (e.g. a plain `site_engineer` without the grant) gets the
   "No facade access" screen.

---

## Migrations applied to the Hub Project (`tpfvnerrjhqwipyonngf`)
- `facade_001_init` — schema, tables, RLS, `next_ref`, `is_facade_user`
- `facade_001b_register_module` — module registration (roles + employee_module_access)
- `facade_002_seed` — rate card, 6 systems, materials, parsed members
- `facade_003_ai_source` — AI provenance columns on `estimate_lines`

All additive, idempotent, numbered. **cps and finance schemas were never modified.**
