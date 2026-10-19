import { describe, expect, it } from 'vitest';
import { DB_BLOCKED_MESSAGE, DB_BLOCKING_MESSAGE, DB_NEWER_MESSAGE, dbEventMessage, dbLoadErrorMessage } from './dbNotice';

describe('dbNotice', () => {
  it('blocked / blocking / terminated に案内を出す', () => {
    expect(dbEventMessage({ type: 'blocked', newVersion: 2 })).toBe(DB_BLOCKED_MESSAGE);
    expect(dbEventMessage({ type: 'blocking', newVersion: 3 })).toBe(DB_BLOCKING_MESSAGE);
    expect(dbEventMessage({ type: 'terminated', newVersion: null })).toMatch(/再読み込み/);
  });
  it('VersionError は「新しい版がある」の案内、それ以外は従来の文言', () => {
    expect(dbLoadErrorMessage(new DOMException('x', 'VersionError'))).toBe(DB_NEWER_MESSAGE);
    expect(dbLoadErrorMessage(new Error('壊れた'))).toBe('データを読み込めませんでした: 壊れた');
  });
});
