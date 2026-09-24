/**
 * 批評応答のスキーマ。
 * - CRITIQUE_JSON_SCHEMA: 構造化出力（output_config.format）に渡す JSON Schema
 * - CritiqueBodySchema:   受け取った JSON の zod 検証
 *
 * 数値スコアのフィールドは意図的に存在しない（DESIGN.md §5.2）。
 * 構造化出力の JSON Schema は minItems/maxItems の対応が限られるため、
 * 件数の上限は zod 側で切り詰め、下限は zod で検証する。
 */
import { z } from 'zod';

const nonEmpty = z.string().trim().min(1);

export const CritiqueIssueSchema = z.object({
  where: nonEmpty,
  what: nonEmpty,
  fix: nonEmpty,
});

export const CritiqueBodySchema = z.object({
  /** 良い点 2〜3（1 件でも受け入れ、4 件以上は先頭 3 件） */
  good: z
    .array(nonEmpty)
    .min(1)
    .transform((a) => a.slice(0, 3)),
  /** 直す点 0〜3（4 件以上は先頭 3 件） */
  issues: z.array(CritiqueIssueSchema).transform((a) => a.slice(0, 3)),
  next_one: nonEmpty,
  encourage: nonEmpty,
});

export type CritiqueBody = z.infer<typeof CritiqueBodySchema>;

const str = (description: string) => ({ type: 'string', description });

export const CRITIQUE_JSON_SCHEMA: { [key: string]: unknown } = {
  type: 'object',
  properties: {
    good: {
      type: 'array',
      description: '良い点を 2〜3 個。絵のどこが良いかを具体的に。',
      items: str('良い点 1 つ（1〜2 文）'),
    },
    issues: {
      type: 'array',
      description: '直す点を最大 3 個。無ければ空配列。',
      items: {
        type: 'object',
        properties: {
          where: str('絵のどこか（例: 左目のまわり）'),
          what: str('何が起きているか（評価語を使わず事実で）'),
          fix: str('どう直すか（初心者が今日できる具体策）'),
        },
        required: ['where', 'what', 'fix'],
        additionalProperties: false,
      },
    },
    next_one: str('次にやる 1 つ（ルーブリックの focus を重視）'),
    encourage: str('励ましの一言（1 文）'),
  },
  required: ['good', 'issues', 'next_one', 'encourage'],
  additionalProperties: false,
};
