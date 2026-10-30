import type { Segment } from '../lib/types';
export type ModelStatus = {
  state: 'missing' | 'downloading' | 'download-failed' | 'installed' | 'loading' | 'error';
  detail?: string;
  modelId: string;
  offline: true;
  engineLoaded?: boolean;
  downloadedBytes?: number;
  totalBytes?: number;
};
export interface LocalSession {
  stop(): Promise<void>;
}
export interface RecordingInfo {
  id: string;
  interviewId: string;
  createdAt: string;
  durationMs: number;
  bytes: number;
  status: 'complete' | 'interrupted' | 'recording';
  recoverable: boolean;
  unavailable?: boolean;
}
// Optional native preload contract. This UI build ships no native engine or model.
export interface DesktopRuntime {
  version: 1;
  saveExport?(name: string, bytes: Uint8Array): Promise<boolean>;
  onBeforeClose?(handler: () => Promise<boolean>): () => void;
  listRecordings?(): Promise<RecordingInfo[]>;
  recoverRecording?(id: string): Promise<RecordingInfo>;
  exportRecording?(id: string): Promise<boolean>;
  preparePlayback?(value: { interviewId: string; recordingId: string; startMs: number; endMs: number }): Promise<{ token: string; url: string; durationMs: number }>;
  releasePlayback?(token: string): Promise<void>;
  getModelStatus(): Promise<ModelStatus>;
  subscribeModelStatus?(listener: (status: ModelStatus) => void): () => void;
  downloadModel?(onProgress: (status: ModelStatus) => void): Promise<void>;
  cancelDownload?(): Promise<void>;
  importModel?(repair?: boolean): Promise<void>;
  repairModel?(onProgress: (status: ModelStatus) => void): Promise<void>;
  requestMicrophonePermission(): Promise<'granted' | 'denied' | 'unavailable'>;
  startTranscription(callbacks: {
    onSegment(segment: Segment): void;
    onInterruption(reason: string): void;
    onPartial?(result: { key: string; text: string; startMs: number }): void;
    onRecovering?(): void;
  }, options?: { interviewId: string }): Promise<LocalSession>;
}
declare global {
  interface Window {
    meetfolioDesktop?: DesktopRuntime;
  }
}
export function localRuntime(): DesktopRuntime | null {
  const r = window.meetfolioDesktop;
  return r?.version === 1 &&
    typeof r.getModelStatus === 'function' &&
    typeof r.requestMicrophonePermission === 'function' &&
    typeof r.startTranscription === 'function'
    ? r
    : null;
}
export function confirmedModel(value: ModelStatus): boolean {
  return (
    value.state === 'installed' &&
    value.offline === true &&
    value.engineLoaded === true &&
    typeof value.modelId === 'string' &&
    value.modelId.trim().length > 0
  );
}
