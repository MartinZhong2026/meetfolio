# Real-world acceptance testing (private staging)

Run this on the staging deployment with real DashScope credentials, a real microphone and a real browser
(Chrome or Edge on a laptop; repeat key items in Safari if researchers use Macs). It costs real ASR minutes and a few
summaries — roughly 2–3 hours of audio in total. Record results in the **Result** column.

## Coverage map: what is already proven vs. what only this checklist can prove

| Area | Covered by automated tests (simulated / mocked) | Needs live verification (this document) |
| --- | --- | --- |
| Microphone capture | Fake Chromium microphone device → AudioWorklet → 16 kHz PCM → server (e2e) | Real microphones, gain, room noise, Safari/Edge |
| ASR protocol | Mock DashScope servers speaking the documented `run-task` / realtime protocols | Real handshake, accepted parameters, result timing, model ids |
| Recognition accuracy | Not testable offline | Everything in §2 |
| Long sessions | Logical 90-min runs on virtual clocks with failures at 17/25/60 min (server + browser) | Real 30- and 90-min sessions (§3, §4) |
| Interruption recovery | Socket kills, ~9 s network block, page refresh, provider drops (e2e + unit) | Real Wi-Fi loss, provider behaviour, replay-speed tolerance (§5) |
| Persistence | PostgreSQL integration tests, idempotent writes, reload checks | Staging database + redeploy behaviour (§6) |
| AI summary | Mocked LLM: grounding, quote verification, fallbacks, map-reduce | Output quality, model availability, latency (§7) |
| DOCX export | Generated and re-parsed with mammoth | Opening in Word/WPS, Chinese typography (§8) |
| Account isolation | 12 routes + WebSocket probed with two users | Same on staging over HTTPS (§9) |

**A simulated pass is not a live pass.** Simulations prove the logic (no loss, no duplicates, honest gaps); they cannot prove
microphone hardware, provider limits, network conditions or recognition quality.

## 0. Preconditions

| # | Step | Expected | Result |
| --- | --- | --- | --- |
| 0.1 | `node server/dist/scripts/check-config.js --connect` in the staging service | 0 errors | |
| 0.2 | Open the staging URL over HTTPS; register two accounts (A, B) from the allow-list | Both succeed; a non-listed email is refused | |
| 0.3 | 账户 → 数据与隐私 shows 语音识别服务：已配置, AI 纪要：已配置 | Both configured | |
| 0.4 | Note which model is configured (`ASR_MODEL`); run §1–§2 once with **3.0** and once with **3.1** | Both recorded | |

## 1. Real microphone transcription (≈10 min)

| # | Step | Expected | Result |
| --- | --- | --- | --- |
| 1.1 | New meeting → 开始转录 → allow microphone | Status 正在连接 → 转录中 within ~2 s; level meter moves | |
| 1.2 | Speak normally for 2 minutes | Grey interim line appears within ~1 s; finals replace it, no duplicate lines | |
| 1.3 | Type notes while speaking | Transcript keeps updating; header shows ✓ 已自动保存 | |
| 1.4 | 暂停 → wait 30 s → 继续 | Timer stops while paused and resumes; no gap marker | |
| 1.5 | 标记重点, edit a segment, set a speaker label | All saved; original shown under “已修订” | |
| 1.6 | 结束 → review page | Last sentence present; status 转录已完成 | |
| 1.7 | DB: `transcription_sessions.model` | Equals the configured model | |

## 2. Recognition accuracy (≈20 min, repeat per model)

Use a prepared script of ~600 characters read by 2 speakers (one with a regional accent), containing the domain
terms 养老护理, 认知障碍, 长期照护, 社区治理, 访谈研究, 社会工作, 护理员, 政策执行, two English terms and one number/date.

| # | Measure | Target | 3.0 | 3.1 |
| --- | --- | --- | --- | --- |
| 2.1 | Character error rate vs. script (CER = edits / chars) | ≤ 8 % read speech | | |
| 2.2 | Domain terms correctly recognised | ≥ 7 / 8 | | |
| 2.3 | Accented speaker CER | ≤ 15 % | | |
| 2.4 | Mixed English terms | Recognised or sensibly transliterated | | |
| 2.5 | Punctuation / sentence segmentation | Readable sentences, no run-ons > 60 s | | |
| 2.6 | Spontaneous interview speech (5 min unscripted) | Usable with light correction | | |

If hot-words seem ignored, or the session fails to start with a parameter error, record the error code from the server
log. Profiles are in `server/src/asr/qwenAudioStreaming.ts`.

## 3. 30-minute continuous recording

| # | Step | Expected | Result |
| --- | --- | --- | --- |
| 3.1 | Play a 30-min recorded interview through a speaker near the microphone (laptop plugged in) | Status stays 转录中 throughout | |
| 3.2 | After 30 min | Timer ≈ 00:30:00; transcript continuous; no gap marker | |
| 3.3 | DB: `transcription_sessions.provider_sessions` | ≥ 3 (planned rotation every 12 min), `reconnects` = 0 | |
| 3.4 | Check text around each rotation time (≈ 12:00, 24:00) | At most a sentence split, nothing missing | |
| 3.5 | DevTools → Application → IndexedDB `meetfolio-audio` | Stays small (pruned after confirmation) | |

## 4. 90-minute continuous recording

| # | Step | Expected | Result |
| --- | --- | --- | --- |
| 4.1 | Same as §3 with a 90-min source; screen on, wake-lock active | 转录中 for the whole session | |
| 4.2 | Passes the 17-, 25- and 60-minute marks | No stop, no silent gap | |
| 4.3 | Final duration and segment count | Duration ≈ 1:30:00; segments throughout the timeline (no empty half-hour) | |
| 4.4 | `usage_events` / 账户 → 用量 | ≈ 90+ ASR minutes recorded | |
| 4.5 | Observe and record any provider-side session limit in the logs (`provider_error` codes) | Limit (if any) noted; `ASR_SESSION_ROTATE_MINUTES` stays below it | |

## 5. Network interruption and recovery

| # | Step | Expected | Result |
| --- | --- | --- | --- |
| 5.1 | During recording, turn Wi-Fi off for 20 s, then on | 重新连接中 + “内容已暂存在本机” banner; back to 转录中 | |
| 5.2 | After reconnect | Gap marker appears, then 补录 segments fill it within ~1 min | |
| 5.3 | Wi-Fi off for 3 min | “连接失败 · 仍在重试”; after return the gap is recovered | |
| 5.4 | Refresh the page mid-recording | Saved text intact, 已中断; 继续 recovers the pre-refresh seconds; a zero-length marker remains | |
| 5.5 | Close the laptop lid for 1 min while recording | Honest “无法找回” gap after resume (browsers cannot record asleep) | |
| 5.6 | If 补录 fails or text is garbled | Set `ASR_RECOVERY_SPEED=1`, redeploy, repeat 5.2 | |
| 5.7 | Redeploy the service during a test recording | Browser reconnects automatically; short gap recovered | |

## 6. Transcript persistence

| # | Step | Expected | Result |
| --- | --- | --- | --- |
| 6.1 | After §3, open the meeting on a second device (same account) | Identical transcript, notes, edits | |
| 6.2 | Redeploy, then reopen | Nothing lost | |
| 6.3 | `select count(*), count(distinct dedupe_key) from transcript_segments where meeting_id = …` | Equal (no duplicates) | |
| 6.4 | Gap rows (`transcript_gaps`) match what the UI shows | Consistent | |

## 7. AI summary quality

Use the 30-min and 90-min meetings plus one with notes and an uploaded guide/background document.

| # | Check | Expected | Result |
| --- | --- | --- | --- |
| 7.1 | 标准 (qwen3.7-plus) generates | Completes; model shown; time noted | |
| 7.2 | 高质量 (qwen3.8-max) generates | Completes, **or** shows the fallback notice (record which) | |
| 7.3 | Every quote (五、重要原话) | Appears verbatim in the linked segment | |
| 7.4 | Click 5 random citations | Each jumps to a segment that supports the claim | |
| 7.5 | Section 六 (researcher notes) | Notes reproduced verbatim, labelled as human | |
| 7.6 | Reference-document facts | Never presented as something a participant said | |
| 7.7 | AI inferences | Labelled “AI 推断/AI 建议”, none presented as participant statements | |
| 7.8 | No invented names, roles or institutions | None | |
| 7.9 | 90-min meeting | Uses map-reduce (stats), no section silently empty; generation time noted | |
| 7.10 | Researcher rating (1–5): usefulness, accuracy, missing points | ≥ 4 / 4 / few | |

## 8. DOCX export

| # | Check | Expected | Result |
| --- | --- | --- | --- |
| 8.1 | Export DOCX from the review page and the dashboard | Downloads with a Chinese filename | |
| 8.2 | Open in Microsoft Word and in WPS | Opens without repair prompts | |
| 8.3 | Content | Title, date, duration, participants, timestamped transcript (corrected text), notes, summary; gap markers | |
| 8.4 | Typography | Chinese renders in a CJK font; headings structured; no garbled characters | |
| 8.5 | Markdown and TXT exports | Same content, readable | |

## 9. Account data isolation

| # | Step | Expected | Result |
| --- | --- | --- | --- |
| 9.1 | As B, open A's meeting URL (`/meetings/<id>` and `/live`) | “找不到这场会议” | |
| 9.2 | As B, request `/api/meetings/<A's id>/export?format=docx` | 404 | |
| 9.3 | As B, request A's document file URL | 404 | |
| 9.4 | B's dashboard search for a phrase from A's transcript | No results | |
| 9.5 | Log out; open any meeting URL | Redirect to login | |
| 9.6 | A deletes a meeting | Gone for A; stored file removed from the bucket | |

## Sign-off

| Area | Pass / fail | Notes / follow-ups |
| --- | --- | --- |
| Microphone | | |
| Accuracy (3.0 / 3.1) — choose default model | | |
| 30 min | | |
| 90 min | | |
| Interruption recovery | | |
| Persistence | | |
| AI summary | | |
| DOCX | | |
| Isolation | | |
