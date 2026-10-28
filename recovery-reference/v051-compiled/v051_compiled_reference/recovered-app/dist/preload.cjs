"use strict";

// src/preload.ts
var import_electron = require("electron");

// ../web/src/audio/desktopCapture.ts
var AudioInputError = class extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
};
var RECOVERY_DELAYS_MS = [300, 700, 1500, 2500, 4e3, 6e3];
async function listMicrophones() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const inputs = devices.filter((d) => d.kind === "audioinput");
  const seen = /* @__PURE__ */ new Set();
  const result = [];
  for (const d of inputs) {
    if (d.deviceId === "communications") continue;
    const isDefault = d.deviceId === "default";
    const label = (d.label || "\u9EA6\u514B\u98CE").replace(/^Default - |^默认 - /, "");
    const key = isDefault ? "default" : d.groupId + label;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ deviceId: d.deviceId, label: isDefault ? `\u7CFB\u7EDF\u9ED8\u8BA4\uFF08${label}\uFF09` : label, isDefault });
  }
  return result;
}
function rmsOf(analyser, buffer) {
  analyser.getFloatTimeDomainData(buffer);
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
  return Math.sqrt(sum / buffer.length);
}
var AudioInput = class {
  ctx = null;
  node = null;
  sink = null;
  mic = null;
  sys = null;
  levelTimer = null;
  flushed = null;
  stopped = false;
  recovering = false;
  opts = {};
  events = {};
  onDeviceChange = () => {
    void this.checkDevicePresent();
  };
  micLabel = "";
  contextRate = 0;
  systemActive = false;
  async start(opts, events) {
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === "undefined") throw new AudioInputError("unsupported", "\u5F53\u524D\u8FD0\u884C\u73AF\u5883\u4E0D\u652F\u6301\u9EA6\u514B\u98CE\u91C7\u96C6");
    this.opts = opts;
    this.events = events;
    const stream = await this.openMic(opts.deviceId ?? null);
    try {
      await this.buildGraph(stream, true);
    } catch (error) {
      await this.teardownGraph();
      try {
        await this.buildGraph(stream, false);
      } catch (second) {
        stream.getTracks().forEach((t) => t.stop());
        throw second instanceof Error ? second : error;
      }
    }
    if (opts.systemAudio) await this.attachSystemAudio();
    navigator.mediaDevices.addEventListener("devicechange", this.onDeviceChange);
    const buffer = new Float32Array(2048);
    this.levelTimer = setInterval(() => {
      if (!this.ctx) return;
      this.events.onLevel?.({
        mic: this.mic && !this.recovering ? rmsOf(this.mic.analyser, buffer) : 0,
        system: this.sys ? rmsOf(this.sys.analyser, buffer) : null
      });
    }, 100);
  }
  async openMic(deviceId) {
    const audio = {
      channelCount: { ideal: 1 },
      // Echo cancellation would also suppress a participant's voice played through speakers when
      // system audio is captured separately; quality is better with headphones and AEC off.
      echoCancellation: false,
      noiseSuppression: true,
      autoGainControl: true
    };
    if (deviceId && deviceId !== "default") audio.deviceId = { exact: deviceId };
    try {
      return await navigator.mediaDevices.getUserMedia({ audio, video: false });
    } catch (e) {
      const name = e.name;
      if (name === "NotAllowedError" || name === "SecurityError") throw new AudioInputError("denied", "\u6CA1\u6709\u9EA6\u514B\u98CE\u6743\u9650\u3002Windows\uFF1A\u8BBE\u7F6E \u2192 \u9690\u79C1\u548C\u5B89\u5168\u6027 \u2192 \u9EA6\u514B\u98CE\uFF0C\u6253\u5F00\u201C\u5141\u8BB8\u684C\u9762\u5E94\u7528\u8BBF\u95EE\u9EA6\u514B\u98CE\u201D\u3002");
      if (name === "NotFoundError" || name === "OverconstrainedError") throw new AudioInputError("no_device", deviceId ? "\u627E\u4E0D\u5230\u6240\u9009\u9EA6\u514B\u98CE\uFF0C\u53EF\u80FD\u5DF2\u62D4\u51FA\u3002\u8BF7\u91CD\u65B0\u9009\u62E9\u8BBE\u5907\u3002" : "\u6CA1\u6709\u627E\u5230\u53EF\u7528\u7684\u9EA6\u514B\u98CE\u3002");
      throw new AudioInputError("busy", `\u65E0\u6CD5\u6253\u5F00\u9EA6\u514B\u98CE\uFF08${name || "\u672A\u77E5\u9519\u8BEF"}\uFF09\uFF0C\u53EF\u80FD\u6B63\u88AB\u5176\u4ED6\u7A0B\u5E8F\u72EC\u5360\u3002\u8BF7\u5173\u95ED\u5176\u4ED6\u5F55\u97F3\u8F6F\u4EF6\u540E\u91CD\u8BD5\u3002`);
    }
  }
  async buildGraph(stream, at16k) {
    const ctx = at16k ? new AudioContext({ sampleRate: 16e3, latencyHint: "interactive" }) : new AudioContext({ latencyHint: "interactive" });
    this.ctx = ctx;
    this.contextRate = ctx.sampleRate;
    if (ctx.state === "suspended") await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 1500))]);
    ctx.addEventListener("statechange", () => {
      if (this.ctx === ctx && ctx.state === "suspended" && !this.stopped) void ctx.resume().catch(() => {
      });
    });
    await ctx.audioWorklet.addModule("/pcm-worklet.js");
    const node = new AudioWorkletNode(ctx, "pcm-downsampler", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: "explicit", channelInterpretation: "speakers" });
    node.port.onmessage = (ev) => {
      if (ev.data.pcm) this.events.onFrame?.(new Int16Array(ev.data.pcm), ev.data.rms ?? 0);
      if (ev.data.flushed) this.flushed?.();
    };
    const sink = ctx.createGain();
    sink.gain.value = 0;
    node.connect(sink).connect(ctx.destination);
    this.node = node;
    this.sink = sink;
    this.attachMic(stream);
  }
  attachMic(stream) {
    const ctx = this.ctx;
    const source = ctx.createMediaStreamSource(stream);
    const gain = ctx.createGain();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(gain).connect(this.node);
    source.connect(analyser);
    this.mic = { stream, source, gain, analyser };
    const track = stream.getAudioTracks()[0];
    this.micLabel = track?.label ?? "";
    track?.addEventListener("ended", () => {
      if (this.mic?.stream === stream) void this.recoverMic("\u8BBE\u5907\u5DF2\u65AD\u5F00\u6216\u88AB\u5176\u4ED6\u7A0B\u5E8F\u5360\u7528");
    });
  }
  detachMic() {
    if (!this.mic) return;
    try {
      this.mic.source.disconnect();
      this.mic.gain.disconnect();
    } catch {
    }
    this.mic.stream.getTracks().forEach((t) => t.stop());
    this.mic = null;
  }
  async checkDevicePresent() {
    if (!this.mic || this.recovering || this.stopped) return;
    const track = this.mic.stream.getAudioTracks()[0];
    if (!track || track.readyState === "ended") {
      void this.recoverMic("\u8BBE\u5907\u5DF2\u65AD\u5F00");
      return;
    }
    const id = track.getSettings().deviceId;
    if (!id) return;
    const present = (await navigator.mediaDevices.enumerateDevices()).some((d) => d.kind === "audioinput" && d.deviceId === id);
    if (!present) void this.recoverMic("\u8BBE\u5907\u5DF2\u79FB\u9664");
  }
  async recoverMic(detail) {
    if (this.recovering || this.stopped) return;
    this.recovering = true;
    this.events.onDevice?.({ type: "mic-lost", detail });
    this.detachMic();
    const preferred = this.opts.deviceId ?? null;
    for (const delay of RECOVERY_DELAYS_MS) {
      await new Promise((r) => setTimeout(r, delay));
      if (this.stopped) return;
      for (const candidate of preferred ? [preferred, null] : [null]) {
        try {
          const stream = await this.openMic(candidate);
          if (this.stopped || !this.ctx) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          this.attachMic(stream);
          this.recovering = false;
          this.events.onDevice?.({ type: "mic-recovered", label: this.micLabel, fallbackToDefault: !!preferred && candidate === null });
          return;
        } catch {
        }
      }
    }
    this.recovering = false;
    this.events.onFatal?.(`\u9EA6\u514B\u98CE\u65AD\u5F00\u540E 15 \u79D2\u5185\u672A\u80FD\u91CD\u65B0\u8FDE\u63A5\uFF08${detail}\uFF09\u3002\u5DF2\u786E\u8BA4\u7684\u6587\u5B57\u548C\u5F55\u97F3\u5DF2\u4FDD\u5B58\u3002\u8BF7\u68C0\u67E5\u8BBE\u5907\u540E\u70B9\u201C\u7EE7\u7EED\u8F6C\u5F55\u201D\u3002`);
  }
  async attachSystemAudio() {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
      stream.getVideoTracks().forEach((t) => t.stop());
      const track = stream.getAudioTracks()[0];
      if (!track) {
        stream.getTracks().forEach((t) => t.stop());
        throw new Error("\u7CFB\u7EDF\u6CA1\u6709\u63D0\u4F9B\u7535\u8111\u58F0\u97F3");
      }
      const ctx = this.ctx;
      const source = ctx.createMediaStreamSource(stream);
      const gain = ctx.createGain();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(gain).connect(this.node);
      source.connect(analyser);
      this.sys = { stream, source, gain, analyser };
      this.systemActive = true;
      track.addEventListener("ended", () => {
        if (this.sys?.stream !== stream) return;
        try {
          source.disconnect();
          gain.disconnect();
        } catch {
        }
        this.sys = null;
        this.systemActive = false;
        this.events.onDevice?.({ type: "system-lost" });
      });
    } catch (error) {
      this.systemActive = false;
      this.events.onDevice?.({ type: "system-unavailable", detail: error instanceof Error ? error.message : String(error) });
    }
  }
  async teardownGraph() {
    try {
      this.node?.disconnect();
      this.sink?.disconnect();
    } catch {
    }
    if (this.mic) {
      try {
        this.mic.source.disconnect();
      } catch {
      }
    }
    this.mic = null;
    this.node = null;
    this.sink = null;
    await this.ctx?.close().catch(() => {
    });
    this.ctx = null;
  }
  async stop() {
    if (this.stopped) return;
    this.stopped = true;
    navigator.mediaDevices.removeEventListener("devicechange", this.onDeviceChange);
    if (this.levelTimer) clearInterval(this.levelTimer);
    this.levelTimer = null;
    if (this.node && this.ctx?.state === "running") {
      await new Promise((resolve) => {
        const timeout = setTimeout(resolve, 500);
        this.flushed = () => {
          clearTimeout(timeout);
          resolve();
        };
        this.node.port.postMessage({ type: "flush" });
      });
      this.flushed = null;
    }
    this.node?.port.close();
    this.detachMic();
    if (this.sys) {
      try {
        this.sys.source.disconnect();
      } catch {
      }
      this.sys.stream.getTracks().forEach((t) => t.stop());
      this.sys = null;
    }
    await this.teardownGraph();
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

// src/close-request.ts
function createCloseRequestHandler(ready, flush, reply) {
  let current = null;
  return (id) => {
    if (current?.id === id) {
      if (current.done) reply(id, current.ok);
      return;
    }
    if (!ready()) return;
    const request = { id, done: false, ok: false };
    current = request;
    void Promise.resolve().then(flush).then((ok) => {
      request.done = true;
      request.ok = ok;
      reply(id, ok);
    }, () => {
      request.done = true;
      reply(id, false);
    });
  };
}

// src/preload.ts
var active = null;
var preview = null;
var flushNotebook = null;
var listeners = /* @__PURE__ */ new Set();
var prepareClose = createCloseRequestHandler(() => flushNotebook !== null, async () => {
  let ok = true;
  try {
    await active?.stop();
  } catch {
    ok = false;
  }
  try {
    ok = await flushNotebook?.() === true && ok;
  } catch {
    ok = false;
  }
  return ok;
}, (id, ok) => import_electron.ipcRenderer.send(CHANNEL.closeReady, { id, ok }));
import_electron.ipcRenderer.on(CHANNEL.event, (_event, message) => {
  if (message?.type === "prepare-close" && typeof message.id === "string") prepareClose(message.id);
  else for (const listener of listeners) listener(message);
});
var invoke = (channel, arg) => import_electron.ipcRenderer.invoke(channel, arg);
var cleanError = (error) => new Error(String(error instanceof Error ? error.message : error).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
var log = (level, event, detail) => {
  void invoke(CHANNEL.log, { level, event, detail }).catch(() => {
  });
};
var captureOptions = (o) => ({ deviceId: o?.deviceId ?? null, systemAudio: !!o?.systemAudio });
var runtime = {
  version: 1,
  saveExport: (name, bytes) => invoke(CHANNEL.save, { name, bytes }),
  parseReference: (name, bytes) => invoke(CHANNEL.parseReference, { name, bytes }),
  exportPdf: (title, text, name) => invoke(CHANNEL.pdf, { title, text, name }),
  onBeforeClose: (handler) => {
    flushNotebook = handler;
    return () => {
      if (flushNotebook === handler) flushNotebook = null;
    };
  },
  getModelStatus: () => invoke(CHANNEL.status),
  subscribeModelStatus: (callback) => {
    const listener = (event) => {
      if (event?.type === "model") callback(event.status);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  downloadModel: async (progress) => {
    const listener = (event) => {
      if (event?.type === "model") progress(event.status);
    };
    listeners.add(listener);
    try {
      await invoke(CHANNEL.download);
    } finally {
      listeners.delete(listener);
    }
  },
  cancelDownload: () => invoke(CHANNEL.cancel),
  importModel: async (repair) => {
    await invoke(CHANNEL.import, repair ?? false);
  },
  repairModel: async (progress) => {
    const listener = (event) => {
      if (event?.type === "model") progress(event.status);
    };
    listeners.add(listener);
    try {
      await invoke(CHANNEL.repair);
    } finally {
      listeners.delete(listener);
    }
  },
  requestMicrophonePermission: async () => {
    const permission = await invoke(CHANNEL.permission);
    if (permission !== "granted") return permission;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      return "granted";
    } catch (error) {
      log("warn", "mic.permission-check-failed", error.name);
      return error.name === "NotAllowedError" ? "denied" : "unavailable";
    }
  },
  getCapabilities: () => invoke(CHANNEL.capabilities),
  listMicrophones: () => listMicrophones(),
  startPreview: async (options, onLevel, onDevice) => {
    await preview?.stop().catch(() => {
    });
    const input = new AudioInput();
    preview = input;
    await input.start(captureOptions(options), { onLevel, onDevice });
    return {
      micLabel: input.micLabel,
      systemActive: input.systemActive,
      stop: async () => {
        await input.stop();
        if (preview === input) preview = null;
      }
    };
  },
  startTranscription: async (options, callbacks) => {
    if (active) throw new Error("\u9EA6\u514B\u98CE\u6B63\u5728\u4F7F\u7528\u4E2D");
    await preview?.stop().catch(() => {
    });
    preview = null;
    const input = new AudioInput();
    const early = [];
    let id = null;
    let stopped = null;
    let silentFrames = 0;
    const toBytes = (pcm) => new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    const session = { id: null, input, stop: async () => {
    } };
    const listener = (event) => {
      if (!id || event?.id !== id) return;
      if (event.type === "final") callbacks.onSegment(event.segment);
      else if (event.type === "partial") callbacks.onPartial?.(event.result);
      else if (event.type === "recovering") callbacks.onRecovering?.();
      else if (event.type === "recording-failed") callbacks.onRecordingFailed?.();
      else if (event.type === "interruption") {
        void input.stop().catch(() => {
        });
        listeners.delete(listener);
        if (active === session) active = null;
        callbacks.onInterruption(event.reason);
      }
    };
    const stop = () => {
      if (stopped) return stopped;
      stopped = (async () => {
        await input.stop();
        try {
          if (id) await invoke(CHANNEL.stop, id);
        } catch (error) {
          throw cleanError(error);
        } finally {
          listeners.delete(listener);
          if (active === session) active = null;
        }
      })();
      return stopped;
    };
    session.stop = stop;
    active = session;
    try {
      await input.start(captureOptions(options), {
        onFrame: (pcm, rms) => {
          silentFrames = rms < 5e-4 ? silentFrames + 1 : 0;
          if (silentFrames === 300) log("warn", "capture.digital-silence-30s");
          if (id) import_electron.ipcRenderer.send(CHANNEL.audio, { id, pcm: toBytes(pcm) });
          else if (early.length < 100) early.push(new Uint8Array(toBytes(pcm)));
        },
        onLevel: (levels) => callbacks.onLevel?.(levels),
        onDevice: (event) => {
          log(event.type === "mic-recovered" ? "info" : "warn", "capture." + event.type, "detail" in event ? event.detail : void 0);
          callbacks.onDevice?.(event);
        },
        onFatal: (reason) => {
          log("error", "capture.fatal", reason);
          void stop().catch(() => {
          }).finally(() => callbacks.onInterruption(reason));
        }
      });
      log("info", "capture.started", { contextRate: input.contextRate, systemAudio: input.systemActive, requestedSystem: !!options?.systemAudio, chosenDevice: !!options?.deviceId });
      const started = await invoke(CHANNEL.start, { interviewId: options?.interviewId ?? null }).catch((error) => {
        throw cleanError(error);
      });
      id = started.id;
      session.id = id;
      listeners.add(listener);
      for (const pcm of early.splice(0)) import_electron.ipcRenderer.send(CHANNEL.audio, { id, pcm });
      return { stop, recordingId: started.recordingId, micLabel: input.micLabel, systemActive: input.systemActive, contextRate: input.contextRate };
    } catch (error) {
      await stop().catch(() => {
      });
      if (active === session) active = null;
      throw error instanceof Error ? error : new Error(String(error));
    }
  },
  getAudioClip: (interviewId, sessionId, startMs, endMs) => invoke(CHANNEL.clip, { interviewId, sessionId, startMs, endMs }),
  openRecordingsFolder: async (interviewId) => {
    await invoke(CHANNEL.openRecordings, interviewId);
  },
  openLogsFolder: async () => {
    await invoke(CHANNEL.openLogs);
  },
  getDiagnostics: () => invoke(CHANNEL.diagnostics),
  log
};
import_electron.contextBridge.exposeInMainWorld("meetfolioDesktop", runtime);
