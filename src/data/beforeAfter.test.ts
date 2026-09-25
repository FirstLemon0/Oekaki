import { describe, expect, it } from 'vitest';
import { monthlyPromptDue } from './beforeAfter';
import type { Profile } from './types';

function profile(overrides: Partial<Profile>): Profile {
  return {
    startedAt: '2026-01-01',
    beforeDrawingId: null,
    beforeCreatedAt: null,
    afterDrawingId: null,
    calibration: null,
    lastMonthlyPromptAt: null,
    critiqueAttemptsByDay: {},
    unlockedLessonIds: [],
    reviewSkippedOn: {},
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('monthlyPromptDue', () => {
  it('Before が無ければ通知しない', () => {
    expect(monthlyPromptDue(profile({}), '2026-06-01')).toBe(false);
  });

  it('Before から30日未満なら通知しない', () => {
    const p = profile({ beforeCreatedAt: '2026-01-01' });
    expect(monthlyPromptDue(p, '2026-01-29')).toBe(false);
  });

  it('Before からちょうど30日経ったら通知する', () => {
    const p = profile({ beforeCreatedAt: '2026-01-01' });
    expect(monthlyPromptDue(p, '2026-01-31')).toBe(true);
  });

  it('前回通知日があれば、そこから30日で次の通知が起点になる', () => {
    const p = profile({ beforeCreatedAt: '2026-01-01', lastMonthlyPromptAt: '2026-01-31' });
    expect(monthlyPromptDue(p, '2026-02-20')).toBe(false);
    expect(monthlyPromptDue(p, '2026-03-02')).toBe(true);
  });
});
