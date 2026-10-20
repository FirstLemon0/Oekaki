/**
 * 取り込んだ埋め込みのペイント（public/paint/BUILD.json）の版。ビルドのときに vite.config の define が入れる。
 * vitest など define の無い所では null（ペイント無し）として扱う。
 */
export interface OgPaintInfo {
  readonly buildId: string;
  /** OG の契約の版（保存する絵の meta.og.ogContract / ogDocs.ogContract） */
  readonly ogContract: string;
  /** 成果物の埋め込み API の版 */
  readonly embedApi: number;
}

export function ogPaintInfo(): OgPaintInfo | null {
  try {
    return typeof __OG_PAINT_INFO__ === 'undefined' ? null : __OG_PAINT_INFO__;
  } catch {
    return null;
  }
}
