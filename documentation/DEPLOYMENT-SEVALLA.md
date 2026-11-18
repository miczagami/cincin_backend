# Deploying CinCin on Sevalla

How the three repos map onto Sevalla, and how to move from the current Vercel + Railway setup without losing data.

| Domain | Repo | Sevalla service | Hosted on today |
|---|---|---|---|
| `playcincin.com`, `www.playcincin.com` | `cincin_www` | Static site (no build) | Vercel |
| `app.playcincin.com` | `cincin_frontend` | Static site (Vite build) | Vercel |
| `api.playcincin.com` | `cincin_backend` | Application (Dockerfile) | Railway |
| — | — | PostgreSQL database | Railway |
| — | — | Redis (optional) | Railway, if `REDIS_URL` is set there |

DNS stays on Cloudflare. Nothing changes for users until the DNS records are switched (step 6), so steps 1–5 can be done at any time.

---

## 0. Before you start

- **Copy Railway's variables:** Railway → API service → **Variables** → **Raw Editor**, and save them somewhere safe. Most are copied across unchanged.
- **Get the database's public URL:** Railway → Postgres service → **Variables** → `DATABASE_PUBLIC_URL`. You need it for the data copy.
- **Note the Postgres major version:** run `SELECT version();` against Railway's database, and create the same major version on Sevalla.
- **Pick one Sevalla region** for both the API and the database, close to your players. Sevalla's internal connections only work within a region.

## 1. Database

1. Sevalla → **Databases** → **Add database**:
   - Type: **PostgreSQL**, same major version as Railway.
   - Region: the region you picked.
   - Name: `cincin-db`.
2. *(Optional)* Add a **Redis** database the same way, but only if Railway has `REDIS_URL` set. The API runs without Redis.

## 2. API (`cincin_backend`)

1. Sevalla → **Applications** → **Add application**:
   - Source: GitHub repo `miczagami/cincin_backend`, branch `main`.
   - Tick **Automatic deployment on commit**.
   - Same region as the database.
   - A small pod is fine to start with.
2. **Settings → Build strategy → Dockerfile.** Use path `Dockerfile` and context `.`. The image runs `node src/server.js` and listens on the `PORT` Sevalla provides.
3. **Networking → Connected services → Add internal connection:**
   - Select `cincin-db` and tick **Add environment variables to the application**.
   - Then add `DATABASE_URL`, built from the injected variables (use the key names Sevalla actually created):
     ```
     DATABASE_URL=postgresql://${DATABASE_USER}:${DATABASE_PASSWORD}@${DATABASE_HOST}:${DATABASE_PORT}/${DATABASE_NAME}
     ```
   - If the password contains `@ : / # ?`, URL-encode it.
   - If you added Redis, connect it the same way and set `REDIS_URL`.
4. **Environment variables** (runtime):

   | Variable | Value |
   |---|---|
   | `JWT_SECRET` | **Same value as on Railway.** A new value logs everyone out. |
   | `CORS_ORIGIN` | `https://app.playcincin.com` |
   | `APP_URL` | `https://app.playcincin.com` |
   | `SHARE_BASE_URL` | `https://app.playcincin.com` |
   | `API_BASE_URL` | `https://api.playcincin.com` |
   | `CLIENT_IP_HEADER` | `cf-connecting-ip` |
   | everything else | Copy from Railway: AI keys, Stripe, SendGrid, Onfido, Google/Apple client IDs, Firebase, APNs, rate limits. |

   Leave these out:
   - `PORT`: Sevalla sets it.
   - `NODE_ENV`: the image sets `production`.

   Value formats to watch:
   - **Commas:** Sevalla breaks on unescaped commas in values. `CORS_ORIGIN` is a single origin, so that's fine.
   - **`FIREBASE_SERVICE_ACCOUNT`:** paste the service-account JSON **base64-encoded** (`base64 -w0 service-account.json`). The API accepts JSON, base64 JSON, or a file path.
   - **`APNS_KEY_PATH`:** can hold the `.p8` key contents instead of a path.
5. **Processes:**
   - **Web process:**
     - Instances: **1** (see "Why one instance" below).
     - Readiness and liveness probes: path `/health`, port `8080`.
     - Start command: leave blank to use the Dockerfile's.
   - **Add process → Job**, start policy **Before deployment**, command:
     ```
     npx prisma migrate deploy
     ```
     This applies database migrations before each new version goes live, as Railway's release step would.
6. **Deploy.** Then:
   - Check `https://<your-app>.sevalla.app/health` returns `{"status":"ok",...}`.
   - Check the job's log shows "migrations applied", or "No pending migrations".

## 3. App (`cincin_frontend`)

1. Sevalla → **Static sites** → **Add static site**:
   - Repo `miczagami/cincin_frontend`, branch `main`.
   - Auto-deploy on.
2. Build settings:
   - Build command: `npm run build`. If the log shows `vite: not found`, use `npm ci && npm run build`.
   - Node version: `20`.
   - Publish directory: `dist`.
3. **Environment variables** (build-time; Vite bakes them into the bundle):
   - `VITE_API_URL=https://api.playcincin.com`
   - `VITE_WS_URL=https://api.playcincin.com`
   - every `VITE_FIREBASE_*` value from the Vercel project (Vercel → Project → Settings → Environment Variables).
4. Deploy, then open a deep link on the Sevalla preview URL (for example `https://<site>.sevalla.page/profile`) and reload it.
   - It should load the app. This works through `public/_redirects`, which ships in `dist/`.
   - If it 404s instead, set **Settings → Error file** to `index.html`.
   - Cache rules (hashed assets cached forever; service worker and manifest always re-checked) are in `public/_headers`.

> On the preview URL the app calls `api.playcincin.com`, which is still Railway until step 6. So the preview checks the static-site setup, not the new API.

## 4. Marketing site (`cincin_www`)

Sevalla → **Static sites** → **Add static site**:
- Repo `miczagami/cincin_www`, branch `main`.
- Auto-deploy on.
- **No build command.**
- Publish directory: the repo root (leave blank, or `.`).

## 5. Copy the data from Railway (cutover window)

Do this immediately before switching `api.playcincin.com` (step 6a). The API is unavailable from here until the new DNS record is live, typically 10–20 minutes. You need `pg_dump`/`pg_restore` at least as new as the Postgres server.

1. **Stop writes on Railway.** Railway → API service → remove the active deployment (or set replicas to 0).
2. **Dump the database:**
   ```bash
   pg_dump -Fc --no-owner --no-acl "$RAILWAY_DATABASE_PUBLIC_URL" -f cincin.dump
   ```
3. **Open the Sevalla database to your machine:** `cincin-db` → **Networking** → enable external connection, allowlisting your IP. Copy the **external** connection string from the database's Overview page.
4. **Restore into Sevalla.** `--clean` replaces the empty tables created by the step-2 deploy:
   ```bash
   pg_restore --clean --if-exists --no-owner --no-acl -d "$SEVALLA_EXTERNAL_URL" cincin.dump
   ```
5. **Turn the external connection off again.**
6. **Redeploy the API on Sevalla.** The pre-deploy job then applies any migrations Railway hadn't run yet.

## 6. Switch DNS in Cloudflare

For each domain, start in Sevalla (application or static site → **Domains** → **Add domain**). Sevalla then shows the exact records to create. In Cloudflare:
- **Delete the old record first.** Sevalla won't verify while it exists.
- Add Sevalla's records.
- Keep every record **DNS only (grey cloud).** Sevalla already serves through Cloudflare's network, and proxying on top of it breaks certificate renewals.

| Order | Host | Delete in Cloudflare | Add to Sevalla |
|---|---|---|---|
| a | `api` | `CNAME → 8dq2a2f8.up.railway.app` and TXT `_railway-verify.api` | the API application |
| b | `app` | `CNAME → …vercel-dns-017.com` | the app static site |
| c | `@` (apex) | `A → 216.198.79.1` | the marketing static site |
| d | `www` | `CNAME → …vercel-dns-017.com` | the marketing static site (as a second domain) |

- Sevalla issues SSL certificates automatically once a domain verifies. Keep the `_acme-challenge` record it asks for; renewals need it.
- Cloudflare's CNAME flattening lets the apex point at Sevalla's CNAME target.

Checks after each switch:
- **api:**
  - `curl https://api.playcincin.com/health` returns ok.
  - Log in on the app.
  - Start a multi-device game. In DevTools → Network, the `socket.io` request should upgrade (status **101**).
  - Send a Stripe test webhook (Stripe → Developers → Webhooks → your endpoint → Send test event) and confirm it returns 2xx.
- **app:** load, sign in, reload on a deep link.
- **apex/www:** both load the marketing page, and the "Get started" links reach the app.

Webhook URLs (Stripe, Onfido), Google/Apple sign-in origins and email links don't change, because the domains stay the same.

## 7. Clean up (after a week of quiet)

- **Railway:** delete the API service and the Postgres database (take a final dump first).
- **Vercel:** delete both projects.
- **`cincin_frontend`:** delete `vercel.json`. Sevalla doesn't use it.

---

## Why one instance

Keep the API's web process at **one instance** (scale up the pod size instead of the count) until this changes:

- **Live game state is held in memory.** Socket.io game rooms and the 2-minute reconnect timers live in the API process. With two instances, players in the same game could land on different instances and stop seeing each other.
- **Scheduled jobs run in-process.** They would run once per instance, sending duplicate emails and notifications.

Scaling out later needs three changes:
- the Socket.io Redis adapter,
- moving room state into Redis,
- moving the scheduled jobs into a Sevalla **Cron job** process, with `CRON_ENABLED=false` on the web process.

## What changed in the code for Sevalla

- **`Dockerfile` / `.dockerignore`:**
  - Builds a production image: Node 20, OpenSSL for Prisma, Prisma client generated at build time.
  - The same image runs the pre-deploy migration job.
- **`prisma` CLI moved to `dependencies`,** so `prisma migrate deploy` is available in the production image.
- **`CLIENT_IP_HEADER`:**
  - **Problem:** behind Sevalla's proxy every request reaches the API from the proxy's address. The per-IP rate limits (100 requests and 20 auth attempts per 15 minutes) were therefore shared by *all* users.
  - **Fix:** setting `CLIENT_IP_HEADER=cf-connecting-ip` keys the limits on each visitor's real IP.
- **`FIREBASE_SERVICE_ACCOUNT`** also accepts base64-encoded JSON.
- **`cincin_frontend/public/_redirects` and `public/_headers`:** SPA fallback and cache headers for Sevalla static sites. These replace what `vercel.json` did on Vercel.
