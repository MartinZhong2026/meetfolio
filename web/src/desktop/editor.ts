import type { Interview, Stage } from './model';
import type { Segment } from '../lib/types';
import type { useLocalRuntime } from './useLocalRuntime';
export interface EditorProps {
  i: Interview;
  save: (change: Partial<Interview>) => void;
  setMessage: (text: string) => void;
}
export type Runtime = ReturnType<typeof useLocalRuntime>;
export interface SegmentEditorProps {
  segmentChange: (s: Segment) => void;
}
export interface PreparationProps extends EditorProps {
  runtime: Runtime;
  go: (stage: Stage) => void;
  create: (synthetic?: boolean) => void;
  interviewCount: number;
}
export interface LiveProps extends EditorProps, SegmentEditorProps {
  runtime: Runtime;
  finish: () => Promise<void>;
  patch: (id: string, change: (i: Interview) => Interview) => void;
  openSettings: () => void;
}
export interface ReviewProps extends EditorProps, SegmentEditorProps {
  doExport: (format: 'txt' | 'md' | 'docx') => Promise<void>;
  exporting: boolean;
}
export function jump(target: string) {
  const el = document.getElementById(target);
  el?.focus();
  el?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
}
