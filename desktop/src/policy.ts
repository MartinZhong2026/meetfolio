export const APP_ORIGIN = 'meetfolio://app';
export const CHANNEL = {
  status: 'meetfolio:model-status', download: 'meetfolio:model-download', cancel: 'meetfolio:model-cancel',
  import: 'meetfolio:model-import', repair: 'meetfolio:model-repair', permission: 'meetfolio:microphone',
  start: 'meetfolio:transcription-start', audio: 'meetfolio:pcm', stop: 'meetfolio:transcription-stop',
  save: 'meetfolio:save-export', event: 'meetfolio:runtime-event', closeReady: 'meetfolio:close-ready',
  diagnostic: 'meetfolio:diagnostic',
  recordings: 'meetfolio:recordings', recoverRecording: 'meetfolio:recording-recover', exportRecording: 'meetfolio:recording-export',
  preparePlayback: 'meetfolio:playback-prepare', releasePlayback: 'meetfolio:playback-release',
  importBegin: 'meetfolio:import-begin', importAppend: 'meetfolio:import-append', importFinish: 'meetfolio:import-finish', importCancel: 'meetfolio:import-cancel', importRecover: 'meetfolio:import-recover',
  speakerStatus: 'meetfolio:speaker-status', speakerInstall: 'meetfolio:speaker-install', speakerImport: 'meetfolio:speaker-import', speakerCancel: 'meetfolio:speaker-cancel',
  decoderStatus: 'meetfolio:decoder-status', decoderInstall: 'meetfolio:decoder-install', decoderImport: 'meetfolio:decoder-import', decoderCancel: 'meetfolio:decoder-cancel',
  selectAudio: 'meetfolio:audio-select', importFile: 'meetfolio:import-file', importResume: 'meetfolio:import-resume', importTasks: 'meetfolio:import-tasks',
} as const;
export function isAppUrl(value: string): boolean {
  try { const url = new URL(value); return url.protocol === 'meetfolio:' && url.hostname === 'app' && !url.username && !url.password && !url.port; }
  catch { return false; }
}
export function validSession(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
}
export function validInterview(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
}
export interface PlaybackRequest { interviewId: string; recordingId: string; startMs: number; endMs: number }
export function validPlayback(value: unknown): value is PlaybackRequest {
  if (!value || typeof value !== 'object') return false;
  const v = value as PlaybackRequest;
  return validInterview(v.interviewId) && validSession(v.recordingId) &&
    Number.isFinite(v.startMs) && Number.isFinite(v.endMs) && v.startMs >= 0 &&
    v.endMs > v.startMs && v.endMs <= 0xffffffff / 32;
}
export function validStart(value: unknown): value is { interviewId: string } {
  return !!value && typeof value === 'object' && validInterview((value as { interviewId?: unknown }).interviewId);
}
export function validStop(value: unknown): value is string | { id: string; interrupted: true } {
  return validSession(value) || (!!value && typeof value === 'object' &&
    validSession((value as { id?: unknown }).id) && (value as { interrupted?: unknown }).interrupted === true);
}
export function validAudio(value: unknown): value is { id: string; pcm: Uint8Array } {
  if (!value || typeof value !== 'object') return false;
  const data = value as { id: unknown; pcm: unknown };
  return validSession(data.id) && data.pcm instanceof Uint8Array && data.pcm.byteLength > 0 &&
    data.pcm.byteLength <= 32000 && data.pcm.byteLength % 2 === 0;
}

export function validExport(value: unknown): value is { name: string; bytes: Uint8Array } {
  if (!value || typeof value !== 'object') return false;
  const data = value as { name: unknown; bytes: unknown };
  return typeof data.name === 'string' && data.name.length <= 200 && /^[a-zA-Z0-9_-]+\.(txt|md|docx|json)$/.test(data.name) &&
    data.bytes instanceof Uint8Array && data.bytes.byteLength > 0 && data.bytes.byteLength <= 32 * 1024 * 1024;
}
