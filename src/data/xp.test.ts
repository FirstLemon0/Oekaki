import { describe, expect, it } from 'vitest';
import { levelForXp, xpForDrillScore, xpForEvent, xpThresholdForLevel } from './xp';

describe('xpForEvent', () => {
  it('固定量のイベント', () => {
    expect(xpForEvent('lesson')).toBe(10);
    expect(xpForEvent('checkpoint')).toBe(20);
    expect(xpForEvent('graduation')).toBe(30);
  });

  it('ドリルは点数帯で1〜5', () => {
    expect(xpForDrillScore(0)).toBe(1);
    expect(xpForDrillScore(39)).toBe(1);
    expect(xpForDrillScore(40)).toBe(2);
    expect(xpForDrillScore(59)).toBe(2);
    expect(xpForDrillScore(60)).toBe(3);
    expect(xpForDrillScore(74)).toBe(3);
    expect(xpForDrillScore(75)).toBe(4);
    expect(xpForDrillScore(89)).toBe(4);
    expect(xpForDrillScore(90)).toBe(5);
    expect(xpForDrillScore(100)).toBe(5);
  });

  it('xpForEvent(drill) は xpForDrillScore と一致する', () => {
    expect(xpForEvent('drill', 95)).toBe(5);
    expect(xpForEvent('drill')).toBe(1); // スコア省略時は0点扱い
  });
});

describe('levelForXp', () => {
  it('レベル境界: floor(sqrt(xp/50))+1', () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(49)).toBe(1);
    expect(levelForXp(50)).toBe(2);
    expect(levelForXp(199)).toBe(2);
    expect(levelForXp(200)).toBe(3);
    expect(levelForXp(449)).toBe(3);
    expect(levelForXp(450)).toBe(4);
  });

  it('負の xp が来ても壊れない', () => {
    expect(levelForXp(-100)).toBe(1);
  });

  it('xpThresholdForLevel と levelForXp が整合する', () => {
    for (let level = 1; level <= 10; level += 1) {
      const threshold = xpThresholdForLevel(level);
      expect(levelForXp(threshold)).toBe(level);
      if (threshold > 0) {
        expect(levelForXp(threshold - 1)).toBe(level - 1);
      }
    }
  });
});
