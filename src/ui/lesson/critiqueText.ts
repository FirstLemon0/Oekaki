/**
 * 批評のエラー文言（純データ）。
 * rate_limited（API 側の一時的な制限）は「少し待ってからもう一度」、
 * daily_limit（アプリの 1 日の上限）は「明日また」で区別する。
 */
import type { CriticErrorKind } from '@/critic';

export const ERROR_TEXT: Record<CriticErrorKind, { title: string; body: string }> = {
  no_api_key: {
    title: 'API キーを確かめましょう',
    body: 'キーが未設定か、使えないキーでした。設定の「AI 批評」でキーを入れ直してから、もう一度送りましょう。',
  },
  daily_limit: {
    title: '今日の分は使い切りました',
    body: '設定の「1日の上限回数」に達しました。明日また見てもらいましょう。絵は保存してあります。',
  },
  rate_limited: {
    title: '少し待ってからもう一度',
    body: 'AI の窓口が一時的に混み合っています。1〜2分おいてから、もう一度送りましょう。絵は保存してあります。',
  },
  network: {
    title: '通信できませんでした',
    body: 'インターネットにつながっているか確かめて、もう一度送りましょう。絵は保存してあります。',
  },
  model_unavailable: {
    title: 'モデルが使えませんでした',
    body: '指定のモデルが使えなかったため、代わりのモデル（claude-opus-5）でも試しましたが、どちらも使えませんでした。設定でモデル ID を確かめましょう。',
  },
  refused: {
    title: '今回は見てもらえませんでした',
    body: 'この絵には返事ができないと言われました。別の絵で試すか、少し描き足してから送りましょう。',
  },
  bad_response: {
    title: '返事を受け取れませんでした',
    body: '返事の形が崩れていました。もう一度送ると、たいてい直ります。',
  },
  truncated: {
    title: '返事が途中で切れました',
    body: '考える量が多すぎて、返事が最後まで届きませんでした。設定の「思考の深さ」を下げるか、もう一度送りましょう。',
  },
};
