# Empire Categoriser – deploy on Vercel (files stored once, shared by the whole team)

What you get: the same SOP v1.4 app, but hosted at your own web address. The Vendor Master, Chart of
Accounts, Class list, Jonathan's email rules, bank rules, payroll Excel and the new-vendor log are
saved **once** in a database and every team member sees them. Bank-feed CSVs are never stored –
each session still starts with a fresh upload. New vendors confirmed by the team are added to the
shared Vendor Master automatically.

## Deploy (about 10 minutes, free)

1. Put this folder in a **private** GitHub repository (or run `npx vercel` inside this folder).
2. vercel.com → **Add New → Project** → import the repo → Deploy (no build settings needed).
3. In the project: **Storage → Create / Connect Database → Upstash Redis (free)** → connect it to the project.
   This adds the `KV_REST_API_URL` / `KV_REST_API_TOKEN` variables automatically.
4. **Settings → Environment Variables** → add `APP_PASSWORD` = a password for your team.
5. **Deployments → ⋯ → Redeploy** (so the new variables are picked up).
6. Open the site, type the password (asked once per browser), go to **Data & rules**, and upload the
   Vendor Master, Account List, Class List (and payroll Excel when you have it) **once**.
   Everyone else just opens the link and enters the password.

The A/P Aging report is per day: upload it each morning; it is shared with the team and clears next day.

## Good to know
- Wrong/missing setup shows a clear message (e.g. "APP_PASSWORD is not set", "Database is not connected").
- Do not commit passwords; they live only in Vercel environment variables.
- Local test: `APP_PASSWORD=x ALLOW_MEMORY_STORE=1 node dev-server.js 3000` (memory store, test only).
- Files: `public/index.html` (the app), `api/db.js` (storage API), `vercel.json`.
