import { newInterview, questionsFromGuide, type Interview } from './model';
import { uuid } from '../lib/format';
export function syntheticInterview(): Interview {
  const i = newInterview();
  const lines = [
    [
      1087000,
      'Interviewer',
      'You said you help your father take his medicine every morning. Could you describe the routine?',
    ],
    [
      1094000,
      'Participant P07',
      'I usually get up at six. He sometimes resists his medicine, so I prepare breakfast first. I am occasionally late for work.',
    ],
    [1109000, 'Interviewer', 'So your caregiving routine affects your work schedule?'],
    [
      1115000,
      'Participant P07',
      'Yes. It is not only physically tiring. I keep worrying about home, even at night.',
    ],
    [
      1121000,
      'Participant P07',
      'If there is an unexpected meeting at work, I ask my sister to help, but she has her own family too.',
    ],
  ] as const;
  const guide =
    'How is caregiving arranged in your family?\nWhat is the hardest part of day-to-day caregiving?\nWhat help can family or friends offer?\nHave you used community or social services?\nWhat additional support would be useful?';
  return {
    ...i,
    title: 'Family caregiver interview',
    participant: 'P07',
    synthetic: true,
    guide,
    questions: questionsFromGuide(guide, []).map((q, n) => ({
      ...q,
      done: n < 2,
    })),
    elapsedMs: 1122000,
    segments: lines.map(([startMs, speakerLabel, originalText], n) => ({
      id: uuid(),
      seq: n + 1,
      startMs,
      endMs: startMs + 5000,
      speakerLabel,
      originalText,
      editedText: null,
      isImportant: n === 1 || n === 3,
      source: 'demo',
      updatedAt: i.createdAt,
    })),
    notes: [
      {
        id: uuid(),
        category: 'observation',
        content:
          'Participant slowed down when describing the morning routine. Ask whether this relates to fatigue.',
        timestampMs: 1095000,
        isImportant: false,
        createdAt: i.createdAt,
        updatedAt: i.createdAt,
      },
      {
        id: uuid(),
        category: 'finding',
        content: 'Tension between employment and caregiving might be an important research theme.',
        timestampMs: 1116000,
        isImportant: false,
        createdAt: i.createdAt,
        updatedAt: i.createdAt,
      },
    ],
  };
}
