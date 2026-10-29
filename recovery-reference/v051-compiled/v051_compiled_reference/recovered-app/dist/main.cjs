"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/main.ts
var import_electron = require("electron");
var import_node_path3 = __toESM(require("node:path"));
var import_node_crypto2 = require("node:crypto");
var import_node_url = require("node:url");
var import_promises = __toESM(require("node:fs/promises"));
var import_node_fs3 = require("node:fs");

// src/native-session.ts
var import_node_crypto = require("node:crypto");

// src/text.ts
var LEADING = /^[\s，。？！、；：,.!?;:…—·]+/u;
var HAS_SPEECH = /[\p{L}\p{N}]/u;
function cleanFinalText(text) {
  const trimmed = text.replace(LEADING, "").trim();
  return HAS_SPEECH.test(trimmed) ? trimmed : null;
}

// src/native-session.ts
var NativeSession = class {
  constructor(provider, callbacks) {
    this.provider = provider;
    this.callbacks = callbacks;
  }
  id = (0, import_node_crypto.randomUUID)();
  connection = null;
  frames = [];
  received = 0;
  confirmed = 0;
  generation = 0;
  retries = 0;
  closed = false;
  stopping = false;
  recovery = null;
  finishing = null;
  startup = new AbortController();
  async start() {
    await this.open();
  }
  async open() {
    const generation = ++this.generation;
    const base = this.confirmed;
    const connection = await this.provider.connect({ sampleRate: 16e3, languageHints: ["zh", "en"], terms: [] }, {
      onResult: (result) => {
        if (!this.closed && generation === this.generation) this.result(result, base, generation);
      },
      onClosed: (info) => {
        if (generation !== this.generation || this.closed) return;
        this.connection = null;
        if (!info.clean && !this.recovery) void this.reconnect(info.error);
      }
    }, this.startup.signal);
    if (this.closed) {
      connection.close();
      return;
    }
    this.connection = connection;
    for (const frame of this.frames) {
      if (this.closed || !this.connection) break;
      const skip = Math.max(0, base - frame.start);
      if (skip < frame.pcm.length / 2) connection.sendAudio(frame.pcm.subarray(skip * 2));
    }
    if (!this.closed && this.connection !== connection) throw new Error("Replay connection failed");
  }
  result(result, base, generation) {
    const start = Math.max(base, base + Math.round(result.startMs * 16));
    if (result.kind === "interim") {
      this.callbacks.partial({ key: `${generation}_${result.key}`, text: result.text, startMs: start / 16 });
      return;
    }
    const end = Math.min(this.received, base + Math.round((result.endMs ?? 0) * 16));
    if (end < this.confirmed || end < start) return;
    this.confirmed = Math.max(this.confirmed, end);
    this.frames = this.frames.filter((frame) => frame.start + frame.pcm.length / 2 > this.confirmed);
    const first = this.frames[0];
    if (first && first.start < this.confirmed) {
      first.pcm = Buffer.from(first.pcm.subarray((this.confirmed - first.start) * 2));
      first.start = this.confirmed;
    }
    this.callbacks.partial({ key: `${generation}_${result.key}`, text: "", startMs: start / 16 });
    const text = cleanFinalText(result.text);
    if (text) this.callbacks.final({
      id: `native_${generation}_${result.key}`,
      seq: 0,
      originalText: text,
      editedText: null,
      speakerLabel: null,
      startMs: start / 16,
      endMs: end / 16,
      isImportant: false,
      source: "local",
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    });
  }
  send(pcm) {
    if (this.closed || this.stopping) return;
    const frame = Buffer.from(pcm);
    if (!frame.length || frame.length % 2 || frame.length > 32e3) {
      this.interrupt("\u65E0\u6548\u97F3\u9891\u5E27\uFF0C\u8F6C\u5F55\u5DF2\u505C\u6B62\u3002");
      return;
    }
    this.frames.push({ start: this.received, pcm: frame });
    this.received += frame.length / 2;
    if (this.received - this.confirmed > 16e3 * 60) {
      this.interrupt("\u672A\u786E\u8BA4\u7684\u97F3\u9891\u5DF2\u8D85\u8FC7\u4E00\u5206\u949F\u3002\u5DF2\u505C\u6B62\u9EA6\u514B\u98CE\uFF1B\u8BF7\u6838\u5BF9\u672B\u5C3E\u5185\u5BB9\u540E\u7EE7\u7EED\u3002");
      return;
    }
    try {
      this.connection?.sendAudio(frame);
    } catch (error) {
      void this.reconnect(error);
    }
  }
  reconnect(error) {
    if (this.closed) return Promise.resolve();
    if (this.recovery) return this.recovery;
    this.connection = null;
    if (error?.kind === "fatal" || ++this.retries > 3) {
      this.interrupt("\u672C\u5730\u5F15\u64CE\u65E0\u6CD5\u6062\u590D\u3002\u5DF2\u4FDD\u5B58\u6587\u5B57\u4FDD\u7559\uFF1B\u672A\u786E\u8BA4\u7684\u97F3\u9891\u53EF\u80FD\u7F3A\u5931\uFF0C\u8BF7\u6838\u5BF9\u540E\u7EE7\u7EED\u3002");
      return Promise.resolve();
    }
    this.callbacks.recovering();
    this.recovery = this.open().catch(() => {
      this.interrupt("\u672C\u5730\u5F15\u64CE\u91CD\u65B0\u52A0\u8F7D\u5931\u8D25\u3002\u5DF2\u4FDD\u5B58\u6587\u5B57\u4FDD\u7559\uFF0C\u8BF7\u68C0\u67E5\u6A21\u578B\u540E\u7EE7\u7EED\u3002");
    }).finally(() => {
      this.recovery = null;
    });
    return this.recovery;
  }
  interrupt(reason) {
    if (this.closed) return;
    this.closed = true;
    this.startup.abort();
    this.connection?.close();
    this.connection = null;
    this.frames = [];
    this.callbacks.interrupted(reason);
  }
  stop() {
    if (this.finishing) return this.finishing;
    this.stopping = true;
    this.finishing = (async () => {
      await this.recovery;
      if (this.closed) throw new Error("\u672C\u5730\u8F6C\u5F55\u5DF2\u4E2D\u65AD\uFF0C\u8BF7\u6838\u5BF9\u672B\u5C3E\u5185\u5BB9");
      let connection = this.connection;
      let ok = connection ? await connection.finish(15e3) : false;
      if (!ok && !this.closed) {
        await this.reconnect();
        await this.recovery;
        connection = this.connection;
        ok = connection ? await connection.finish(15e3) : false;
      }
      this.closed = true;
      this.frames = [];
      this.startup.abort();
      this.connection?.close();
      this.connection = null;
      if (!ok) throw new Error("\u672B\u5C3E\u97F3\u9891\u672A\u786E\u8BA4\u5B8C\u6210\uFF0C\u8BF7\u6838\u5BF9\u8F6C\u5F55\u5E76\u8865\u8BB0\u7F3A\u5931\u5185\u5BB9");
    })();
    return this.finishing;
  }
  abort(reason) {
    this.interrupt(reason);
  }
};

// src/recorder.ts
var import_node_fs = __toESM(require("node:fs"));
var import_node_path = __toESM(require("node:path"));
var SAMPLE_RATE = 16e3;
var HEADER = 44;
var ID = /^[a-zA-Z0-9_-]{1,100}$/;
function recordingPath(root2, interviewId, sessionId) {
  if (!ID.test(interviewId) || !ID.test(sessionId)) throw new Error("Invalid recording id");
  return import_node_path.default.join(root2, interviewId, `${sessionId}.wav`);
}
function header(dataBytes) {
  const h = Buffer.alloc(HEADER);
  h.write("RIFF", 0, "ascii");
  h.writeUInt32LE(36 + dataBytes, 4);
  h.write("WAVE", 8, "ascii");
  h.write("fmt ", 12, "ascii");
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(SAMPLE_RATE, 24);
  h.writeUInt32LE(SAMPLE_RATE * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36, "ascii");
  h.writeUInt32LE(dataBytes, 40);
  return h;
}
var WavRecorder = class _WavRecorder {
  fd;
  bytes = 0;
  lastHeader = Date.now();
  file;
  constructor(file, fd) {
    this.file = file;
    this.fd = fd;
  }
  static create(root2, interviewId, sessionId) {
    const file = recordingPath(root2, interviewId, sessionId);
    import_node_fs.default.mkdirSync(import_node_path.default.dirname(file), { recursive: true, mode: 448 });
    const fd = import_node_fs.default.openSync(file, "wx", 384);
    import_node_fs.default.writeSync(fd, header(0), 0, HEADER, 0);
    return new _WavRecorder(file, fd);
  }
  get durationMs() {
    return this.bytes / 2 / SAMPLE_RATE * 1e3;
  }
  write(pcm) {
    if (this.fd === null) return;
    import_node_fs.default.writeSync(this.fd, pcm, 0, pcm.byteLength, HEADER + this.bytes);
    this.bytes += pcm.byteLength;
    if (Date.now() - this.lastHeader > 5e3) this.refreshHeader();
  }
  refreshHeader() {
    if (this.fd === null) return;
    import_node_fs.default.writeSync(this.fd, header(this.bytes), 0, HEADER, 0);
    this.lastHeader = Date.now();
  }
  close() {
    if (this.fd === null) return;
    try {
      this.refreshHeader();
      import_node_fs.default.fsyncSync(this.fd);
    } finally {
      import_node_fs.default.closeSync(this.fd);
      this.fd = null;
    }
  }
};
function readClip(root2, interviewId, sessionId, startMs, endMs, maxMs = 18e4) {
  const file = recordingPath(root2, interviewId, sessionId);
  const size = import_node_fs.default.statSync(file).size;
  const available = Math.max(0, size - HEADER);
  const toByte = (ms) => Math.min(available, Math.max(0, Math.floor(ms / 1e3 * SAMPLE_RATE)) * 2);
  const from = toByte(startMs);
  const to = Math.min(toByte(endMs), from + Math.floor(maxMs / 1e3 * SAMPLE_RATE) * 2);
  const length = Math.max(0, to - from);
  const out = Buffer.alloc(HEADER + length);
  header(length).copy(out, 0);
  if (length) {
    const fd = import_node_fs.default.openSync(file, "r");
    try {
      import_node_fs.default.readSync(fd, out, HEADER, length, HEADER + from);
    } finally {
      import_node_fs.default.closeSync(fd);
    }
  }
  return out;
}

// src/diagnostics.ts
var import_node_fs2 = __toESM(require("node:fs"));
var import_node_path2 = __toESM(require("node:path"));
var import_node_os = __toESM(require("node:os"));
var MAX_BYTES = 5 * 1024 * 1024;
var KEEP_DAYS = 14;
var DiagnosticLog = class {
  dir;
  tail = [];
  written = 0;
  day = "";
  constructor(dir) {
    this.dir = dir;
    try {
      import_node_fs2.default.mkdirSync(dir, { recursive: true, mode: 448 });
      const cutoff = Date.now() - KEEP_DAYS * 864e5;
      for (const name of import_node_fs2.default.readdirSync(dir)) {
        if (!/^meetfolio-\d{4}-\d{2}-\d{2}\.log$/.test(name)) continue;
        const file = import_node_path2.default.join(dir, name);
        if (import_node_fs2.default.statSync(file).mtimeMs < cutoff) import_node_fs2.default.rmSync(file, { force: true });
      }
    } catch {
    }
  }
  get directory() {
    return this.dir;
  }
  file() {
    const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      try {
        this.written = import_node_fs2.default.statSync(import_node_path2.default.join(this.dir, `meetfolio-${today}.log`)).size;
      } catch {
        this.written = 0;
      }
    }
    return import_node_path2.default.join(this.dir, `meetfolio-${today}.log`);
  }
  write(level, event, detail) {
    let extra = "";
    if (detail !== void 0) {
      try {
        extra = " " + (typeof detail === "string" ? detail : JSON.stringify(detail));
      } catch {
        extra = " [unserialisable]";
      }
    }
    const line = `${(/* @__PURE__ */ new Date()).toISOString()} ${level.toUpperCase()} ${event}${extra.slice(0, 2e3)}`;
    this.tail.push(line);
    if (this.tail.length > 400) this.tail.splice(0, this.tail.length - 400);
    try {
      const file = this.file();
      if (this.written > MAX_BYTES) return;
      import_node_fs2.default.appendFileSync(file, line + "\n", { mode: 384 });
      this.written += Buffer.byteLength(line) + 1;
    } catch {
    }
  }
  info(event, detail) {
    this.write("info", event, detail);
  }
  warn(event, detail) {
    this.write("warn", event, detail);
  }
  error(event, detail) {
    this.write("error", event, detail);
  }
  report(extra) {
    const head = {
      app: "Meetfolio",
      ...extra,
      platform: `${process.platform} ${import_node_os.default.release()} ${process.arch}`,
      cpus: import_node_os.default.cpus().length,
      cpuModel: import_node_os.default.cpus()[0]?.model ?? "unknown",
      memoryGB: +(import_node_os.default.totalmem() / 1073741824).toFixed(1),
      freeMemoryGB: +(import_node_os.default.freemem() / 1073741824).toFixed(1),
      generatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    return ["# Meetfolio \u8BCA\u65AD\u4FE1\u606F\uFF08\u4E0D\u542B\u8F6C\u5F55\u6587\u5B57\u6216\u5F55\u97F3\uFF09", JSON.stringify(head, null, 2), "", "## \u6700\u8FD1\u65E5\u5FD7", ...this.tail.slice(-200)].join("\n");
  }
};

// src/policy.ts
var CHANNEL = {
  status: "meetfolio:model-status",
  download: "meetfolio:model-download",
  cancel: "meetfolio:model-cancel",
  import: "meetfolio:model-import",
  repair: "meetfolio:model-repair",
  permission: "meetfolio:microphone",
  start: "meetfolio:transcription-start",
  audio: "meetfolio:pcm",
  stop: "meetfolio:transcription-stop",
  parseReference: "meetfolio:parse-reference",
  pdf: "meetfolio:export-pdf",
  save: "meetfolio:save-export",
  event: "meetfolio:runtime-event",
  closeReady: "meetfolio:close-ready",
  clip: "meetfolio:audio-clip",
  log: "meetfolio:log",
  diagnostics: "meetfolio:diagnostics",
  openRecordings: "meetfolio:open-recordings",
  openLogs: "meetfolio:open-logs",
  capabilities: "meetfolio:capabilities"
};
var RECORD_ID = /^[a-zA-Z0-9_-]{1,100}$/;
function validStart(value) {
  if (value === void 0) return true;
  if (!value || typeof value !== "object") return false;
  const v = value;
  return v.interviewId === null || typeof v.interviewId === "string" && RECORD_ID.test(v.interviewId);
}
function validClip(value) {
  if (!value || typeof value !== "object") return false;
  const v = value;
  return typeof v.interviewId === "string" && RECORD_ID.test(v.interviewId) && typeof v.sessionId === "string" && RECORD_ID.test(v.sessionId) && typeof v.startMs === "number" && typeof v.endMs === "number" && Number.isFinite(v.startMs) && Number.isFinite(v.endMs) && v.startMs >= 0 && v.endMs > v.startMs && v.endMs - v.startMs <= 18e4;
}
function validLog(value) {
  if (!value || typeof value !== "object") return false;
  const v = value;
  if (!["info", "warn", "error"].includes(v.level) || typeof v.event !== "string" || !/^[a-z0-9._-]{1,60}$/.test(v.event)) return false;
  if (v.detail === void 0) return true;
  try {
    return JSON.stringify(v.detail).length <= 2e3;
  } catch {
    return false;
  }
}
function validInterviewId(value) {
  return typeof value === "string" && RECORD_ID.test(value);
}
function isAppUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "meetfolio:" && url.hostname === "app" && !url.username && !url.password && !url.port;
  } catch {
    return false;
  }
}
function validSession(value) {
  return typeof value === "string" && /^[a-f0-9-]{36}$/.test(value);
}
function validAudio(value) {
  if (!value || typeof value !== "object") return false;
  const data = value;
  return validSession(data.id) && data.pcm instanceof Uint8Array && data.pcm.byteLength > 0 && data.pcm.byteLength <= 32e3 && data.pcm.byteLength % 2 === 0;
}
function validExport(value) {
  if (!value || typeof value !== "object") return false;
  const data = value;
  return typeof data.name === "string" && data.name.length <= 200 && /^[a-zA-Z0-9_-]+\.(txt|md|docx|json|pdf)$/.test(data.name) && data.bytes instanceof Uint8Array && data.bytes.byteLength > 0 && data.bytes.byteLength <= 32 * 1024 * 1024;
}
function validReference(value) {
  if (!value || typeof value !== "object") return false;
  const v = value;
  return typeof v.name === "string" && v.name.length <= 200 && /\.(pdf|docx)$/i.test(v.name) && v.bytes instanceof Uint8Array && v.bytes.length > 0 && v.bytes.length <= 6 * 1024 * 1024;
}
function validPdf(value) {
  if (!value || typeof value !== "object") return false;
  const v = value;
  return typeof v.title === "string" && v.title.length <= 200 && typeof v.text === "string" && v.text.length > 0 && v.text.length <= 1e6 && typeof v.name === "string" && /^[a-zA-Z0-9_-]{1,140}\.pdf$/.test(v.name);
}

// src/main.ts
import_electron.protocol.registerSchemesAsPrivileged([{ scheme: "meetfolio", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
import_electron.app.setName("Meetfolio");
if (process.platform === "win32") import_electron.app.setAppUserModelId("org.meetfolio.desktop");
var verification = import_electron.app.commandLine.hasSwitch("verification");
if (process.platform === "win32" && process.env.LOCALAPPDATA) import_electron.app.setPath("userData", import_node_path3.default.join(process.env.LOCALAPPDATA, "Meetfolio"));
if (verification && process.env.MEETFOLIO_USER_DATA) import_electron.app.setPath("userData", import_node_path3.default.resolve(process.env.MEETFOLIO_USER_DATA));
var gotLock = import_electron.app.requestSingleInstanceLock();
var window = null;
var windowReady = false;
var model;
var recording = null;
var recorder = null;
var frameStats = { frames: 0, since: Date.now() };
var initializing = null;
var log;
var quitting = false;
var quitAllowed = false;
var closing = null;
var root = import_electron.app.isPackaged ? process.resourcesPath : import_node_path3.default.resolve(__dirname, "../..");
var ui = import_electron.app.isPackaged ? import_node_path3.default.join(root, "ui") : import_node_path3.default.join(root, "web/dist-desktop");
function trusted(event) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || !isAppUrl(event.senderFrame.url)) {
    throw new Error("Untrusted desktop frame");
  }
}
function emit(payload) {
  if (window && !window.isDestroyed()) window.webContents.send(CHANNEL.event, payload);
}
function mappedStatus(status) {
  return {
    state: status.state === "not-installed" ? "missing" : status.state === "ready" ? "installed" : status.state,
    modelId: model.model,
    offline: true,
    engineLoaded: status.state === "ready",
    downloadedBytes: status.downloadedBytes,
    totalBytes: status.totalBytes,
    detail: status.detail
  };
}
async function ensureLoaded() {
  if (initializing) {
    await initializing;
    return;
  }
  if (!["installed", "error"].includes(model.getStatus().state) || recording) return;
  if (!initializing) initializing = model.initialize().finally(() => {
    initializing = null;
  });
  await initializing;
}
function handle(channel, fn) {
  import_electron.ipcMain.handle(channel, async (event, arg) => {
    trusted(event);
    try {
      return await fn(arg);
    } catch (error) {
      if (channel !== CHANNEL.status) log?.error("ipc." + channel.replace("meetfolio:", ""), error instanceof Error ? error.message : String(error));
      throw error;
    }
  });
}
var recordingsRoot = () => import_node_path3.default.join(import_electron.app.getPath("userData"), "recordings");
function closeRecorder(reason) {
  if (!recorder) return;
  const seconds = Math.round(recorder.durationMs / 1e3);
  try {
    recorder.close();
    log.info("recording.closed", { seconds, reason });
  } catch (error) {
    log.error("recording.close-failed", String(error));
  }
  recorder = null;
}
async function boot() {
  log = new DiagnosticLog(import_node_path3.default.join(import_electron.app.getPath("userData"), "logs"));
  log.info("app.boot", { version: import_electron.app.getVersion(), electron: process.versions.electron, packaged: import_electron.app.isPackaged });
  const runtime = import_electron.app.isPackaged ? import_node_path3.default.join(root, "xasr/asr/xasrManager.js") : import_node_path3.default.join(root, "server/dist/asr/xasrManager.js");
  const { XAsrModelManager } = await import((0, import_node_url.pathToFileURL)(runtime).href);
  model = new XAsrModelManager({ root: import_node_path3.default.join(import_electron.app.getPath("userData"), "models"), fetch: import_electron.net.fetch.bind(import_electron.net) });
  let lastState = "";
  model.on("status", (status) => {
    emit({ type: "model", status: mappedStatus(status) });
    if (status.state !== lastState && status.state !== "downloading") {
      lastState = status.state;
      (status.state === "error" || status.state === "download-failed" ? log.error : log.info).call(log, "model.state", { state: status.state, detail: status.detail?.slice(0, 500) });
    }
  });
  import_electron.protocol.handle("meetfolio", async (request) => {
    const url = new URL(request.url);
    if (!isAppUrl(request.url) || request.method !== "GET") return new Response("Forbidden", { status: 403 });
    let relative;
    try {
      relative = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
    } catch {
      return new Response("Bad path", { status: 400 });
    }
    if (relative.includes("\\") || relative.includes("\0") || relative.split("/").some((part) => part === "..")) return new Response("Forbidden", { status: 403 });
    const target = import_node_path3.default.resolve(ui, relative);
    if (!target.startsWith(ui + import_node_path3.default.sep)) return new Response("Forbidden", { status: 403 });
    try {
      if (!(await import_promises.default.stat(target)).isFile()) return new Response("Not found", { status: 404 });
      const response = await import_electron.net.fetch((0, import_node_url.pathToFileURL)(target).href);
      const headers = new Headers(response.headers);
      headers.set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; media-src 'self' blob:; worker-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'none'");
      return new Response(response.body, { status: response.status, headers });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
  const ownSession = import_electron.session.defaultSession;
  ownSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(!!window && contents === window.webContents && isAppUrl(details.requestingUrl) && permission === "media" && "mediaTypes" in details && Array.isArray(details.mediaTypes) && details.mediaTypes.every((type) => type === "audio"));
  });
  ownSession.setPermissionCheckHandler((contents, permission, origin, details) => !!window && contents === window.webContents && isAppUrl(origin) && permission === "media" && (!("mediaType" in details) || details.mediaType === "audio"));
  ownSession.setDisplayMediaRequestHandler((request, callback) => {
    const url = request.frame?.url;
    const allowed = !!window && !!url && isAppUrl(url) && process.platform === "win32" && request.audioRequested;
    if (!allowed) {
      log.warn("system-audio.denied", { platform: process.platform });
      callback({});
      return;
    }
    import_electron.desktopCapturer.getSources({ types: ["screen"] }).then((sources) => {
      if (!sources.length) {
        log.warn("system-audio.no-screen-source");
        callback({});
        return;
      }
      callback({ video: sources[0], audio: "loopback" });
    }).catch((error) => {
      log.error("system-audio.failed", String(error));
      callback({});
    });
  });
  window = new import_electron.BrowserWindow({
    width: 1366,
    height: 768,
    minWidth: 900,
    minHeight: 620,
    show: false,
    icon: import_electron.app.isPackaged ? import_node_path3.default.join(root, "branding/meetfolio.png") : import_node_path3.default.join(root, "desktop/assets/meetfolio.png"),
    title: "Meetfolio",
    backgroundColor: "#f5f4ed",
    autoHideMenuBar: true,
    webPreferences: { preload: import_node_path3.default.join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true }
  });
  window.once("ready-to-show", () => {
    windowReady = true;
    if (!quitting) {
      window?.show();
      window?.focus();
    }
  });
  window.webContents.on("will-prevent-unload", (event) => {
    if (quitAllowed) event.preventDefault();
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (!isAppUrl(url)) event.preventDefault();
  });
  const interrupt = () => {
    if (recording) log.warn("session.window-reload");
    recording?.abort("\u7A97\u53E3\u91CD\u65B0\u8F7D\u5165\uFF0C\u8BED\u97F3\u8BB0\u5F55\u5DF2\u4E2D\u65AD\u3002\u8BF7\u6838\u5BF9\u5DF2\u4FDD\u5B58\u7684\u672B\u5C3E\u6587\u5B57\u3002");
    recording = null;
    closeRecorder("window-reload");
  };
  window.webContents.on("render-process-gone", interrupt);
  window.webContents.on("did-start-navigation", (_event, _url, _inPlace, mainFrame) => {
    if (mainFrame) interrupt();
  });
  handle(CHANNEL.status, async () => {
    try {
      await ensureLoaded();
    } catch {
    }
    return mappedStatus(model.getStatus());
  });
  handle(CHANNEL.download, async () => {
    if (recording) throw new Error("\u8BF7\u5148\u505C\u6B62\u8BB0\u5F55");
    await initializing;
    await model.download();
    return mappedStatus(model.getStatus());
  });
  handle(CHANNEL.cancel, () => {
    model.cancel();
  });
  handle(CHANNEL.repair, async () => {
    if (recording) throw new Error("\u8BF7\u5148\u505C\u6B62\u8BB0\u5F55");
    await initializing;
    await model.repair();
    return mappedStatus(model.getStatus());
  });
  handle(CHANNEL.import, async (arg) => {
    if (recording || arg !== void 0 && typeof arg !== "boolean") throw new Error("\u65E0\u6CD5\u5BFC\u5165\u6A21\u578B");
    const result = await import_electron.dialog.showOpenDialog(window, { title: "\u5BFC\u5165\u5B98\u65B9 X-ASR \u6A21\u578B\u538B\u7F29\u5305", properties: ["openFile"], filters: [{ name: "X-ASR tar.bz2", extensions: ["bz2"] }] });
    await initializing;
    if (!result.canceled && result.filePaths.length === 1) await model.importArchive(result.filePaths[0], { repair: arg === true });
    return mappedStatus(model.getStatus());
  });
  handle(CHANNEL.save, async (value) => {
    if (!validExport(value)) throw new Error("\u65E0\u6548\u5BFC\u51FA\u6587\u4EF6");
    const result = await import_electron.dialog.showSaveDialog(window, {
      title: "\u4FDD\u5B58\u7814\u7A76\u8BB0\u5F55",
      defaultPath: value.name,
      filters: [{ name: "Meetfolio export", extensions: [import_node_path3.default.extname(value.name).slice(1)] }],
      properties: ["showOverwriteConfirmation"]
    });
    if (result.canceled || !result.filePath) return false;
    const temporary = import_node_path3.default.join(import_node_path3.default.dirname(result.filePath), `.meetfolio-export-${(0, import_node_crypto2.randomUUID)()}.tmp`);
    try {
      await import_promises.default.writeFile(temporary, value.bytes, { mode: 384, flag: "wx" });
      await import_promises.default.rename(temporary, result.filePath);
    } finally {
      await import_promises.default.rm(temporary, { force: true });
    }
    return true;
  });
  handle(CHANNEL.parseReference, async (value) => {
    if (!validReference(value)) throw new Error("\u4EC5\u652F\u6301\u6700\u5927 6 MB \u7684 PDF / DOCX \u6587\u4EF6");
    const runtime2 = import_electron.app.isPackaged ? import_node_path3.default.join(root, "xasr/docs/extract.js") : import_node_path3.default.join(root, "server/dist/docs/extract.js");
    const { detectKind, extractText } = await import((0, import_node_url.pathToFileURL)(runtime2).href);
    const bytes = Buffer.from(value.bytes);
    const kind = detectKind(value.name, bytes);
    if (!kind || kind !== "pdf" && kind !== "docx") throw new Error("\u8D44\u6599\u683C\u5F0F\u4E0D\u5339\u914D");
    const content = await extractText(kind, bytes);
    if (!content.trim()) throw new Error("\u65E0\u6CD5\u8BFB\u53D6\u6587\u4EF6\u6587\u5B57\uFF1B\u626B\u63CF\u7248 PDF \u9700\u8981 OCR\uFF0C\u76EE\u524D\u672A\u652F\u6301");
    if (content.length > 1e5) throw new Error("\u8D44\u6599\u6587\u5B57\u8D85\u8FC7 10 \u4E07\u5B57\uFF0C\u8BF7\u5148\u63D0\u53D6\u76F8\u5173\u7AE0\u8282");
    return content;
  });
  handle(CHANNEL.pdf, async (value) => {
    if (!validPdf(value)) throw new Error("PDF \u6587\u6863\u5185\u5BB9\u65E0\u6548");
    const escaped = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const page = new import_electron.BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false } });
    try {
      const document = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
        @page{size:A4;margin:19mm 18mm}html{font-family:system-ui,'Microsoft YaHei','Noto Sans CJK SC',sans-serif;color:#28302c;font-size:11pt}
        h1{font-size:20pt;letter-spacing:-.3px;margin:0 0 16pt}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.85}
        footer{font-size:8pt;color:#777;border-top:1px solid #ddd;padding-top:9pt;margin-top:20pt}
      </style></head><body><h1>${escaped(value.title)}</h1><pre>${escaped(value.text)}</pre><footer>Meetfolio \xB7 \u7814\u7A76\u6750\u6599\uFF0C\u8BF7\u6838\u5BF9\u539F\u6587\u4E0E\u6765\u6E90</footer></body></html>`;
      await page.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(document));
      const bytes = await page.webContents.printToPDF({ printBackground: true, pageSize: "A4", preferCSSPageSize: true });
      const result = await import_electron.dialog.showSaveDialog(window, {
        title: "\u4FDD\u5B58 PDF \u7814\u7A76\u62A5\u544A",
        defaultPath: value.name,
        filters: [{ name: "PDF document", extensions: ["pdf"] }],
        properties: ["showOverwriteConfirmation"]
      });
      if (result.canceled || !result.filePath) return false;
      const temporary = import_node_path3.default.join(import_node_path3.default.dirname(result.filePath), `.meetfolio-pdf-${(0, import_node_crypto2.randomUUID)()}.tmp`);
      try {
        await import_promises.default.writeFile(temporary, bytes, { mode: 384, flag: "wx" });
        await import_promises.default.rename(temporary, result.filePath);
      } finally {
        await import_promises.default.rm(temporary, { force: true });
      }
      return true;
    } finally {
      page.destroy();
    }
  });
  handle(CHANNEL.permission, async () => {
    if (process.platform === "darwin" && !await import_electron.systemPreferences.askForMediaAccess("microphone")) {
      log.warn("mic.permission-denied-macos");
      return "denied";
    }
    return "granted";
  });
  handle(CHANNEL.capabilities, () => ({ systemAudio: process.platform === "win32", platform: process.platform }));
  handle(CHANNEL.start, async (options) => {
    if (!validStart(options)) throw new Error("\u65E0\u6548\u7684\u5F55\u97F3\u53C2\u6570");
    if (recording) throw new Error("\u5DF2\u6709\u8BB0\u5F55\u6B63\u5728\u4F7F\u7528\u9EA6\u514B\u98CE");
    await ensureLoaded();
    if (model.getStatus().state !== "ready") throw new Error("X-ASR \u6A21\u578B\u672A\u6210\u529F\u521D\u59CB\u5316\uFF1A" + (model.getStatus().detail ?? model.getStatus().state));
    const interviewId = options?.interviewId ?? null;
    const live = new NativeSession(model, {
      final: (segment) => emit({ type: "final", id: live.id, segment }),
      partial: (result) => emit({ type: "partial", id: live.id, result }),
      interrupted: (reason) => {
        log.error("session.interrupted", { reason });
        emit({ type: "interruption", id: live.id, reason });
        if (recording === live) {
          recording = null;
          closeRecorder("interrupted");
        }
      },
      recovering: () => {
        log.warn("session.recovering");
        emit({ type: "recovering", id: live.id });
      }
    });
    recording = live;
    frameStats = { frames: 0, since: Date.now() };
    try {
      await live.start();
    } catch (error) {
      log.error("session.start-failed", String(error));
      live.abort("\u672C\u5730\u5F15\u64CE\u542F\u52A8\u5931\u8D25");
      recording = null;
      throw error;
    }
    let recordingId = null;
    if (interviewId) {
      try {
        recorder = WavRecorder.create(recordingsRoot(), interviewId, live.id);
        recordingId = live.id;
      } catch (error) {
        log.error("recording.create-failed", String(error));
        recorder = null;
      }
    }
    log.info("session.started", { test: !interviewId, recording: !!recordingId });
    return { id: live.id, recordingId };
  });
  import_electron.ipcMain.on(CHANNEL.audio, (event, packet) => {
    try {
      trusted(event);
      if (!validAudio(packet) || !recording || packet.id !== recording.id) return;
      if (recorder) {
        try {
          recorder.write(packet.pcm);
        } catch (error) {
          log.error("recording.write-failed", String(error));
          closeRecorder("write-failed");
          emit({ type: "recording-failed", id: recording.id });
        }
      }
      frameStats.frames++;
      if (Date.now() - frameStats.since > 3e4) {
        log.info("session.frames", { frames: frameStats.frames, seconds: Math.round((Date.now() - frameStats.since) / 1e3) });
        frameStats = { frames: 0, since: Date.now() };
      }
      recording.send(packet.pcm);
    } catch {
    }
  });
  handle(CHANNEL.stop, async (id) => {
    if (!validSession(id)) throw new Error("\u65E0\u6548\u8BB0\u5F55\u4F1A\u8BDD");
    const live = recording;
    if (!live || live.id !== id) return;
    try {
      await live.stop();
    } finally {
      if (recording === live) recording = null;
      closeRecorder("stopped");
    }
    log.info("session.stopped");
    if (!quitting) await ensureLoaded();
  });
  handle(CHANNEL.clip, async (value) => {
    if (!validClip(value)) throw new Error("\u65E0\u6548\u7684\u56DE\u653E\u8303\u56F4");
    const bytes = readClip(recordingsRoot(), value.interviewId, value.sessionId, value.startMs, value.endMs);
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  });
  handle(CHANNEL.log, (value) => {
    if (validLog(value)) log.write(value.level, "ui." + value.event, value.detail);
  });
  handle(CHANNEL.diagnostics, () => log.report({
    version: import_electron.app.getVersion(),
    electron: process.versions.electron,
    model: { state: model.getStatus().state, detail: model.getStatus().detail?.slice(0, 500) },
    recording: !!recording
  }));
  handle(CHANNEL.openRecordings, async (interviewId) => {
    const dir = validInterviewId(interviewId) ? import_node_path3.default.join(recordingsRoot(), interviewId) : recordingsRoot();
    (0, import_node_fs3.mkdirSync)(dir, { recursive: true, mode: 448 });
    const error = await import_electron.shell.openPath(dir);
    if (error) throw new Error(error);
  });
  handle(CHANNEL.openLogs, async () => {
    const error = await import_electron.shell.openPath(log.directory);
    if (error) throw new Error(error);
  });
  window.on("close", (event) => {
    if (quitAllowed) return;
    event.preventDefault();
    setImmediate(() => {
      if (!quitting) import_electron.app.quit();
    });
  });
  import_electron.ipcMain.on(CHANNEL.closeReady, (event, value) => {
    try {
      trusted(event);
      if (closing && value?.id === closing.id && typeof value.ok === "boolean") closing.resolve(value.ok);
    } catch {
    }
  });
  await window.loadURL("meetfolio://app/");
}
if (!gotLock) import_electron.app.quit();
else {
  import_electron.app.on("second-instance", () => {
    if (window && windowReady && !quitting) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    }
  });
  import_electron.app.whenReady().then(boot).catch((error) => {
    console.error("Desktop startup failed:", error);
    import_electron.app.exit(1);
  });
  import_electron.app.on("window-all-closed", () => import_electron.app.quit());
  import_electron.app.on("before-quit", (event) => {
    if (quitAllowed) return;
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    void (async () => {
      const saved = window && !window.isDestroyed() ? await new Promise((resolve) => {
        const id = (0, import_node_crypto2.randomUUID)();
        const retry = setInterval(() => emit({ type: "prepare-close", id }), 250);
        const timer = setTimeout(() => {
          clearInterval(retry);
          closing = null;
          resolve(false);
        }, 6e4);
        closing = { id, resolve: (ok) => {
          clearTimeout(timer);
          clearInterval(retry);
          closing = null;
          resolve(ok);
        } };
        emit({ type: "prepare-close", id });
      }) : true;
      if (!saved && window && !window.isDestroyed()) {
        const result = await import_electron.dialog.showMessageBox(window, {
          type: "warning",
          title: "\u672B\u5C3E\u5185\u5BB9\u5C1A\u672A\u786E\u8BA4\u4FDD\u5B58",
          message: "\u8BF7\u8FD4\u56DE\u5E94\u7528\u6838\u5BF9\u8F6C\u5F55\u5E76\u5BFC\u51FA\u5907\u4EFD\u3002\u5F3A\u5236\u9000\u51FA\u53EF\u80FD\u4E22\u5931\u6700\u540E\u7684\u6587\u5B57\u6216\u7B14\u8BB0\u3002",
          buttons: ["\u8FD4\u56DE\u5E94\u7528", "\u4ECD\u7136\u9000\u51FA"],
          defaultId: 0,
          cancelId: 0
        });
        if (result.response === 0) {
          quitting = false;
          return;
        }
      }
      await recording?.stop().catch(() => {
      });
      closeRecorder("quit");
      log?.info("app.quit");
      await model?.dispose();
      quitAllowed = true;
      import_electron.app.quit();
    })();
  });
}
