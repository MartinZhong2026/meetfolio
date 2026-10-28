# Engineering verification workflow

This is a recovery baseline, not the original v0.6.0 source or an accepted release. Read the root [AGENTS.md](../../AGENTS.md) before changing the project. Claude also points to that file. There are no more specific repository AGENTS.md files at the time of this update.

## Local baseline

Use the exact Node 22 version in `.nvmrc` (the `package.json` engine is the broader compatibility declaration). Run `npm ci` and `npm run verify`. This command checks the test database guard, all workspace TypeScript, Web and Desktop unit tests, Web/Server/Desktop builds and expected build files. It does **not** start a database, run browser tests, package an installer or verify a microphone.

`npm ci` must run after stopping processes that hold `node_modules` files, especially on Windows. npm versions differ in lifecycle-script policy: npm 11 reported unapproved `esbuild` versions, `sharp` and `electron-winstaller`; build-only checks may work without them, but installers and native modules require reviewing package scripts and explicitly permitting the necessary ones in the local npm policy. Do not globally disable security checks or assume `npm ci` success proves native binaries work. Node 22 from setup-node may ship a different npm version: CI logs both versions.

## Disposable databases only

The server suite deletes the `public` and `drizzle` schemas and reapplies migrations; browser E2E drops and recreates `meetfolio_e2e`. Create a dedicated, disposable local PostgreSQL instance with no user data. Do not use an existing application instance or a production tunnel. The harness requires explicit URLs, loopback host, exact test database names and the matching reset acknowledgement; these checks cannot prove that a local proxy is safe. CI uses a fresh PostgreSQL service per job.

For server tests, set `TEST_DATABASE_URL` to a local URL ending in `/meetfolio_test`, set `MEETFOLIO_ALLOW_TEST_DB_RESET=meetfolio_test`, then run `npm run test -w server` twice. The test role needs schema creation permissions. For the historical web E2E suite, set `E2E_DATABASE_URL` to a local URL ending in `/meetfolio_e2e`, set `MEETFOLIO_ALLOW_TEST_DB_RESET=meetfolio_e2e`, and run `npm run build` followed by `npm run test:e2e`; that role must be able to create/drop the disposable database. Never point either harness at a valuable database.

For the standalone desktop UI run `npm run build:desktop`, `npx playwright install chromium`, then `npm run test:desktop`. Browser tests use fictional data and mock native bridge methods; they cannot establish native X-ASR, actual microphone behavior or installer safety. Screenshots and traces go into ignored test output, not tracked historical reports.

## Automation and review

The PR workflow runs Node 22 dependency installation, `verify`, isolated PostgreSQL tests twice, desktop and historical web browser tests, artifact checks and production dependency audit. Each job has a timeout; concurrency cancels obsolete runs. `npm audit --omit=dev --audit-level=high` is a real gate and must not be silenced to produce green CI. The security-upgrade candidate clears the high threshold locally but retains moderate React Router advisories; CI must validate the candidate. A successful Linux run is not Windows or macOS native acceptance.

Humans must review data compatibility and rollback, actual desktop device tests, licensing/redistribution of compiled references and dependencies, security implications, release permissions and branch protection. The public repository includes the historical `app.asar`, compiled assets and third-party notices. Ownership, redistribution rights and the completeness of those notices have not been independently established: do not publish a release based on their presence alone. Preserve the historical reference files; the original ZIP checksums are provenance evidence, not a checksum of subsequent source edits.
