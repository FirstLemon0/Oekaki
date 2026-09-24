import { useEffect, useMemo } from 'preact/hooks';

/** Blob の一覧から object URL を作り、差し替え・アンマウント時に解放する。 */
export function useObjectUrls(items: { id: string; image: Blob }[]): Map<string, string> {
  const urls = useMemo(() => {
    const m = new Map<string, string>();
    for (const it of items) m.set(it.id, URL.createObjectURL(it.image));
    return m;
  }, [items]);
  useEffect(
    () => () => {
      for (const u of urls.values()) URL.revokeObjectURL(u);
    },
    [urls],
  );
  return urls;
}
