import type { NoteCategory } from '../lib/types';
export const NOTE_CATEGORIES: Array<{ value: NoteCategory; label: string; hint: string }> = [
  { value: 'general', label: 'General note', hint: 'Take notes freely' },
  { value: 'quote', label: 'Participant quote', hint: 'What the participant actually said' },
  { value: 'observation', label: 'Observation', hint: 'Setting, expression, context' },
  { value: 'finding', label: 'Finding', hint: 'Potentially important evidence' },
  { value: 'followup', label: 'Follow-up question', hint: 'What to ask later' },
  { value: 'todo', label: 'To-do', hint: 'Next steps after the interview' },
];
export const noteCategoryLabel = (c: NoteCategory) => NOTE_CATEGORIES.find(x => x.value === c)?.label ?? c;
