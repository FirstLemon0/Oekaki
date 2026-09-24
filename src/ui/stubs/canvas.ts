/**
 * 旧スタブの入口。実物（src/canvas）を同じ名前で再エクスポートする。
 * 使っている画面（GalleryDetail）が import 先を @/canvas に変えたら、このファイルは消してよい。
 */
export * from '@/canvas';

/**
 * エンジン自体は本物だが、GalleryDetail の「描いた順に再生」ボタンにまだ onClick が無い
 * （別担当の編集中）。押しても何も起きないボタンを有効にしないよう、配線されるまで false にしておく。
 * GalleryDetail 側で createCanvasEngine + CanvasView + replay() を配線したら true にする。
 */
export const canvasAvailable = false;
