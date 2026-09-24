/**
 * ジェスチャー用の棒人形 8 種（three.js を使わない暫定版）。
 * 座標は viewBox 0 0 360 520。頭は円、体は関節を結ぶ折れ線。
 */

export interface Pt {
  x: number;
  y: number;
}

export interface MannequinPose {
  id: string;
  label: string;
  head: Pt;
  headR: number;
  /** 折れ線（背骨・腕・脚・肩・腰） */
  lines: Pt[][];
}

const p = (x: number, y: number): Pt => ({ x, y });

export const MANNEQUIN_POSES: MannequinPose[] = [
  {
    id: 'front',
    label: '正面',
    head: p(180, 70),
    headR: 32,
    lines: [
      [p(180, 102), p(180, 150), p(180, 270)],
      [p(130, 150), p(230, 150)],
      [p(145, 270), p(215, 270)],
      [p(130, 150), p(112, 220), p(104, 290)],
      [p(230, 150), p(248, 220), p(256, 290)],
      [p(150, 270), p(146, 370), p(142, 470)],
      [p(210, 270), p(214, 370), p(218, 470)],
    ],
  },
  {
    id: 'three-quarter',
    label: '斜め',
    head: p(196, 72),
    headR: 30,
    lines: [
      [p(190, 102), p(186, 150), p(176, 272)],
      [p(150, 146), p(222, 154)],
      [p(152, 268), p(202, 276)],
      [p(150, 146), p(138, 218), p(142, 286)],
      [p(222, 154), p(238, 222), p(236, 292)],
      [p(158, 272), p(160, 372), p(150, 470)],
      [p(198, 276), p(212, 374), p(214, 468)],
    ],
  },
  {
    id: 'walk',
    label: '歩き',
    head: p(188, 68),
    headR: 30,
    lines: [
      [p(186, 98), p(182, 148), p(178, 268)],
      [p(146, 148), p(216, 150)],
      [p(152, 266), p(204, 270)],
      [p(146, 148), p(170, 214), p(200, 262)],
      [p(216, 150), p(196, 218), p(166, 262)],
      [p(160, 268), p(122, 360), p(96, 452)],
      [p(198, 270), p(224, 366), p(262, 454)],
    ],
  },
  {
    id: 'run',
    label: '走り',
    head: p(214, 74),
    headR: 29,
    lines: [
      [p(206, 102), p(192, 150), p(166, 262)],
      [p(166, 146), p(226, 156)],
      [p(146, 258), p(190, 268)],
      [p(166, 146), p(134, 196), p(156, 238)],
      [p(226, 156), p(270, 196), p(296, 166)],
      [p(152, 262), p(92, 318), p(52, 296)],
      [p(186, 268), p(236, 350), p(214, 452)],
    ],
  },
  {
    id: 'sit',
    label: '座り',
    head: p(150, 128),
    headR: 30,
    lines: [
      [p(152, 158), p(154, 204), p(160, 318)],
      [p(118, 202), p(190, 206)],
      [p(136, 316), p(186, 320)],
      [p(118, 202), p(122, 270), p(172, 300)],
      [p(190, 206), p(208, 270), p(232, 306)],
      [p(146, 318), p(250, 330), p(254, 456)],
      [p(178, 320), p(276, 340), p(290, 462)],
    ],
  },
  {
    id: 'reach',
    label: '手を上げる',
    head: p(180, 110),
    headR: 30,
    lines: [
      [p(180, 140), p(180, 186), p(182, 300)],
      [p(140, 186), p(220, 186)],
      [p(150, 298), p(214, 300)],
      [p(140, 186), p(118, 118), p(104, 42)],
      [p(220, 186), p(246, 250), p(262, 312)],
      [p(156, 300), p(150, 390), p(148, 480)],
      [p(208, 300), p(216, 390), p(222, 480)],
    ],
  },
  {
    id: 'crouch',
    label: 'かがむ',
    head: p(226, 170),
    headR: 29,
    lines: [
      [p(214, 196), p(190, 236), p(138, 308)],
      [p(170, 224), p(226, 250)],
      [p(122, 300), p(158, 316)],
      [p(170, 224), p(196, 300), p(236, 356)],
      [p(226, 250), p(250, 316), p(268, 372)],
      [p(130, 306), p(214, 360), p(172, 452)],
      [p(152, 314), p(250, 392), p(232, 462)],
    ],
  },
  {
    id: 'look-back',
    label: '振り返り',
    head: p(166, 70),
    headR: 30,
    lines: [
      [p(172, 100), p(180, 150), p(186, 270)],
      [p(142, 156), p(214, 146)],
      [p(158, 272), p(212, 268)],
      [p(142, 156), p(128, 222), p(140, 286)],
      [p(214, 146), p(240, 206), p(226, 270)],
      [p(166, 272), p(160, 372), p(162, 470)],
      [p(206, 268), p(222, 366), p(232, 466)],
    ],
  },
];

export const POSE_VIEWBOX = { width: 360, height: 520 };

export function poseAt(i: number): MannequinPose {
  return MANNEQUIN_POSES[((i % MANNEQUIN_POSES.length) + MANNEQUIN_POSES.length) % MANNEQUIN_POSES.length]!;
}

/** ポーズの外接矩形（見比べの「重ねる」で自分の線を合わせる基準） */
export function poseBounds(pose: MannequinPose): { x: number; y: number; w: number; h: number } {
  let x0 = pose.head.x - pose.headR;
  let y0 = pose.head.y - pose.headR;
  let x1 = pose.head.x + pose.headR;
  let y1 = pose.head.y + pose.headR;
  for (const l of pose.lines) {
    for (const q of l) {
      x0 = Math.min(x0, q.x);
      y0 = Math.min(y0, q.y);
      x1 = Math.max(x1, q.x);
      y1 = Math.max(y1, q.y);
    }
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
