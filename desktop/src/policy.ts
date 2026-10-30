export const APP_ORIGIN = 'meetfolio://app';
export const CHANNEL = {
  status: 'meetfolio:model-status', download: 'meetfolio:model-download', cancel: 'meetfolio:model-cancel',
  import: 'meetfolio:model-import', repair: 'meetfolio:model-repair', permission: 'meetfolio:microphone',
  start: 'meetfolio:transcription-start', audio: 'meetfolio:pcm', stop: 'meetfolio:transcription-stop',
  save: 'meetfolio:save-export', event: 'meetfolio:runtime-event', closeReady: 'meetfolio:close-ready',
  diagnostic: 'meetfolio:diagnostic',
  recordings: 'meetfolio:recordings', recoverRecording: 'meetfolio:recording-recover', exportRecording: 'meetfolio:recording-export',
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
