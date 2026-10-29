# Deployment

Meetfolio ships as **one container** (API + WebSocket + static web app) plus **PostgreSQL**. The repository includes a
`Dockerfile` and `railway.toml`. **Nothing has been deployed** — publishing needs your explicit decision and your own
credentials.

## Railway, step by step

1. **Create the project** — "New Project → Deploy from GitHub repo" → select this repository (or `railway up`).
   Railway detects `railway.toml` and builds the `Dockerfile`.
2. **Add PostgreSQL** — "New → Database → PostgreSQL". In the web service's *Variables* add
   `DATABASE_URL = ${{Postgres.DATABASE_URL}}` (the private-network URL: no TLS needed, no egress charges). If you use the
   public TCP-proxy URL instead, add `DATABASE_SSL=true` (certificate is not verified against a CA; the connection is
   still encrypted). Migrations run on boot from `server/drizzle`; run **one replica** so two processes never migrate at
   once.
3. **Add object storage** for uploaded documents — Railway's container filesystem is ephemeral, so the default
   `STORAGE_DRIVER=local` would lose files on every deploy (the server logs a warning if you run production that way).
   Use a Railway Bucket or any S3-compatible store (Alibaba Cloud OSS S3 endpoint, Cloudflare R2, MinIO…):
   ```
   STORAGE_DRIVER=s3
   S3_ENDPOINT=https://…          # provider endpoint
   S3_REGION=auto
   S3_BUCKET=…
   S3_ACCESS_KEY_ID=…
   S3_SECRET_ACCESS_KEY=…
   S3_FORCE_PATH_STYLE=true       # needed for some providers (MinIO, OSS)
   ```
   The bucket must be **private**; the app proxies downloads after an ownership check. The S3 client only sends/validates
   checksums where an operation requires them (`WHEN_REQUIRED`): newer AWS SDK defaults add CRC headers that several
   S3-compatible stores (e.g. OSS, older MinIO) reject.
4. **Core variables**
   ```
   NODE_ENV=production
   APP_ORIGIN=https://<your-domain>        # exact origin users open; drives CSRF/WebSocket Origin checks and reset links
   # TRUST_PROXY defaults to auto: on when Railway's variables are present (Railway terminates TLS in front of the
   # container). Without it every user would share one IP for rate limiting. Set true behind any other proxy.
   SIGNUP_ALLOWLIST=you@uni.edu.cn,@your-lab.edu.cn   # private staging: only these may register
   DASHSCOPE_API_KEY=…                      # secret
   DASHSCOPE_WORKSPACE_ID=…
   SMTP_URL=smtp://user:pass@host:587       # password-reset email (otherwise operators reset via the CLI script)
   MAIL_FROM="Meetfolio <no-reply@your-domain>"
   ```
   `PORT` is provided by Railway. Cookies are `Secure` automatically in production, so use the HTTPS domain.
5. **Preflight (before the first deploy).** With the staging variables loaded, run
   ```bash
   npm run check:config -- --connect          # from a checkout with the variables exported
   node server/dist/scripts/check-config.js --connect   # or inside the running Railway service (Railway shell)
   ```
   It validates every variable offline (https origin, secure cookies, object storage, DashScope settings, model profile,
   SMTP), resolves the DashScope hosts by DNS, connects to PostgreSQL, and does a put/get/delete round-trip in the bucket.
   It never calls a DashScope API. Exit code 1 = something must be fixed.
6. **Deploy.** Migrations run on boot. Health check: `GET /api/health`. Open the URL, register, and follow the
   [live verification checklist](asr-integration.md#live-verification-checklist).
7. **Custom domain** (recommended, and required for a stable `APP_ORIGIN`): Settings → Networking → Custom Domain.

WebSockets (`wss://…/ws/transcribe`) work through Railway's proxy with no extra configuration. Run **one replica**
(live-session state is in process memory; see *Scaling* in [architecture.md](architecture.md)).

### Deploy-time behaviour

Railway sends `SIGTERM` on redeploy. The server flushes and persists live sessions (≤ 8 s) and exits; connected
researchers' browsers keep recording locally, reconnect to the new instance automatically, and recover the short
interval as a gap. Prefer deploying between interviews anyway.

## Audit notes (verified offline)

| Area | Finding | Status |
| --- | --- | --- |
| Docker runtime stage | `npm ci --omit=dev --workspace=server` + compiled `server/dist` + `web/dist`: simulated in a clean directory (no Docker daemon available here) — boots, migrates, serves API/SPA/assets, ~109 MB of dependencies. | Verified by simulation; real image build not run |
| Container user | Runs as `node`; `/app` was root-owned, so the local storage driver could not write. `/app/.data` is now created and owned by `node`. | Fixed |
| Proxy / rate limits | `TRUST_PROXY` defaulted to off; behind Railway all clients would share one rate-limit key for login. Now `auto`. | Fixed |
| S3-compatible stores | Default AWS SDK checksum behaviour breaks some providers. | Fixed (`WHEN_REQUIRED`) |
| `LLM_EXTRA_BODY` | Invalid JSON was silently ignored. | Now validated, logged, and reported by `check:config` |
| Health check | `/api/health` answers once the server has migrated and is listening. | OK |
| Signals | Node is PID 1 and handles `SIGTERM` (graceful flush of live sessions). | OK |
| Open registration | Anyone with the URL could register and spend DashScope quota. Optional `SIGNUP_ALLOWLIST` added. | Fixed (set it for staging) |
| Secrets | None in the repository; `.env*` ignored (except `.env.example`). | OK |

## Local production-like run

```bash
npm ci && npm run build
NODE_ENV=production COOKIE_SECURE=false APP_ORIGIN=http://localhost:8787 DATABASE_URL=… npm start
```

## Environment reference

See [`.env.example`](../.env.example) — every variable is documented there. The ones that matter most:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL`, `DATABASE_SSL` | PostgreSQL |
| `APP_ORIGIN`, `EXTRA_ALLOWED_ORIGINS`, `TRUST_PROXY` | Origin checks, links, proxy handling |
| `DASHSCOPE_API_KEY`, `DASHSCOPE_WORKSPACE_ID`, `DASHSCOPE_REGION` | Model Studio |
| `ASR_PROVIDER`, `ASR_MODEL`, `ASR_WS_URL` | Choose/override the recogniser and endpoint |
| `ASR_SESSION_ROTATE_MINUTES` etc. | Reliability tuning |
| `LLM_MODEL_STANDARD`, `LLM_MODEL_QUALITY`, `LLM_BASE_URL` | Summary models |
| `STORAGE_DRIVER` + `S3_*` | Document storage |
| `ASR_DAILY_MINUTES_LIMIT`, `SUMMARY_DAILY_LIMIT` | Per-account guard rails |

## Where data is processed and stored

| Data | Where | Notes |
| --- | --- | --- |
| Live speech | Browser → your server (TLS) → Alibaba Cloud Model Studio | Not stored by Meetfolio. Subject to Alibaba Cloud's terms for the chosen region/endpoint. |
| Short audio for recovery | The user's browser (IndexedDB) | Bounded (40 min/meeting), pruned after confirmation, swept after 7 days. Re-submitted only for gaps. |
| Transcripts, notes, summaries, metadata | Your PostgreSQL | Per-user access only. |
| Uploaded documents | Your object store (originals) + PostgreSQL (extracted text) | Private. |
| Summary prompts | Your server → Alibaba Cloud Model Studio | Contains transcript/notes/reference text. |

### Regions and mainland-China access

Nothing is hard-coded to a region: `DASHSCOPE_REGION` / `ASR_WS_URL` / `LLM_BASE_URL` select endpoints, and the database
and object store are whatever you provision. Practical points:

- Railway's regions are outside mainland China; reachability and latency from mainland networks can vary — test from the
  actual institution network before relying on it. If needed, host the same container on a mainland cloud (the Dockerfile
  is portable) with an RDS PostgreSQL and OSS bucket; no code changes are required.
- Institutional rules about transferring interview data abroad or to third-party AI services may apply to your research
  ethics approval. That is a policy question outside this software; Meetfolio only avoids storing raw audio by default.
- The web app uses system fonts only (no Google Fonts or other blocked CDNs).

## Costs (orders of magnitude — verify on the provider pages)

- **ASR** is billed by audio duration of every second sent to the model, **including replayed audio after reconnects and
  re-submitted gap audio**. Rotation and replay add a few seconds each; recovery bills the recovered minutes.
- **Text generation** is billed by tokens; one summary of a 90-minute interview is roughly one pass over the transcript
  (plus one extra pass for map-reduce on very long meetings). Nothing calls the model without an explicit click.
- **Railway**: one small service + Postgres + a bucket is typically a few USD per month at this scale.
- The app caps usage per account per day (`ASR_DAILY_MINUTES_LIMIT`, default 600 min; `SUMMARY_DAILY_LIMIT`, default 30) and
  one concurrent live session per account. Usage is visible under 账户 → 用量.
