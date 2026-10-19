/**
 * DB の接続まわりの出来事を、利用者への案内の文言にする（ADR-0007 D6-6、受け入れ ilust-idb-compat）。
 * - blocked: 新しい版（v2 = ogDocs の追加）へ上げたいが、古い版を開いたままの別タブが閉じていない
 * - blocking: 別タブがさらに新しい版で開こうとしている（こちらは接続を閉じたので再読み込みが要る）
 * - VersionError: 端末の DB の方が新しい（古い画面が残っている）。版は下げられないので再読み込みしてもらう
 */
import type { DbEvent } from '@/data/db';

export const DB_BLOCKED_MESSAGE =
  '成長通の新しい版の準備をしています。ほかのタブやウィンドウで成長通を開いていたら閉じてください（閉じると自動で続きます）。';
export const DB_BLOCKING_MESSAGE = '別のタブで成長通の新しい版が開かれました。このページを再読み込みしてください。';
export const DB_NEWER_MESSAGE = 'この端末には新しい版のデータがあります。ページを再読み込みしてください（古い画面が開いています）。';

export function dbEventMessage(e: DbEvent): string | null {
  switch (e.type) {
    case 'blocked':
      return DB_BLOCKED_MESSAGE;
    case 'blocking':
      return DB_BLOCKING_MESSAGE;
    case 'terminated':
      return 'データの接続が切れました。ページを再読み込みしてください。';
    default:
      return null;
  }
}

/** 読み込みの失敗の文言。VersionError（端末の DB の方が新しい）だけ専用の案内にする */
export function dbLoadErrorMessage(e: unknown): string {
  const name = e && typeof e === 'object' ? (e as { name?: unknown }).name : undefined;
  if (name === 'VersionError') return DB_NEWER_MESSAGE;
  return `データを読み込めませんでした: ${e instanceof Error ? e.message : String(e)}`;
}
