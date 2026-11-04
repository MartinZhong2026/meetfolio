import { describe, expect, it } from 'vitest';
import { translate, zhCN } from './language';

describe('Meetfolio UI language', () => {
  it('keeps English as the stable default and supplies Chinese UI translations', () => {
    expect(translate('My interviews', 'en')).toBe('My interviews');
    expect(translate('My interviews', 'zh-CN')).toBe('我的访谈');
    expect(translate('Review & export', 'zh-CN')).toBe('复核与导出');
    expect(translate('Transcribe recording', 'zh-CN')).toBe('转录录音');
    expect(translate('Speaker management', 'zh-CN')).toBe('说话人管理');
  });
  it('does not mutate or translate original user text, speaker names, file names or recorded content', () => {
    const original = '1104和Danny对话 — I usually get up at six.';
    expect(translate(original, 'zh-CN')).toBe(original);
    expect(translate('Speaker 1 — Daniel', 'zh-CN')).toBe('Speaker 1 — Daniel');
  });
  it('keeps parameter substitutions as display-only strings', () => {
    expect(translate('{count} turns', 'en', { count: 2 })).toBe('2 turns');
    expect(translate('My interviews', 'zh-CN')).not.toEqual(translate('My interviews', 'en'));
    expect(zhCN['Interface language']).toBe('界面语言');
  });
});
