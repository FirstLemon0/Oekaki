/** 描画再生のスケジューラ（純関数）。 */
import type { Drawing } from '@/scoring/types';

export interface ReplaySchedule {
  /** 各ストローク各点の表示時刻（再生開始からの ms、単調非減少） */
  times: number[][];
  /** 全体の長さ ms */
  total: number;
}

export interface ReplayScheduleOptions {
  /** 倍速。1 = 実時間。0 以下・非数は 1 とみなす */
  speed: number;
  /** ストローク間の待ち時間の上限（実時間 ms、speed で割る前）。既定 400 */
  maxGapMs?: number;
  /** ストローク内の点間隔の上限（実時間 ms）。既定 200（止まって考えた時間を詰める） */
  maxPointGapMs?: number;
}

/**
 * ストロークの t に従って各点の表示時刻を決める。
 * t が減少・非数の場合は 0 間隔として扱う（保存データの時刻が壊れていても再生できる）。
 */
export function buildReplaySchedule(drawing: Drawing, opts: ReplayScheduleOptions): ReplaySchedule {
  const speed = opts.speed > 0 && Number.isFinite(opts.speed) ? opts.speed : 1;
  const maxGap = opts.maxGapMs ?? 400;
  const maxPointGap = opts.maxPointGapMs ?? 200;
  const times: number[][] = [];
  let clock = 0;
  let prevT: number | null = null;
  for (const stroke of drawing) {
    const row: number[] = [];
    stroke.forEach((pt, i) => {
      const raw = prevT === null || !Number.isFinite(pt.t) ? 0 : pt.t - prevT;
      const cap = i === 0 ? maxGap : maxPointGap;
      const dt = Math.min(cap, Math.max(0, raw));
      clock += dt / speed;
      row.push(clock);
      if (Number.isFinite(pt.t)) prevT = pt.t;
    });
    times.push(row);
  }
  return { times, total: clock };
}

/** 経過時間 elapsed ms の時点で、各ストロークの何点目まで見えているか（点の個数）。 */
export function visibleCounts(schedule: ReplaySchedule, elapsed: number): number[] {
  return schedule.times.map((row) => {
    let lo = 0;
    let hi = row.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (row[m]! <= elapsed) lo = m + 1;
      else hi = m;
    }
    return lo;
  });
}
