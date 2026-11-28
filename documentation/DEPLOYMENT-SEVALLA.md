# Deploying CinCin on Sevalla

How the three repos map onto Sevalla, and how to move from the current Vercel + Railway setup without losing data, with a way back at every step.

| Domain | Repo | Sevalla service | Hosted on today |
|---|---|---|---|
| `playcincin.com`, `www.playcincin.com` | `cincin_www` | Static site (no build) | Vercel |
| `app.playcincin.com` | `cincin_frontend` | Static site (Vite build) | Vercel |
| `api.playcincin.com` | `cincin_backend` | Application (Dockerfile) | Railway |
| — | — | PostgreSQL database | Railway |
| — | — | Redis (optional) | Railway, if `REDIS_URL` is set there |

DNS stays on Cloudflare. Nothing changes for players until the DNS records are switched (step 7), so steps 1–6 can be done at any time.

**Where configuration lives:** this runbook covers how to host on Sevalla. The [production configuration checklist](https://github.com/miczagami/cincin_frontend/blob/claude/sharp-gauss-5tdzpq/research/production-config-checklist.md) covers what each feature needs in production: every variable, provider dashboard, webhook and non-Sevalla DNS record, and how to check each one. Update that link when the checklist moves out of `research/`.

---

## 0. Before you start

- **The production configuration checklist is complete**, and every value in it is to hand. Don't copy Railway's or Vercel's variables wholesale (see step 2.4).
- **Get the database's public URL:** Railway → Postgres service → **Variables** → `DATABASE_PUBLIC_URL`. You need it for the data copy.
- **Note the Postgres major version:** run `SELECT version();` against Railway's database, and create the same major version on Sevalla. Install `pg_dump`, `pg_restore` and `psql` at least as new as that version.
- **Region: Sydney (`australia-southeast1`)** for both the API and the database. Players are in Australia, and Sevalla's internal connections only work within one region.
- **Record the DNS zone:** Cloudflare → `playcincin.com` → **DNS** → **Records** → **Export**, and keep the file. Rolling back needs the old records' full values, and steps 7 and 8 delete them.
- **Check for CAA records:** Cloudflare → DNS, filter by type CAA. If there are any, add `CAA 0 issue "pki.goog"`, or Sevalla's certificates aren't issued and its domains stay in Verification. If there are none, there's nothing to do.

## 1. Database

1. Sevalla → **Databases** → **Add database**:
   - Type: **PostgreSQL**, same major version as Railway.
   - Location: Sydney.
   - Name: `cincin-db`.
   - Keep **External backups** on. That gives the database a backup target: a Sevalla bucket with a daily dump kept 7 days.
2. **Check the backups:** `cincin-db` → **External backups**. There must be at least one **backup target**. A database with external backups and no target has no backups you can restore. Change the target's retention if 7 days is too short.
3. *(Optional)* Add a **Redis** database the same way, but only if Railway has `REDIS_URL` set. The API runs without Redis.

## 2. API (`cincin_backend`)

1. Sevalla → **Applications** → **Add application**:
   - Source: GitHub repo `miczagami/cincin_backend`, branch `main`.
   - **Automatic deployment on commit: off.** Every deployment replaces the only API instance. That drops every multi-device game in progress, because game rooms and reconnect timers live in the process (see "Why one instance"). Deploy by hand at a quiet hour for Australia instead (step 9).
   - Location: Sydney, the same as the database.
   - A small pod is fine to start with.
2. **Settings → Build strategy → Dockerfile.** Use path `Dockerfile` and context `.`. The image runs `node src/server.js` and listens on the `PORT` Sevalla provides.
3. **Networking → Connected services → Add internal connection:**
   - Select `cincin-db` and turn on **Add environment variables to the application**.
   - In the same sheet, **rename the key `DB_URL` to `DATABASE_URL`**, and keep it **available during runtime**. It holds the internal connection URL, with the password already percent-encoded. Delete the other `DB_*` rows, which the API doesn't read.
   - The database isn't reachable during the image build, so the API needs the variable at runtime only. The pre-deploy job and the web process both read it.
   - If you added Redis, connect it the same way and rename `REDIS_URL`'s key if needed (it is already `REDIS_URL`).
   - The variables are copies. If you ever change the database password, update `DATABASE_URL` on the application and redeploy.
4. **Environment variables** (runtime). Set every variable the checklist marks **[App env]**, from the values you gathered, not from Railway. Railway's raw variables include its own `DATABASE_URL`, `REDIS_URL`, `PORT` and `RAILWAY_*`, which would override or clash with Sevalla's. They also include retired `getcincin.com` values. These depend on the hosting, so check them here:

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | From the internal connection (step 2.3). Never Railway's. |
   | `JWT_SECRET` | **Same value as on Railway.** A new value logs everyone out. |
   | `CORS_ORIGIN` | `https://app.playcincin.com` |
   | `APP_URL` | `https://app.playcincin.com` |
   | `CLIENT_IP_HEADER` | `cf-connecting-ip` |

   Leave these out:
   - `PORT`: Sevalla sets it.
   - `NODE_ENV`: the image sets `production`.

   Value formats ([Sevalla: environment variables](https://docs.sevalla.com/applications/environment-variables)):
   - **Commas, quotes, backslashes and `$` reach the API unchanged at runtime**, so don't escape them. `GOOGLE_CLIENT_IDS`, `APPLE_CLIENT_IDS` and `CORS_ORIGIN` are comma-separated lists, and need no other delimiter. Check them after the first deploy anyway (step 2.6).
   - **Don't write `$(NAME)` in a value:** the container runtime can replace it with the variable `NAME`.
   - **`FIREBASE_SERVICE_ACCOUNT`:** paste the service-account JSON **base64-encoded** (`base64 -w0 service-account.json`). The API accepts JSON, base64 JSON, or a file path.
   - **`APNS_KEY_PATH`:** can hold the `.p8` key contents instead of a path.

   Email sender: with `EMAIL_FROM_ADDRESS` unset, mail goes out from `noreply@playcincin.com`. SendGrid rejects a sender whose domain isn't authenticated, and the API only logs it: a password-reset request still tells the player a link was sent. Before the API runs on that sender, authenticate `playcincin.com` in SendGrid, as the checklist describes, and send one test email.
5. **Processes:**
   - **Web process:**
     - Instances: **1** (see "Why one instance" below).
     - Readiness probe: path `/health`, port `8080`. It queries the database, so a wrong `DATABASE_URL` keeps the new version from going live.
     - Liveness probe: path `/health/live`, port `8080`. It never touches the database. Pointing liveness at `/health` would restart the API (dropping every live game, see "Why one instance") whenever the database is slow or briefly down, and a restart can't fix that.
     - Start command: leave blank to use the Dockerfile's.
   - **Add process → Job**, start policy **Before deployment**, command:
     ```
     npx prisma migrate deploy
     ```
     This applies database migrations before each new version goes live, as Railway's release step would. The job must finish in about 5 minutes, or the deployment fails and the old version keeps running.
6. **Deploy.** Then:
   - Check `https://<your-app>.sevalla.app/health` returns `{"status":"ok","database":"connected",...}`. A **503** with `"database":"unreachable"` means the API can't query the database (check `DATABASE_URL`); the API log line starting `[health]` says why.
   - Check the job's log shows "migrations applied", or "No pending migrations".
   - Open the application's **Web terminal** and run `printenv GOOGLE_CLIENT_IDS APPLE_CLIENT_IDS CORS_ORIGIN`. Each should print with its commas, exactly as you entered it.
7. **Add the `api.playcincin.com` domain now** (application → **Domains** → **Add domain**), and add only its `_acme-challenge` record in Cloudflare (DNS only). The CNAME has to wait for the cutover, because Railway's record still holds that name. With the challenge record already in place, the cutover only waits for the CNAME.

## 3. App (`cincin_frontend`)

1. Sevalla → **Static sites** → **Add static site**:
   - Repo `miczagami/cincin_frontend`, branch `main`.
   - Auto-deploy on. A static site deploys without downtime.
2. Build settings:
   - Build command: `npm run build`.
   - Node version: `22`.
   - Publish directory: `dist`.
   - Leave **Error file** empty. The SPA fallback comes from `public/_redirects` (step 3.4).
3. **Environment variables** (build-time; Vite bakes them into the bundle): every variable the checklist marks **[Build var]**. The hosting-dependent ones are:
   - `VITE_API_URL=https://api.playcincin.com`
   - `VITE_WS_URL=https://api.playcincin.com`
4. Deploy. Then:
   - The deployment log shows `Redirects processed successfully!` and `Headers processed successfully!`. If it says `There were errors while parsing`, the site went out without any of that file's rules: fix the file and deploy again.
   - Open a deep link on the Sevalla preview URL (for example `https://<site>.sevalla.page/profile`) and reload it. It should load the app, through `public/_redirects`.
   - `curl -sI https://<site>.sevalla.page/profile` shows `content-security-policy-report-only` (cincin_frontend `documentation/CONTENT-SECURITY-POLICY.md`).

> Sevalla's edge keeps the site's files until the next deployment, and HTML is sent with `max-age=0`. So a deployment replaces `index.html` for every player at once, with no rule needed in `_headers`. Hashed assets are cached for a year, and the service worker and manifest are always re-checked (`public/_headers`).

On the preview URL the app calls `api.playcincin.com`, which is still Railway until step 7. To try the app against the new API, do the rehearsal (step 5).

## 4. Marketing site (`cincin_www`)

`cincin_www` serves only its `public/` folder, and Sevalla becomes its only host. Before merging the change that moved the site into `public/` (or any later change to that layout):
- **Vercel:** disconnect the `cincin_www` project from Git (Project → Settings → Git → Disconnect), so a merge can't redeploy it with an old output setting. Its last deployment keeps serving the domains until the DNS switch in step 7, and the project is deleted in step 10. Until then the live site is frozen on that deployment: merged changes don't go live, and files it published from the old root layout stay reachable.
- **Sevalla**, if the static site already exists: set the publish directory below and clear **Error file** first, because the merge auto-deploys.

Sevalla → **Static sites** → **Add static site**:
- Repo `miczagami/cincin_www`, branch `main`.
- Auto-deploy on.
- **No build command.**
- Publish directory: `public`. Don't leave it blank: blank publishes the repo root, files that must stay private included (see the `cincin_www` README).
- Leave **Error file** empty, so unknown paths return a real 404. (Only the app needs `index.html` there.)
- `public/_redirects` sends `www.playcincin.com/<path>` to `playcincin.com/<path>` with a 301. It works once both domains are added to this static site (step 7).

## 5. Rehearse the API move (before the cutover window)

A full run against the Sevalla API, with Railway untouched, so the cutover only repeats steps that already worked once.

1. **Dump Railway without stopping it:**
   ```bash
   pg_dump -Fc --no-owner --no-acl "$RAILWAY_DATABASE_PUBLIC_URL" -f rehearsal.dump
   ```
2. **Restore it into `cincin-db`** the way step 6 does: steps 6.3 to 6.5, but with `rehearsal.dump`. Note how long the dump and restore take, which decides the cutover window.
3. **Point the API at a preview app:** set `CORS_ORIGIN=https://app.playcincin.com,https://<site>.sevalla.page` on the Sevalla application, and deploy it.
4. **Build a preview of the app against it:** on the app's static site, set `VITE_API_URL` and `VITE_WS_URL` to `https://<your-app>.sevalla.app`, and deploy.
5. **Run the step-7 API checks** against the preview app and `https://<your-app>.sevalla.app`:
   - log in,
   - a multi-device game,
   - a label scan,
   - a test webhook,
   - sign in with Google and with Apple. This also checks the comma-separated client IDs.
6. **Put it back:** reset `CORS_ORIGIN` to `https://app.playcincin.com`, set the app's `VITE_API_URL` and `VITE_WS_URL` back to `https://api.playcincin.com`, and deploy both. The rehearsal data in `cincin-db` is replaced at the cutover.

## 6. Copy the data from Railway (cutover window)

Do this immediately before switching `api.playcincin.com` (step 7, row c). The API is unavailable from here until its new DNS record is live. Allow the dump and restore time you measured in step 5, plus 5–10 minutes for DNS.

**Go/no-go:** if `api.playcincin.com` isn't **Active** on Sevalla, with a certificate, 30 minutes after step 6.1, roll back (see "Rolling back").

1. **Stop writes on Railway.** Railway → API service → remove the active deployment (or set replicas to 0).
2. **Dump the database:**
   ```bash
   pg_dump -Fc --no-owner --no-acl "$RAILWAY_DATABASE_PUBLIC_URL" -f cincin.dump
   ```
   Keep `cincin.dump` until Railway is deleted in step 10.
3. **Open the Sevalla database to your machine:** `cincin-db` → **Networking** → enable the external connection, allowlisting your IP. Copy the **external** connection URL from the database's Overview page.
4. **Empty the schema.** The step-2 deploy (and the rehearsal) already created tables and migration history in `cincin-db`. Restoring over them can leave Prisma's migration history out of step with the tables, and the next deploy then fails on "already exists". So restore into an empty schema:
   ```bash
   psql "$SEVALLA_EXTERNAL_URL" -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
   ```
   If that fails because the Sevalla database user doesn't own `public`, run `psql "$SEVALLA_EXTERNAL_URL" -c 'DROP OWNED BY CURRENT_USER CASCADE;'` instead.
5. **Restore, all or nothing:**
   ```bash
   pg_restore --no-owner --no-acl --single-transaction -d "$SEVALLA_EXTERNAL_URL" cincin.dump
   ```
6. **Compare the two databases.** These should match between Railway (`$RAILWAY_DATABASE_PUBLIC_URL`) and Sevalla (`$SEVALLA_EXTERNAL_URL`):
   ```bash
   psql "$DB" -c 'SELECT migration_name FROM _prisma_migrations ORDER BY 1;'
   psql "$DB" -c 'SELECT (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM users WHERE "subscriptionId" IS NOT NULL) AS subscribers, (SELECT count(*) FROM games) AS games, (SELECT count(*) FROM guesses) AS guesses, (SELECT count(*) FROM cellar_clubs) AS clubs;'
   ```
7. **Turn the external connection off again.**
8. **Redeploy the API on Sevalla.** The pre-deploy job applies any migrations Railway hadn't run yet.
9. **Take a manual backup:** `cincin-db` → **External backups** → under the target, **Create backup**, with the note "After the Railway restore".

## 7. Switch DNS in Cloudflare

Switch the stateless sites first: they are quick to reverse, and they run through Cloudflare's and Sevalla's verification before the API's cutover depends on it. Do rows a and b at any time after steps 3 and 4. Do row c in the cutover window, right after step 6.

For each domain, start in Sevalla (application or static site → **Domains** → **Add domain**). Sevalla then shows the exact records to create. With Cloudflare's nameservers, the pointing CNAME also verifies the domain, and the `_acme-challenge` record renews its certificate. In Cloudflare:
- **Delete the old record first.** Sevalla won't verify while it exists.
- Add Sevalla's records.
- Keep every record **DNS only (grey cloud).** A proxied record hides its target until the domain is Active, so it can't verify. Staying grey after that keeps a single cache and keeps `CLIENT_IP_HEADER` simple.

| Order | Host | Delete in Cloudflare (full old values are in the zone export) | Add to Sevalla |
|---|---|---|---|
| a | `app` | `CNAME → …vercel-dns-017.com` | the app static site |
| b | `@` (apex), then `www` | `A → 216.198.79.1`; `CNAME → …vercel-dns-017.com` | the marketing static site (both domains) |
| c | `api` | `CNAME → 8dq2a2f8.up.railway.app` and TXT `_railway-verify.api` | the API application (its `_acme-challenge` is already in place from step 2.7) |

Sevalla issues SSL certificates automatically once a domain verifies. Keep the `_acme-challenge` record: renewals need it.

Checks after each switch:
- **app:** load, sign in, reload on a deep link, and check the CSP header (step 3.4) on `https://app.playcincin.com/profile`.
- **apex/www:**
  - The apex loads the marketing page, and the "Get started" links reach the app.
  - `curl -sI https://www.playcincin.com/robots.txt` returns `301` with `location: https://playcincin.com/robots.txt`.
  - `curl -sI https://playcincin.com/README.md`, `/CLAUDE.md` and `/docs/agents/domain.md` each return `404`.
- **api:**
  - `curl https://api.playcincin.com/health` returns ok (status 200, `"database":"connected"`).
  - Log in on the app.
  - Start a multi-device game. In DevTools → Network, the `socket.io` request should upgrade (status **101**).
  - **Webhooks:** run `stripe trigger payment_intent.succeeded` with the Stripe CLI, or resend a recent event from the endpoint's delivery list (Stripe → Developers → Webhooks → your endpoint), and confirm it returns 2xx. In Onfido's webhook log, resend anything that failed during the outage.
  - **Per-visitor rate limits (`CLIENT_IP_HEADER`):** request `https://api.playcincin.com/api/scan/taxonomy` from two different networks, for example Wi-Fi and phone data, and compare the `RateLimit-Remaining` response headers. Each network should count down on its own. If they share one count, the header isn't reaching the API, and every player shares one limit of 100 requests per 15 minutes.
  - Then work through the checklist's per-feature checks: push, the email sender, the Onfido webhook and the Stripe live webhook.

Webhook URLs (Stripe, Onfido), Google/Apple sign-in origins and email links don't change, because the domains stay the same.

## 8. Rolling back

Until step 10, the old platforms stay as they are: both Vercel projects with their domains attached, the Railway API service, and Railway's Postgres. Recreate any record from the zone export (step 0).

**Point of no return:** 24 hours after a clean API cutover. After that, fix forward on Sevalla.

- **The app or the marketing site fails after its DNS switch** (rows a–b, any time before step 10): in Cloudflare, delete Sevalla's pointing record and recreate the Vercel record. Vercel serves again once DNS propagates. Sevalla's `_acme-challenge` record can stay.
- **The API fails before any player's writes reach Sevalla** (row c, before the go/no-go time): recreate Railway's CNAME and its `_railway-verify.api` TXT record, then restart the Railway deployment. No data is lost, because the cutover only read Railway's database.
- **The API fails after Sevalla has taken writes:**
  1. Stop the Sevalla web process (set its instances to 0), so nothing else is written.
  2. Dump Sevalla over its external connection: `pg_dump -Fc --no-owner --no-acl "$SEVALLA_EXTERNAL_URL" -f sevalla.dump`.
  3. Restore it into Railway the step-6 way: empty Railway's `public` schema, then `pg_restore --single-transaction`.
  4. Restart the Railway deployment and recreate Railway's DNS records.
- **A bad deployment later on Sevalla:**
  - **Rollback** (application → **Deployments** → ⋯ on the deployment before the live one → **Roll back**) puts the previous image back without building it. It keeps the current environment variables.
  - A failed pre-deploy job already leaves the old version running.
  - Migrations only go forward: rolling the code back past a migration needs the old code to work with the new schema. If it doesn't, restore the backup taken before that deployment (step 9).
- **A static site:** redeploy its previous deployment from its **Deployments** tab, or revert the commit.

## 9. Deploying the API later

Deployments are by hand (step 2.1), because each one drops live multi-device games.

1. Deploy at a quiet hour in Australia.
2. If the deployment adds a migration, first take a manual backup of `cincin-db` (step 6.9), with a note naming it.

Scheduled jobs (weekly standings, season reminders, monthly wrapped) run in **UTC**. The cron schedules in `src/jobs/cronScheduler.js` have no time zone, and the image sets no `TZ`. That matches Railway, so the move changes nothing: "Mondays 09:00" goes out at 19:00 or 20:00 in Sydney. Changing that is cincin_frontend#25.

## 10. Clean up (after a week of quiet)

- **Railway:** take a final dump, then delete the API service and the Postgres database. Delete `cincin.dump` and `rehearsal.dump` once that final dump is stored safely.
- **Cloudflare:** delete any Vercel or Railway verification TXT records still in the zone, such as `_vercel` records.
- **Vercel:** before deleting the projects, check which domains each one has. If `getcincin.com` is on either, decide first what happens to it (cincin_frontend#27): it goes dark when the project is deleted. Then delete both projects.
- **`cincin_www`:** remove the README's "Moving off Vercel" section.
- **`cincin_frontend`:** delete `vercel.json`, and its mention in `documentation/LANDING-PAGE-INTEGRATION-GUIDE.md`. Sevalla doesn't use it.

---

## Why one instance

Keep the API's web process at **one instance** (scale up the pod size instead of the count) until this changes:

- **Live game state is held in memory.** Socket.io game rooms and the 2-minute reconnect timers live in the API process. With two instances, players in the same game could land on different instances and stop seeing each other.
- **Scheduled jobs run in-process.** They would run once per instance, sending duplicate emails and notifications.

Scaling out later needs three changes:
- the Socket.io Redis adapter,
- moving room state into Redis,
- moving the scheduled jobs into a Sevalla **Cron job** process, with `CRON_ENABLED=false` on the web process.

The same Redis work would let deployments stop dropping live games (step 9).

## What changed in the code for Sevalla

- **`Dockerfile` / `.dockerignore`:**
  - Builds a production image: Node 22, OpenSSL for Prisma, Prisma client generated at build time.
  - The same image runs the pre-deploy migration job.
- **`prisma` CLI moved to `dependencies`,** so `prisma migrate deploy` is available in the production image.
- **`CLIENT_IP_HEADER`:**
  - **Problem:** behind Sevalla's proxy every request reaches the API from the proxy's address. The per-IP rate limits (100 requests and 20 auth attempts per 15 minutes) were therefore shared by *all* users.
  - **Fix:** setting `CLIENT_IP_HEADER=cf-connecting-ip` keys the limits on each visitor's real IP.
- **`FIREBASE_SERVICE_ACCOUNT`** also accepts base64-encoded JSON.
- **`cincin_frontend/public/_redirects` and `public/_headers`:** SPA fallback, cache headers and (added at build time) the report-only Content-Security-Policy for Sevalla static sites. These replace what `vercel.json` did on Vercel.

## The runbook review, item by item

Every item from the [runbook review](https://github.com/miczagami/cincin_frontend/blob/claude/sharp-gauss-5tdzpq/research/sevalla-runbook-review.md) (cincin_frontend#10), and where it is handled:

| Item | Where |
|---|---|
| W1 restore over a migrated database | Step 6.4–6.6: empty schema, `--single-transaction`, then compare migrations and row counts. |
| W2 `DATABASE_URL` from names Sevalla doesn't create | Step 2.3: rename `DB_URL` to `DATABASE_URL` in the connection sheet. |
| W3 "copy everything else from Railway" | Step 2.4: set the checklist's [App env] variables, never Railway's raw list. |
| W4 commas in `GOOGLE_CLIENT_IDS` / `APPLE_CLIENT_IDS` | Checked: Sevalla passes commas literally at runtime, so no code change is needed. Step 2.4 says so, step 2.6 prints the values, and step 5 signs in with Google and Apple. |
| W5 the API down before its domain can verify | Step 2.7 adds the domain and its `_acme-challenge` early; step 7 switches the app and the marketing site first; step 6 sets a go/no-go time. |
| W6 elided DNS targets | Step 0 exports the zone; step 8 restores records from it. |
| W7 Stripe's "Send test event" | Step 7: `stripe trigger` or resend a real event, and check Onfido's webhook log. |
| G1 no rehearsal of the new API | Step 5. |
| G2 no backups | Step 1.2 checks the backup target; steps 6.9 and 9 take manual backups; step 6.2 keeps the dump. |
| G3 auto-deploy drops live games | Step 2.1 turns it off; step 9 deploys by hand at quiet hours. |
| G4 `CLIENT_IP_HEADER` not verified | Step 7, API checks. |
| G5 cron runs in UTC | Step 9 says it's intended for now, and links cincin_frontend#25. |
| G6 no `www` → apex redirect | Already handled by `cincin_www/public/_redirects` (step 4); checked in step 7. |
| G7 `cincin_www` publishes the whole repo | Already handled: the site publishes `public/` (step 4); checked in step 7. |
| G8 `index.html` has no cache rule | Checked, not needed: Sevalla sends HTML with `max-age=0` and its edge drops cached files at each deployment (note under step 3). |
| G9 `getcincin.com` and other leftovers | Step 10: check the Vercel projects' domains first (cincin_frontend#27), remove leftover verification records, and drop `vercel.json` with its mention in the integration guide. |
| G10 CAA records | Step 0. |
