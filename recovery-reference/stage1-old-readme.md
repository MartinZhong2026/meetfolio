# Meetfolio

**Desktop v0.1.0 integration candidate:** a login-free local research notebook with genuine offline X-ASR, native model installation and Windows installer work is available in [Draft PR #6](https://github.com/MartinZhong2003/meetfolio/pull/6). See [desktop build, packaged-app verification and release gates](docs/desktop-integration.md). Candidate installers are GitHub Actions artifacts, not an approved public release. End users of the packaged app need no Node.js, Python, Docker, PostgreSQL or paid transcription key. Physical microphone/long-interview qualification is recorded separately from file-backed tests.

The original server-backed web application is preserved below.

**From conversations to traceable knowledge.**

**Meetfolio is a research-first workspace for interviews and meetings.** It brings preparation materials, live transcription, researcher notes, evidence-linked AI summaries, and export into one place—so researchers can spend less time assembling fragmented records and more time understanding what people actually said.

Built with Chinese-language qualitative research in mind, Meetfolio is being prepared for an open-source community release.

> **Project status: Working MVP · Open-source release in preparation**  
> The application has a real Node.js backend, PostgreSQL persistence, authentication, and automated tests. However, the Alibaba Cloud / Qwen integrations have **not yet passed live end-to-end verification with production credentials**; the provider protocol and key workflows have been tested primarily against local mocks. See [verification status](#project-status-and-limitations). **There is no public hosted demo yet.**

**Interface:** Simplified Chinese · **Code and technical documentation:** English

## Local-first desktop interface

A separate desktop-style workspace is now available without a login or API key: preparation → three-column interview → source review and local export. It supports persistent local notes/manual transcript editing and TXT/Markdown/DOCX/JSON exports. **A real offline ASR engine/model is not included**; its absence and the synthetic walkthrough are explicitly labelled. Optional AI stays separate.

```sh
npm ci
npm run build:desktop
npm run desktop
# http://127.0.0.1:4175
```

The standalone build can reload offline after its first asset cache completes. In the existing app, open `/desktop`; existing server-backed research routes remain available. Read the [desktop functionality matrix and native-runtime limits](docs/desktop-ui.md) before using real interview material.

## Why Meetfolio?

Qualitative research is not just about obtaining a transcript. Researchers also need to preserve context, distinguish observations from interpretations, recover from interruptions, and check whether a summary accurately reflects its source.

Meetfolio is designed around three principles:

1. **Evidence before fluency.** AI-generated claims link back to transcript segments. Verbatim quotations are checked against stored source text instead of being accepted on trust.
2. **Humans remain in control.** Researchers can take their own notes, correct transcription errors, compare the original text, edit summaries, and export their work.
3. **Make failures visible.** Connection interruptions, recovered audio, and unrecoverable gaps are represented explicitly rather than silently presenting an incomplete transcript as complete.

## Features

| Area | What the current MVP includes |
| --- | --- |
| Research workspace | A three-panel desktop workspace for reference materials, transcripts, and notes, with tablet and mobile layouts |
| Interview preparation | Interview guides, checklist questions, follow-up prompts, and uploaded PDF, DOCX, TXT, or Markdown reference documents |
| Real-time transcription | Browser microphone capture, WebSocket audio transport, and provider adapters for Alibaba Cloud / Qwen ASR **(live integration requires verification)** |
| Recovery and continuity | Reconnection, bounded local audio buffering, deduplication, recoverable-gap handling, and visible unrecoverable intervals |
| Researcher notes | Categorized timestamp-linked notes, important markers, autosave, and local draft recovery |
| Transcript review | Search, speaker labels, editable segments, preserved original ASR text, and importance flags |
| Evidence-linked AI summaries | Structured summaries distinguishing participants' speech, research notes, and AI inferences; citation and quote checks; summary edits and version history **(real-model quality remains unverified)** |
| Exports | DOCX, Markdown, and TXT |
| Accounts and data isolation | Email/password accounts, server-side sessions, and user-scoped data access |
| Synthetic demo | A clearly labeled, local simulated meeting that does not use paid ASR/LLM APIs; **it currently still requires the application and database to run locally** |

## Try Meetfolio locally — no paid API key required

You can explore the core workflow using **synthetic transcripts and simulated interruptions**. A real Qwen API key is not necessary for the demo.

### Requirements

- Node.js **20 or later**
- Docker with Docker Compose, **or** an existing PostgreSQL 16 instance
- Git

### Quick start

```bash
git clone https://github.com/MartinZhong2003/meetfolio.git
cd meetfolio
npm ci

# Starts PostgreSQL only; the application runs separately with npm.
docker compose up -d db

# macOS / Linux:
cp .env.example .env
# Windows PowerShell instead: Copy-Item .env.example .env

npm run db:migrate
npm run dev
```

Visit **http://localhost:5173**, create a local account, and select **体验演示会议** (*Try demo meeting*).

The development web app runs on port `5173`; the API uses port `8787`. The existing `docker-compose.yml` starts the **database only** and does **not** yet provide one-command deployment of the complete application.

> **Security note:** The example database credentials are for local development only. Do not expose this development setup directly to the public internet.

## Enable real transcription and summaries (optional)

For real audio transcription and AI summaries, configure an Alibaba Cloud Model Studio account and set your credentials in the local `.env` file:

```dotenv
DASHSCOPE_API_KEY=your_private_api_key
DASHSCOPE_WORKSPACE_ID=your_workspace_id
```

See [`.env.example`](.env.example) for model names, regions, service endpoints, usage limits, and other settings. Keys must remain **server-side**; never put them in browser code or commit them to Git.

Real provider usage may incur charges. Before using real recordings, review the [ASR verification checklist](docs/asr-integration.md) and [real-world acceptance tests](docs/acceptance-testing.md). **Do not treat the existence of an adapter or a passing mock test as evidence of live-provider compatibility.**

## How it works

```text
Browser (React + Vite)
  ├─ Research workspace and editing UI
  ├─ Microphone → AudioWorklet
  ├─ Temporary IndexedDB buffer for interruption recovery
  └─ WebSocket / HTTP
             │
             ▼
Node.js / Fastify backend
  ├─ Authentication and research APIs
  ├─ Streaming ASR adapter ──────────────► Alibaba Cloud Model Studio*
  ├─ Evidence-linked summary generator ─► Alibaba Cloud Model Studio*
  ├─ Export services
  └─ PostgreSQL + document storage

* Paid external provider; live end-to-end verification pending.
```

The frontend uses TypeScript, React, Vite, Zustand, and TanStack Query. The backend uses TypeScript, Fastify, Drizzle ORM, PostgreSQL, and WebSockets. The app is organized as an npm-workspaces monorepo (`web/` and `server/`).

See [architecture](docs/architecture.md) and [database design](docs/database.md) for the technical details.

## Project status and limitations

Meetfolio is an **MVP**, not a production-certified recording system.

**Implemented and tested locally:** application flows, PostgreSQL persistence, account isolation, transcript editing, exports, interruption recovery logic, and AI citation validation. Automated tests exercise most external-service behavior with mock providers.

**Not yet verified in a real deployment:** live Alibaba Cloud authentication/ASR behavior and latency, actual model responses and summary quality, extended 30–90 minute physical microphone sessions, real-world network failures and browser sleep, production email delivery, S3-compatible storage integrations, and all intended browser/device combinations.

Audio that is never captured—for example, when a laptop sleeps—cannot be reconstructed. Even recoverable gaps may be retranscribed imperfectly. **Always review transcripts and AI-generated summaries before citing or distributing them.**

Follow the [testing guide](docs/testing.md), [ASR integration status](docs/asr-integration.md), and [acceptance test plan](docs/acceptance-testing.md).

## Testing

With a configured **test PostgreSQL** database:

```bash
npm run typecheck
npm test
npm run test:e2e
npm run build
```

The integration tests use temporary/test databases and may reset their schemas. **Never point test environment variables at real or production databases.** Paid provider calls are mocked in the existing automated test suites.

## Privacy and responsible research

Meetfolio handles potentially sensitive interview data. Please obtain any required participant consent and institutional or research-ethics approval before recording or uploading research materials.

- When real transcription is enabled, audio is sent from the browser through **your Meetfolio server** to the configured Alibaba Cloud speech service. Summary generation also sends selected transcript, notes, and reference content to the configured model provider.
- Complete raw recordings are **not intentionally stored by the Meetfolio server**. A bounded audio buffer may temporarily remain in the user's browser for recovery.
- Meeting metadata, transcripts, notes, and summaries are stored in PostgreSQL; uploaded files use configured document storage.
- People deploying their own instance are responsible for secure hosting, storage, provider settings, access policies, backups, and any applicable privacy obligations.
- The synthetic demo uses fictional content. **Do not put identifiable participant data into demo screenshots, issues, or public test fixtures.**

This project does not claim compliance certification for any specific legal or institutional framework.

## Deployment

Meetfolio currently ships a `Dockerfile` for the web app and Node.js server, with PostgreSQL as a separate dependency. Production-like hosting also needs persistent data storage, TLS, and careful secrets management.

- [Current deployment notes](docs/deployment.md) document a Railway-based option, **not a free-hosting guarantee**.
- A no-backend **public interactive demo** and easier **self-hosted Docker Compose** workflow are planned for the community release; they are **not yet present** in the current repository.

If you only want to evaluate Meetfolio today, start with the local synthetic demo above.

## Contributing

Meetfolio is being prepared for community collaboration, especially on research workflows, accessibility, transcription reliability, model-provider adapters, translations, and evidence-grounded summarization.

Before submitting a change, please open an issue explaining the use case or bug. A dedicated `CONTRIBUTING.md`, contribution templates, and `good first issue` labels will be added as part of the public release. Do not include real interview data or credentials in public reports.

## Maintainer

**Martin Zhong** · [GitHub](https://github.com/MartinZhong2003)

Meetfolio is an independently developed personal project, inspired by the practical needs of researchers and people who conduct interviews.

## License

Meetfolio source is licensed under [MIT](LICENSE). Third-party components retain their own licenses; desktop redistribution notices and review limitations are documented in [desktop-integration.md](docs/desktop-integration.md).

---

### 中文说明

Meetfolio 是一款面向科研访谈、定性研究和会议记录的 AI 工作台。它将访谈提纲、背景资料、实时转录、人工笔记和有证据链接的 AI 总结整合到一个界面，强调**可追溯、可修订、诚实呈现缺失片段**。

目前可以按照上文步骤在本地启动，并在**不使用付费 API** 的情况下体验合成数据演示。真实语音识别和 AI 总结需要自行配置服务，并仍需完成真实环境验证。公开网页版 Demo 和更简洁的自部署方案正在准备中。

欢迎研究者反馈实际需求，也欢迎开发者参与改进。请勿在公开的 Issue、截图或测试样例中上传真实访谈对象的敏感资料。
