import { app, BrowserWindow, ipcMain, session, protocol, net, dialog, systemPreferences } from 'electron';
import type { IpcMainInvokeEvent, IpcMainEvent } from 'electron';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs/promises';
import type { XAsrModelManager, XAsrStatus } from '../../server/src/asr/xasrManager.js';
import { NativeSession } from './native-session.js';
import { CHANNEL, isAppUrl, validAudio, validSession, validExport } from './policy.js';
import { Diagnostics, asrDiagnostic } from './diagnostics.js';

protocol.registerSchemesAsPrivileged([{ scheme: 'meetfolio', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
app.setName('Meetfolio');
if (process.platform === 'win32') app.setAppUserModelId('org.meetfolio.desktop');
const verification = app.commandLine.hasSwitch('verification');
if (process.platform === 'win32' && process.env.LOCALAPPDATA) app.setPath('userData', path.join(process.env.LOCALAPPDATA, 'Meetfolio'));
if (verification && process.env.MEETFOLIO_USER_DATA) app.setPath('userData', path.resolve(process.env.MEETFOLIO_USER_DATA));
const diagnostics = new Diagnostics(path.join(app.getPath('userData'), 'diagnostics'), !app.isPackaged);
const gotLock = app.requestSingleInstanceLock();
let window: BrowserWindow | null = null;
let windowReady = false;
let model: XAsrModelManager;
let recording: NativeSession | null = null;
let starting = false;
let initializing: Promise<void> | null = null;
let microphoneUntil = 0;
let quitting = false;
let quitAllowed = false;
let closing: { id: string; resolve: (ok: boolean) => void } | null = null;
const root = app.isPackaged ? process.resourcesPath : path.resolve(__dirname, '../..');
const ui = app.isPackaged ? path.join(root, 'ui') : path.join(root, 'web/dist-desktop');
function trusted(event: IpcMainEvent | IpcMainInvokeEvent): void {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || !isAppUrl(event.senderFrame.url)) {
    throw new Error('Untrusted desktop frame');
  }
}
function emit(payload: object): void { if (window && !window.isDestroyed()) window.webContents.send(CHANNEL.event, payload); }
function mappedStatus(status: Readonly<XAsrStatus>) {
  return { state: status.state === 'not-installed' ? 'missing' : status.state === 'ready' ? 'installed' : status.state,
    modelId: model.model, offline: true, engineLoaded: status.state === 'ready',
    downloadedBytes: status.downloadedBytes, totalBytes: status.totalBytes, detail: status.detail };
}
async function ensureLoaded(): Promise<void> {
  if (initializing) { await initializing; return; }
  if (!['installed', 'error'].includes(model.getStatus().state) || recording) return;
  if (!initializing) initializing = model.initialize().finally(() => { initializing = null; });
  await initializing;
}
function handle(channel: string, fn: (arg: unknown) => unknown) {
  ipcMain.handle(channel, async (event, arg) => {
    try {
      trusted(event);
      if (channel !== CHANNEL.import && channel !== CHANNEL.save && channel !== CHANNEL.stop && arg !== undefined) throw new Error('Unexpected IPC argument');
    } catch (error) { diagnostics.record('ipc_error'); throw error; }
    try { return await fn(arg); }
    catch (error) {
      if (channel === CHANNEL.start) diagnostics.record('native_init');
      else if (channel === CHANNEL.stop) diagnostics.record('cleanup_failure');
      else if (channel === CHANNEL.permission) diagnostics.record('microphone_permission');
      else if (channel !== CHANNEL.save) diagnostics.record('model_load');
      throw error;
    }
  });
}
async function boot(): Promise<void> {
  const runtime = app.isPackaged ? path.join(root, 'xasr/asr/xasrManager.js') : path.join(root, 'server/dist/asr/xasrManager.js');
  // Keep the verified engine and all adjacent native modules on the real filesystem, outside ASAR.
  const { XAsrModelManager } = await import(pathToFileURL(runtime).href);
  model = new XAsrModelManager({ root: path.join(app.getPath('userData'), 'models'), fetch: net.fetch.bind(net) });
  model.on('status', status => { if (status.state === 'error') diagnostics.record('model_load'); emit({ type: 'model', status: mappedStatus(status) }); });
  protocol.handle('meetfolio', async request => {
    const url = new URL(request.url);
    if (!isAppUrl(request.url) || request.method !== 'GET') return new Response('Forbidden', { status: 403 });
    let relative: string;
    try { relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html'; } catch { return new Response('Bad path', { status: 400 }); }
    if (relative.includes('\\') || relative.includes('\0') || relative.split('/').some(part => part === '..')) return new Response('Forbidden', { status: 403 });
    const target = path.resolve(ui, relative);
    if (!target.startsWith(ui + path.sep)) return new Response('Forbidden', { status: 403 });
    try {
      if (!(await fs.stat(target)).isFile()) return new Response('Not found', { status: 404 });
      const response = await net.fetch(pathToFileURL(target).href);
      const headers = new Headers(response.headers);
      headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; media-src 'self' blob:; worker-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'none'");
      return new Response(response.body, { status: response.status, headers });
    } catch { return new Response('Not found', { status: 404 }); }
  });
  const ownSession = session.defaultSession;
  ownSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(!!window && contents === window.webContents && isAppUrl(details.requestingUrl) && permission === 'media' &&
      Date.now() < microphoneUntil && 'mediaTypes' in details && Array.isArray(details.mediaTypes) && details.mediaTypes.every((type: string) => type === 'audio'));
  });
  ownSession.setPermissionCheckHandler((contents, permission, origin, details) =>
    !!window && contents === window.webContents && isAppUrl(origin) && permission === 'media' &&
    Date.now() < microphoneUntil && (!('mediaType' in details) || details.mediaType === 'audio'));
  window = new BrowserWindow({ width: 1366, height: 768, minWidth: 900, minHeight: 620, show: false,
    icon: app.isPackaged ? path.join(root, 'branding/meetfolio.png') : path.join(root, 'desktop/assets/meetfolio.png'),
    title: 'Meetfolio', backgroundColor: '#f5f4ed', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true },
  });
  window.once('ready-to-show', () => { windowReady = true; if (!quitting && !verification) { window?.show(); window?.focus(); } });
  window.webContents.on('will-prevent-unload', event => {
    // The browser-only dirty guard can lag React's state update after the durable close flush.
    // Override it only after the host confirmed persistence, or the user explicitly chose Exit.
    if (quitAllowed) event.preventDefault();
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (!isAppUrl(url)) event.preventDefault(); });
  const interrupt = () => { recording?.abort('窗口重新载入，语音记录已中断。请核对已保存的末尾文字。'); recording = null; };
  window.webContents.on('render-process-gone', () => { diagnostics.record('child_exit'); interrupt(); });
  window.webContents.on('did-start-navigation', (_event, _url, _inPlace, mainFrame) => { if (mainFrame) interrupt(); });
  handle(CHANNEL.status, async () => { try { await ensureLoaded(); } catch {} return mappedStatus(model.getStatus()); });
  handle(CHANNEL.download, async () => { if (recording) throw new Error('请先停止记录'); await initializing; await model.download(); return mappedStatus(model.getStatus()); });
  handle(CHANNEL.cancel, () => { model.cancel(); });
  handle(CHANNEL.repair, async () => { if (recording) throw new Error('请先停止记录'); await initializing; await model.repair(); return mappedStatus(model.getStatus()); });
  handle(CHANNEL.import, async arg => {
    if (recording || (arg !== undefined && typeof arg !== 'boolean')) throw new Error('无法导入模型');
    const result = await dialog.showOpenDialog(window!, { title: '导入官方 X-ASR 模型压缩包', properties: ['openFile'], filters: [{ name: 'X-ASR tar.bz2', extensions: ['bz2'] }] });
    await initializing;
    if (!result.canceled && result.filePaths.length === 1) await model.importArchive(result.filePaths[0], { repair: arg === true });
    return mappedStatus(model.getStatus());
  });
  handle(CHANNEL.save, async value => {
    if (!validExport(value)) throw new Error('无效导出文件');
    const result = await dialog.showSaveDialog(window!, { title: '保存研究记录', defaultPath: value.name,
      filters: [{ name: 'Meetfolio export', extensions: [path.extname(value.name).slice(1)] }], properties: ['showOverwriteConfirmation'] });
    if (result.canceled || !result.filePath) return false;
    const temporary = path.join(path.dirname(result.filePath), `.meetfolio-export-${randomUUID()}.tmp`);
    try { await fs.writeFile(temporary, value.bytes, { mode: 0o600, flag: 'wx' }); await fs.rename(temporary, result.filePath); }
    finally { await fs.rm(temporary, { force: true }); }
    return true;
  });
  handle(CHANNEL.permission, async () => {
    microphoneUntil = Date.now() + 60000;
    if (process.platform === 'darwin' && !(await systemPreferences.askForMediaAccess('microphone'))) return 'denied';
    // Chromium's actual getUserMedia result is authoritative on Windows/Linux, including virtual devices.
    // The preload never returns Granted until it has successfully opened and released a real MediaStream.
    return 'granted';
  });
  handle(CHANNEL.start, async () => {
    if (recording || starting) throw new Error('A microphone session is already starting or active');
    if (Date.now() >= microphoneUntil) throw new Error('Request microphone permission before starting');
    starting = true;
    try {
    await ensureLoaded();
    if (model.getStatus().state !== 'ready') throw new Error('X-ASR 模型未成功初始化');
    const live = new NativeSession(model, {
      final: segment => emit({ type: 'final', id: live.id, segment }),
      partial: result => emit({ type: 'partial', id: live.id, result }),
      interrupted: reason => { emit({ type: 'interruption', id: live.id, reason }); if (recording === live) recording = null; },
      recovering: () => emit({ type: 'recovering', id: live.id }),
      diagnostic: code => diagnostics.record(asrDiagnostic(code)),
    });
    recording = live;
    try { await live.start(); return live.id; } catch (error) { live.abort('本地引擎启动失败'); recording = null; throw error; }
    } finally { starting = false; }
  });
  ipcMain.on(CHANNEL.diagnostic, (event, code: unknown) => {
    try { trusted(event); if (code === 'microphone_permission' || code === 'audio_capture' || code === 'ipc_error' || code === 'cleanup_failure') diagnostics.record(code); }
    catch { diagnostics.record('ipc_error'); }
  });
  ipcMain.on(CHANNEL.audio, (event, packet: unknown) => {
    try {
      trusted(event);
      if (!validAudio(packet) || !recording || packet.id !== recording.id) { diagnostics.record('ipc_error'); return; }
      recording.send(packet.pcm);
    } catch { diagnostics.record('ipc_error'); /* Invalid/unowned packets never reach the engine. */ }
  });
  handle(CHANNEL.stop, async id => {
    if (!validSession(id)) throw new Error('无效记录会话');
    const live = recording;
    if (!live || live.id !== id) return;
    try { await live.stop(); } finally { if (recording === live) recording = null; }
    // Remain ready for pause/resume only after another successful native initialization.
    if (!quitting) await ensureLoaded();
  });
  window.on('close', event => {
    if (quitAllowed) return;
    event.preventDefault();
    // Leave the native close dispatch before starting the asynchronous save/quit handshake.
    // Re-entering app.quit here can leave the Windows window in a pending-close state.
    setImmediate(() => { if (!quitting) app.quit(); });
  });
  ipcMain.on(CHANNEL.closeReady, (event, value) => {
    try { trusted(event); if (closing && value?.id === closing.id && typeof value.ok === 'boolean') closing.resolve(value.ok); } catch {}
  });
  await window.loadURL('meetfolio://app/');
}
if (!gotLock) app.quit();
else {
  app.on('second-instance', () => { if (window && windowReady && !quitting && !verification) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.whenReady().then(boot).catch(async () => { diagnostics.record('startup'); await diagnostics.flush(); console.error('Meetfolio startup failed; inspect the private diagnostics log'); app.exit(1); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', event => {
    if (quitAllowed) return;
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    void (async () => {
      const saved = window && !window.isDestroyed() ? await new Promise<boolean>(resolve => {
        const id = randomUUID();
        // An immediate post-launch close can precede preload/React readiness. Retrying delivery
        // is safe: preload deduplicates the request and acknowledges the same completed flush.
        const retry = setInterval(() => emit({ type: 'prepare-close', id }), 250);
        const timer = setTimeout(() => { clearInterval(retry); closing = null; resolve(false); }, 60000);
        closing = { id, resolve: ok => { clearTimeout(timer); clearInterval(retry); closing = null; resolve(ok); } };
        emit({ type: 'prepare-close', id });
      }) : true;
      if (!saved && window && !window.isDestroyed()) {
        const result = await dialog.showMessageBox(window, { type: 'warning', title: '末尾内容尚未确认保存',
          message: '请返回应用核对转录并导出备份。强制退出可能丢失最后的文字或笔记。',
          buttons: ['返回应用', '仍然退出'], defaultId: 0, cancelId: 0 });
        if (result.response === 0) { quitting = false; return; }
      }
      await recording?.stop().catch(() => { diagnostics.record('cleanup_failure'); });
      try { await model?.dispose(); } catch { diagnostics.record('cleanup_failure'); }
      diagnostics.record('shutdown', 'info');
      await diagnostics.flush();
      quitAllowed = true;
      app.quit();
    })();
  });
}
