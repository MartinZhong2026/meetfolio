# ASR integration and interruption recovery

## Verification status

**Read this first.** No DashScope credentials were available while this was built, and Alibaba's documentation hosts
(`help.aliyun.com`, `alibabacloud.com`) were blocked by the build sandbox's network policy. The integration was
therefore written against these *reachable* primary sources:

- Alibaba's official demo repository `aliyun/alibabacloud-bailian-speech-demo` (samples for
  `qwen-audio-3.0-asr-flash-streaming`, with context/hot-word variants, and for `qwen3-asr-flash-realtime`)
- The official `dashscope` Python SDK source (`websocket_request.py`, `recognition.py`, `omni_realtime.py`), which defines
  the exact wire protocol (events, envelopes, headers, heartbeat/ping behaviour)

| Item | Status |
| --- | --- |
| Model ids | **Confirmed documented by the project owner** against Alibaba's model pages: `qwen-audio-3.1-asr-flash-streaming`, `qwen3.7-plus`, `qwen3.8-max`. `qwen-audio-3.0-asr-flash-streaming` remains the default (it is in Alibaba's official sample repository); `ASR_MODEL=qwen-audio-3.1-asr-flash-streaming` selects 3.1. |
| 3.0 vs 3.1 request format | Alibaba's *client-events* reference (read via search excerpts — the docs hosts are blocked from the build sandbox) shows 3.1 on the **same** `run-task` inference protocol (`task_group audio`, `task asr`, `function recognition`, binary 16 kHz PCM, `format` + `sample_rate`). Optional parameters are sent per model from an explicit profile in `qwenAudioStreaming.ts`: **3.0** → `language_hints`, instant `vocabulary`, prompt `context` (all shown in official samples); **3.1** → `language_hints`, instant `vocabulary` (reported to carry over from 3.0), **no `context`** until verified; 3.1-only options (dialect retention, VAD model) left at defaults, so dialect speech is written as standard Mandarin. Unknown ids get core parameters only. |
| Instant hot-word format | **Fixed in this round:** per-request `vocabulary` is an object `{"养老护理": 4, …}` as in Alibaba's samples. The previous code sent the `[{text, weight}]` list, which is the format for *creating* a precompiled vocabulary. Hot-words over 15 CJK characters / 7 ASCII words are dropped (documented limit). |
| `qwen3.7-plus` | Official DashScope SDK (2.0.1) examples call it through the OpenAI-compatible `chat.completions` endpoint, exactly as Meetfolio does. |
| `qwen3.8-max` | Official SDK lists it (it is the SDK CLI's default model) but calls it on DashScope's *native* generation API, and notes it emits reasoning tokens. Unverified on the compatible-mode route Meetfolio uses. Safeguards: a "url error" / `Model.NotExist` answer falls back to the standard model (shown to the user); a rejected `response_format` is retried once without JSON mode (the summariser parses JSON from plain text); reasoning deltas are ignored. Reasoning can lengthen generation — raise `LLM_TIMEOUT_MS` or set a budget via `LLM_EXTRA_BODY` if needed. |
| Wire protocol of both adapters | Implemented from the SDK/sample source; **exercised only against local mock servers** that speak the same protocol (`server/test/mock-dashscope.ts`). |
| Real connection, auth, accepted parameters, result timing, session limits | **Not verified live** (no paid calls were made). Needs the live checklist below / `docs/acceptance-testing.md`. |
| `qwen3-asr-flash-realtime` | Alternative adapter (`ASR_PROVIDER=qwen3-realtime`). Protocol from the SDK; unverified live. |
| Pricing, quotas | Not recorded — the official pricing pages were not reachable. Check Model Studio billing before real use. |

## Provider contract (`server/src/asr/types.ts`)

```ts
interface AsrProvider {
  connect(opts, handlers): Promise<AsrConnection>;
}
interface AsrConnection {
  sendAudio(pcm): void;
  finish(timeoutMs): Promise<boolean>;   // true only if the provider confirmed the end of the task
  close(): void;
}
handlers: onResult({kind:'interim'|'final', key, text, startMs, endMs}), onClosed({clean, error?})
```

Errors are classified `fatal` (bad key, no permission, unknown model — never retried) or `transient` (retried).

### Adapter 1 — `qwen-audio-streaming` (default)

DashScope *inference* WebSocket, `wss://{WORKSPACE_ID}.{REGION}.maas.aliyuncs.com/api-ws/v1/inference`
(the qwen-audio series is served from a workspace-specific host).

1. `Authorization: Bearer <DASHSCOPE_API_KEY>` on the handshake.
2. Send `run-task` — `header {action, task_id, streaming:"duplex"}`, `payload {task_group:"audio", task:"asr",
   function:"recognition", model, parameters {format:"pcm", sample_rate:16000, language_hints, vocabulary}, input {context}}`.
3. Wait for `task-started`; then stream **binary** PCM16 mono frames.
4. `result-generated` → `payload.output.sentence {begin_time, end_time, text}`; `end_time` set ⇒ sentence final.
   `heartbeat:true` sentences are ignored.
5. `finish-task` → flush → `task-finished` → close(1000). `task-failed` carries `error_code/message`.

Terminology hints use the instant hot-word list (`vocabulary: {"词": 4}`, weight 4 = "clear preference"); for 3.0 the
meeting title/topic is also sent as prompt context (≤ 400 chars). Defaults for the target domain are in
`ASR_DOMAIN_TERMS` (养老护理, 认知障碍, 长期照护, 社区治理, 访谈研究, 社会工作, 护理员, 政策执行).

### Adapter 2 — `qwen3-realtime`

DashScope *realtime* WebSocket (`…/api-ws/v1/realtime?model=qwen3-asr-flash-realtime`): `session.created` →
`session.update` (format, sample rate, language, corpus text, server VAD) → `session.updated` →
`input_audio_buffer.append` (base64) → `…transcription.text` (interim) / `…completed` (final) → `session.finish`.
This protocol returns no sentence timestamps, so times are derived from the audio sent.

### Transport keep-alive

Both adapters ping the provider every 20 s and terminate the socket if no pong arrives within 50 s — a half-open TCP
connection becomes an *abnormal close*, which the pipeline recovers from.

## Why earlier tools stopped at ~17 / 25 minutes, and what is done about it

The brief mentions a tool that silently stopped after ~17 or ~25 minutes. The cause is not known here (it may be a
provider-side session cap, an idle/NAT timeout, or a client bug). Meetfolio does not rely on any one explanation:

| Risk | Defence |
| --- | --- |
| Provider caps a session at *N* minutes | **Planned rotation** every `ASR_SESSION_ROTATE_MINUTES` (default 12) at a sentence boundary (waits ≤ `ASR_ROTATE_GRACE_SECONDS`), finishing the old task so its last sentence is flushed, then opening a new one. Test: a provider that kills every connection after 17 min never gets the chance. |
| Provider drops the socket | Detect (close / error / missed pong) → reconnect (immediate, then 0.5 s → 15 s backoff, bounded fast attempts then slow retries) → **replay all audio not yet finalised** to the new connection so the in-flight sentence is recognised again. |
| Provider unreachable for minutes | Audio keeps arriving and is retained up to `ASR_OUTAGE_BUFFER_SECONDS`; beyond that the oldest is dropped and recorded as a **gap**. The browser, which still holds the audio, re-submits it when the provider is back. UI shows 连接失败 · 仍在重试 honestly. |
| Browser ↔ server socket drops | Browser keeps capturing into IndexedDB, reconnects with backoff, and sends `hello` with the *current* position; the server records the missing interval as a gap and the browser uploads that range for re-transcription. A silent socket is detected by missing server heartbeats (> 16 s). |
| Server restarts / deploys | Graceful stop persists everything; on boot, active sessions are marked interrupted; browsers reconnect and recover the interval as a gap. |
| Page refresh / crash mid-recording | Saved transcript is reloaded; the meeting shows 已中断; "继续" starts capture at the later of the saved mark and the local buffer's end, so audio buffered before the crash is re-transcribed; a zero-length `page_reload` marker records the unknowable junction. |
| Database hiccup | Final writes retry with backoff from an in-memory queue; the UI shows the problem; `stop` reports `unsaved`; finals are only sent to the browser *after* they are stored. |
| Duplicate / replayed provider events | Deterministic dedupe keys + unique index. |
| Laptop sleeps / tab closed | **Cannot be recovered** — browsers do not record in that state. The UI says so; the interval becomes a visible gap ("无法找回"), and the researcher can add a manual passage. A screen wake-lock is requested while recording to reduce accidental sleep. |

### What is *not* guaranteed

- Perfect recovery of interrupted speech is **not** promised. Replay and re-transcription can produce slightly different
  sentence boundaries; recovered segments are labelled `补录` and recovered text replaces only untouched earlier output.
- Recovery needs the audio to still be in *that browser's* IndexedDB (40 min cap per meeting, 7-day sweep). Another device
  or a cleared profile cannot recover it.
- A sentence cut by a planned rotation may be split across two segments.
- Replaying faster than real time (`ASR_RECOVERY_SPEED`, default 2×) is assumed to be tolerated by the provider; this is
  unverified. Set it to `1` if the provider rejects faster-than-real-time input.

## Simulation vs. reality

`server/test/pipeline.test.ts` and `web/src/audio/transcriber.test.ts` run **logical** 90-minute sessions on virtual
clocks with injected failures at 17, 25 and 60 minutes, provider session caps, hung shutdowns, long outages and database
failures. They prove the *logic* (no loss, no duplicates, honest gaps, correct timeline mapping). They do **not** prove:
real microphone behaviour for 90 minutes, how the provider behaves on a real long session, real network jitter, or that
the provider tolerates the replay pacing. A simulated pass is not a substitute for the live checklist.

## Live verification checklist

Do this once with real credentials (costs a few ASR minutes and one summary):

1. Set `DASHSCOPE_API_KEY`, `DASHSCOPE_WORKSPACE_ID` (and `ASR_MODEL` if needed); start the app; confirm the log has no
   "not configured" warnings and the config endpoint reports `asrConfigured: true`.
2. Create a meeting, click 开始转录, speak Mandarin for 1 minute: interim text should appear within ~1 s and finals
   every sentence. In the database `transcription_sessions.provider/model` show the live model.
3. Say a domain term from the hot-word list; check recognition.
4. Let it run ≥ 30 minutes (play a recording near the microphone). Confirm `providerSessions` > 1 (rotation) and no gap.
5. Pull the network cable for 30 s mid-session: status → 重新连接中; on return, a gap marker appears and is replaced by
   `补录` segments. Check `transcript_gaps` and `recovery_chunk_metadata`.
6. Open DevTools → Application → IndexedDB → `meetfolio-audio`: size stays bounded; entries are pruned after confirmation.
7. Generate an AI summary (standard, then quality). Confirm the model ids are accepted; if the quality id is rejected the
   banner explains the fallback.
8. If recovery re-submission is rejected or garbled, set `ASR_RECOVERY_SPEED=1`.
9. Record the observed provider session limit (if any) and adjust `ASR_SESSION_ROTATE_MINUTES` below it.
