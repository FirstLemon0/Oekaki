/**
 * 新しいお絵描き #/free（設定 paintEngine = 'og'、またはギャラリーの「続きから描く」#/free?og=<id>）。UR-002 S2 / ADR-0007 D3・D6・D7。
 *
 * 埋め込みのペイント（public/paint/embed.html = OG-nanika の成果物）を同じオリジンの iframe で開き、`contentWindow.ogEmbed`（API v1）で操作する。
 * 版が違う・起動に失敗したときは今までのお絵描き（FreeDraw）に戻す（続きから描くときは戻せないので案内だけ）。
 *
 * 今の FreeDraw の約束をそのまま守る（設計案 §4 の対応表）:
 * - 「終わる」→ 下からのシート（透過 PNG を書き出す / 描き続ける / 保存して終わる）。文言は FreeDraw と同じ。保存は親のシートだけ（OG の保存の文言は出さない）
 * - 保存の種別 free / after / before（freeDrawingKind、?save=after|before で markBeforeAfter）。何も描いていなければ保存しない
 * - 5 分以上の実描画でストリーク（ogEmbed.onStroke の pen / eraser の区間 → 今の activeDrawingMs → recordFreeActivity）
 * - 透過 PNG は長辺 2048、名前は exportFileName('free')（seichotsu-free-YYYYMMDD-HHMM.png）
 * - ギャラリーの画像は WebP（長辺 1024）+ meta.og、文書（.ognk）は ogDocs。2 つをメモリで作ってから 1 トランザクションで書く（容量不足でも結果を保って再試行）
 * - 離脱のガードは親の navGuard だけ（onDirtyChange で armLeaveGuard。iframe の中は beforeunload を張らない）
 * - 下書き: localStorage の印（期限 24 時間）+ OG の自動保存の記録（ジャーナル。成果物に saveDraft / latestDraft / openDraft の口があれば）か、
 *   口の無い成果物では親が持つ文書の写し（局所アダプタ、og/ogDraft.ts）。開き直したら（タブ・アプリを閉じた後も）「続きから / 捨てる」。
 *   掃除は期限切れか「捨てる」のときだけ。#/free を開いている間は Web Locks の og-free-draft を取り、取れないタブ（別のタブで開いている）は
 *   下書きに触れない（ilust-sup-followup-04）。保存の後は印も記録も無い
 * - 今までのお絵描きに戻した理由（missing / version / boot / timeout / open）を通知の末尾と localStorage に残し、設定の画面に出す（ilust-sup-followup-13）
 * - テーマ（system を解決）・ペン専用・左利き・文字の大きさを最初の描画の前（iframe の属性）と configure で渡す
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { getDrawing, getOgDoc, saveOgDrawing } from '@/data/repo';
import type { Drawing } from '@/data/types';
import { href, navigate } from '../router';
import { settings, uiPrefs } from '../state';
import { BackPill, Button, Modal, showToast } from '../components';
import { armLeaveGuard, requestLeave } from '../navGuard';
import { SAVE_FAILED } from '../lesson/common';
import { freeDrawingKind, markBeforeAfter, recordFreeActivity } from '../lesson/stateBridge';
import { downloadBlob, exportFileName } from '../paint/canvasDoc';
import { PaintIcon } from '../paint/PaintIcon';
import { lazyScreen } from '../lazyScreen';
import { connectOgEmbed, OG_EMBED_URL, type OgEmbedApi } from '../og/embedApi';
import { createSpanLog, embedConfigFrom, newOgDocId, paperFor, saveOgFree, type OgSaveOutcome } from '../og/freeSession';
import { continueTargetOf, type ContinueTarget } from '../og/ogDrawing';
import {
  acquireDraftLock,
  createDraftKeeper,
  decideDraft,
  isMarkExpired,
  ogDraftStore,
  sharedKeeper,
  type DraftKeeper,
  type DraftLock,
  type OgDraftMark,
} from '../og/ogDraft';
import { fallbackStorage, recordFallback, withReason, type OgFallbackReason } from '../og/fallbackReason';
import { ogPaintInfo } from '../og/paintInfo';
import '../og/ogFree.css';

/** 版が合わない・起動に失敗したときの戻り先（今までのお絵描き） */
const FallbackFreeDraw = lazyScreen(() => import('./FreeDraw').then((m) => m.FreeDraw));

/** 透過 PNG の長辺（FreeDraw と同じ） */
const EXPORT_EDGE = 2048;
/** 下書きの写しを取るまでの待ち（最後の確定から。v2 の下書きと同じ 1 秒） */
export const OG_DRAFT_DEBOUNCE_MS = 1000;
/** 「戻る」（捨てる）で下書きを消し終わるのを待つ上限 */
const LEAVE_CLEAR_WAIT_MS = 3000;

export const QUOTA_FAILED = '端末の空き容量が足りず保存できませんでした。ギャラリーの使わない絵を消すなどして空きを作ってから、もう一度押してください（描いた絵はこのまま残っています）。';
export const FALLBACK_NOTICE = '新しいお絵描きを開けなかったので、今までのお絵描きで開きました。';
/** 別のタブで #/free を開いている（下書きのロックが取れない）ときの案内 */
export const SHARED_NOTICE = '別のタブでも新しいお絵描きを開いています。こちらで描いている途中の絵は、閉じると下書きに残りません。';

type Phase = 'connecting' | 'ready' | 'fallback' | 'unavailable';

/** 開いたときの印（期限内で同じ画面のものだけ。ロックの結果を待たずに「描きかけがあります」を出すため） */
function initialMark(continueId: string | null): OgDraftMark | null {
  const m = ogDraftStore.readMark();
  return m && m.continueId === continueId && !isMarkExpired(m, new Date()) ? m : null;
}

function prefersDark(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

function currentConfig() {
  const p = uiPrefs.value;
  return embedConfigFrom(
    { theme: settings.value?.theme, penOnly: p.penOnly, leftHanded: p.leftHanded, fontScale: p.fontScale },
    prefersDark(),
  );
}

export function OgFreeDraw({ save, continueId }: { save?: 'before' | 'after'; continueId?: string }) {
  const prefs = uiPrefs.value;
  const hostRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<OgEmbedApi | null>(null);
  const spans = useRef(createSpanLog());
  const docId = useRef(newOgDocId());
  const target = useRef<ContinueTarget | null>(null);
  const savedDrawing = useRef<Drawing | null>(null);
  const retry = useRef<(() => Promise<OgSaveOutcome>) | null>(null);
  const savedRef = useRef(false);
  const restoredRef = useRef(false);
  const busyRef = useRef(false);
  /** 下書きの持ち方（成果物の口しだい。og/ogDraft.ts） */
  const keeperRef = useRef<DraftKeeper | null>(null);
  /** 「戻る」を選んだ（捨てる）: これから書き終わる下書きの印を置かない */
  const leavingRef = useRef(false);

  // 成果物（public/paint/）を取り込んでいないビルドでは iframe を作らずに今までのお絵描きへ（/paint/embed.html が成長通そのものになるため）
  const [phase, setPhase] = useState<Phase>(() => (ogPaintInfo() ? 'connecting' : continueId ? 'unavailable' : 'fallback'));
  /** 今までのお絵描きに戻した（開けなかった）理由。成果物を取り込んでいないビルドは missing */
  const [failReason, setFailReason] = useState<OgFallbackReason | null>(() => (ogPaintInfo() ? null : 'missing'));
  const fail = (reason: OgFallbackReason) => {
    recordFallback(fallbackStorage(), reason, ogPaintInfo()?.buildId ?? null);
    setFailReason(reason);
    setPhase(continueId ? 'unavailable' : 'fallback');
  };
  const [dirty, setDirty] = useState(false);
  const [restored, setRestored] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);
  const [exported, setExported] = useState<'idle' | 'busy' | 'done' | 'failed'>('idle');
  const [leaveAsk, setLeaveAsk] = useState<(() => void) | null>(null);
  /** 前に開いたときの下書き（同じ画面 = 同じ continueId のものだけ） */
  const [draftOffer, setDraftOffer] = useState<OgDraftMark | null>(() => initialMark(continueId ?? null));
  /** 開いたときに出した下書きの印（答えの後も起動の流れが使う） */
  const initialOffer = useRef(draftOffer);
  const draftOfferRef = useRef(draftOffer);
  draftOfferRef.current = draftOffer;
  /** 下書きの「続きから / 捨てる」の答え（起動の流れが待つ） */
  const draftAnswer = useRef<{ promise: Promise<'continue' | 'discard'>; resolve: (v: 'continue' | 'discard') => void } | null>(null);
  if (!draftAnswer.current) {
    let resolve!: (v: 'continue' | 'discard') => void;
    const promise = new Promise<'continue' | 'discard'>((r) => {
      resolve = r;
    });
    draftAnswer.current = { promise, resolve };
  }

  const leaveTo = () => (continueId ? href.galleryDetail(continueId) : href.home());
  const leave = () => navigate(leaveTo(), { replace: true });

  // --- 起動: iframe を作り、ogEmbed に繋いで、紙（新規 / 続きから / 下書き）を用意する
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !ogPaintInfo()) return;
    let alive = true;
    const offs: (() => void)[] = [];
    let draftTimer: ReturnType<typeof setTimeout> | null = null;
    let writing = false;
    let again = false;
    // #/free の下書きの持ち主になる（別のタブが開いていれば少し待って、取れなければ下書きに触れない）
    let lock: DraftLock | null = null;
    const lockP = acquireDraftLock().then((l) => {
      if (!alive) l.release();
      else lock = l;
      return l;
    });

    const frame = document.createElement('iframe');
    frame.className = 'og-free__frame';
    frame.title = 'お絵描き';
    frame.setAttribute('data-testid', 'og-free-frame');
    // 最初の描画の前の設定（テーマの暗転を防ぐ。OG の frame-config.ts が同期で読む）
    frame.setAttribute('data-og-embed-config', JSON.stringify(currentConfig()));
    frame.src = OG_EMBED_URL;
    host.appendChild(frame);

    /**
     * 親の Blob を iframe の realm の Blob に作り直す（局所アダプタ。埋め込みの openProject は `instanceof Blob` で検査するので、
     * 別の realm の Blob を拒む。CCR-ilust-sup-m7-wave2-embed-requests §2 で embed に依頼）
     */
    const frameBlob = async (b: Blob): Promise<Blob> => {
      const W = frame.contentWindow as (Window & { Blob: typeof Blob }) | null;
      if (!W || Object.getPrototypeOf(b) === W.Blob.prototype) return b;
      return new W.Blob([await b.arrayBuffer()], { type: b.type || 'application/x-ognk' });
    };

    let keeper: DraftKeeper | null = null;
    const writeDraft = async (): Promise<void> => {
      const api = apiRef.current;
      if (!api || !keeper || !alive || savedRef.current || draftOfferRef.current) return;
      if (writing) {
        again = true;
        return;
      }
      writing = true;
      try {
        if (!api.isDirty() && !restoredRef.current) return;
        // 書いている間に画面を離れた・保存した・下書きの答えを待っている: 印を置かない（古い下書きを残さない）
        await keeper.save(() => alive && !savedRef.current && !leavingRef.current && !draftOfferRef.current);
      } finally {
        writing = false;
        if (again && alive) {
          again = false;
          scheduleDraft();
        }
      }
    };
    const scheduleDraft = () => {
      if (!alive || savedRef.current) return;
      if (draftTimer !== null) clearTimeout(draftTimer);
      draftTimer = setTimeout(() => {
        draftTimer = null;
        void writeDraft();
      }, OG_DRAFT_DEBOUNCE_MS);
    };

    void (async () => {
      const r = await connectOgEmbed(() => frame.contentWindow as (Window & { ogEmbed?: unknown }) | null);
      if (!alive) {
        if (r.ok) r.api.dispose();
        return;
      }
      if (!r.ok) {
        console.warn('[OgFreeDraw] 新しいお絵描きを開けません:', r.reason, r.error ?? r.version ?? '');
        fail(r.reason);
        return;
      }
      const api = r.api;
      apiRef.current = api;
      keeper = createDraftKeeper({
        api,
        store: ogDraftStore,
        docId: () => docId.current,
        continueId: continueId ?? null,
        toFrameBlob: frameBlob,
      });
      keeperRef.current = keeper;
      const held = (await lockP).held;
      if (!alive) {
        offs.splice(0).forEach((f) => f());
        return;
      }
      if (!held) {
        // 別のタブが #/free を開いている: 印・写し・ジャーナルの掃除はそのタブの仕事。ここは下書きを出さない・残さない
        keeper = sharedKeeper(api);
        keeperRef.current = keeper;
        if (initialOffer.current) {
          initialOffer.current = null;
          draftOfferRef.current = null;
          setDraftOffer(null);
        }
        showToast(SHARED_NOTICE);
      }
      offs.push(
        api.onStroke((s) => {
          spans.current.add(s);
          scheduleDraft();
        }),
        api.onDirtyChange((d) => {
          setDirty(d);
          if (d) scheduleDraft();
        }),
      );
      try {
        api.configure(currentConfig());
        // 前の下書き: 印（無ければ残っている期限内の記録）を「続きから / 捨てる」で出す。掃除は期限切れ（か残っているものが無い）ときだけ
        if (held && !initialOffer.current) {
          const mark = ogDraftStore.readMark();
          const found = mark ? null : await keeper.peek();
          const d = decideDraft({ mark, found, continueId: continueId ?? null, now: new Date() });
          if (d.kind === 'offer') {
            initialOffer.current = d.mark;
            draftOfferRef.current = d.mark;
            setDraftOffer(d.mark);
          } else if (d.kind === 'sweep') {
            await keeper.sweep();
          }
          if (!alive) return;
        }
        let opened = false;
        if (continueId) {
          const [d, rec] = await Promise.all([getDrawing(continueId), getOgDoc(continueId)]);
          const t = continueTargetOf(d);
          if (t && rec && rec.bytes instanceof Blob) {
            await api.openProject(await frameBlob(rec.bytes));
            target.current = t;
            docId.current = t.docId;
            opened = true;
          } else {
            showToast('この絵の続きのデータが見つかりませんでした。新しい紙で始めます。', 'danger');
          }
        }
        if (!opened) {
          const box = host.getBoundingClientRect();
          await api.newDocument(paperFor(box.height > 0 ? box.width / box.height : 1));
        }
        if (!alive) return;
        // 前の下書き: 答えを待ってから（続きから = 下書きを開く / 捨てる = 消す）。答えが起動より先に来ていても同じ
        if (initialOffer.current) {
          const mark = initialOffer.current;
          const answer = await draftAnswer.current!.promise;
          if (!alive) return;
          if (answer === 'continue') {
            const restoredDoc = await keeper.restore(mark);
            if (restoredDoc) {
              docId.current = restoredDoc;
              restoredRef.current = true;
              setRestored(true);
            } else {
              showToast('下書きを読み込めませんでした。', 'danger');
              await keeper.clear();
            }
          } else {
            await keeper.clear();
          }
        }
        if (alive) setPhase('ready');
      } catch (e) {
        console.warn('[OgFreeDraw] 紙を用意できません', e);
        if (!alive) return;
        offs.splice(0).forEach((f) => f());
        apiRef.current = null;
        try {
          api.dispose();
        } catch {
          // 何もしない
        }
        fail('open');
      }
    })();

    return () => {
      alive = false;
      if (draftTimer !== null) clearTimeout(draftTimer);
      offs.splice(0).forEach((f) => f());
      // 画面を離れた（保存して終わった・戻るを選んだ）: 下書きは要らない（再読み込み・タブやアプリを閉じたときはここは走らない = 下書きが残る）。
      // 繋がる前に離れた（keeper が無い）・持ち主でない（shared）ときは前の下書きに触れない（開けなかっただけで、捨てたのではない）。
      // 消し終わってからロックを手放す（次のタブが消す前の印を読まないように）
      const clearing = keeper ? keeper.clear() : Promise.resolve();
      void clearing.catch(() => undefined).finally(() => lock?.release());
      keeperRef.current = null;
      const api = apiRef.current;
      apiRef.current = null;
      try {
        api?.dispose();
      } catch {
        // 何もしない
      }
      frame.remove();
    };
    // 画面ごとに 1 回（key で作り直す）
  }, []);

  // --- 親の設定（テーマ・ペン専用・左利き・文字の大きさ）を当て直す。system のテーマは端末の切り替えにも追従する
  const theme = settings.value?.theme;
  useEffect(() => {
    const apply = () => apiRef.current?.configure(currentConfig());
    if (phase === 'ready') apply();
    let mq: MediaQueryList | null = null;
    try {
      mq = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
    } catch {
      mq = null;
    }
    mq?.addEventListener?.('change', apply);
    return () => mq?.removeEventListener?.('change', apply);
  }, [phase, theme, prefs.penOnly, prefs.leftHanded, prefs.fontScale]);

  // --- 離脱のガード（親だけ。保存していない絵があるあいだ）
  const guarded = phase === 'ready' && (dirty || restored) && !saved && draftOffer === null;
  useEffect(() => {
    if (!guarded) return;
    return armLeaveGuard((proceed) => setLeaveAsk(() => proceed), leave);
  }, [guarded]);

  const exit = () => requestLeave(leave);

  const answerDraft = (a: 'continue' | 'discard') => {
    setDraftOffer(null);
    draftOfferRef.current = null;
    draftAnswer.current?.resolve(a);
  };

  const finish = async () => {
    const api = apiRef.current;
    if (!api || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      if (!savedDrawing.current) {
        const outcome = retry.current
          ? await retry.current()
          : await saveOgFree({
              api,
              kind: freeDrawingKind(save),
              docId: docId.current,
              ogContract: ogPaintInfo()?.ogContract ?? 'unknown',
              target: target.current,
              save: saveOgDrawing,
            });
        if (outcome.status === 'failed') {
          retry.current = outcome.retry;
          setError(outcome.reason === 'quota' ? QUOTA_FAILED : SAVE_FAILED);
          return;
        }
        retry.current = null;
        if (outcome.status === 'saved') {
          savedDrawing.current = outcome.drawing;
          // 続きから描いた絵は元の Before / After の記録を変えない
          if (save && !target.current) await markBeforeAfter(outcome.drawing.id, save);
        }
      }
      await recordFreeActivity(spans.current.activeMs());
      savedRef.current = true;
      setSaved(true);
      await (keeperRef.current ?? ogDraftStore).clear();
      await api.discardRecovery().catch(() => undefined);
      leave();
    } catch {
      setError(SAVE_FAILED);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const exportPng = async () => {
    const api = apiRef.current;
    if (!api) return;
    setExported('busy');
    try {
      const blob = await api.exportTransparentPng({ longEdge: EXPORT_EDGE });
      downloadBlob(blob, exportFileName('free'));
      setExported('done');
    } catch {
      setExported('failed');
    }
  };

  useEffect(() => {
    if (phase === 'fallback') showToast(withReason(FALLBACK_NOTICE, failReason ?? 'missing'));
  }, [phase]);

  if (phase === 'fallback') return <FallbackFreeDraw save={save} />;

  const task =
    save === 'after'
      ? '今月の1枚 — 最初の1枚（Before）と同じお題で描き直しましょう。採点はありません。'
      : '自由お絵描き — 採点なし・記録だけ。描いた時間が5分以上でストリークに数えます。';

  const sheet = ending ? (
    <div class="ls-sheet pt-endsheet og-free__sheet" role="dialog" aria-label="終わる">
      <div class="ls-sheet__grip" aria-hidden="true" />
      <div class="pt-endsheet__body">
        <h2 class="pt-endsheet__title">終わりますか</h2>
        <p class="pt-endsheet__text">保存するとギャラリーに残ります。画像として手元に残したいときは、透過 PNG（紙の色なし）で書き出せます。</p>
        {exported === 'done' && (
          <p class="pt-endsheet__status" role="status">
            透過 PNG を書き出しました。
          </p>
        )}
        {exported === 'failed' && (
          <p class="ls-sheet__error" role="alert">
            書き出せませんでした。もう一度押してみましょう。
          </p>
        )}
        {error && (
          <p class="ls-sheet__error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div class="ls-sheet__foot pt-endsheet__foot">
        <Button variant="secondary" disabled={exported === 'busy'} onClick={() => void exportPng()}>
          <span class="pt-btnicon">
            <PaintIcon name="download" size={20} />
            透過 PNG を書き出す
          </span>
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => setEnding(false)}>
          描き続ける
        </Button>
        <Button variant="primary" disabled={busy} onClick={() => void finish()}>
          保存して終わる
        </Button>
      </div>
    </div>
  ) : null;

  return (
    <div class={prefs.leftHanded ? 'og-free is-left' : 'og-free'} data-testid="og-free" data-phase={phase}>
      <header class="og-free__bar">
        <BackPill label={continueId ? 'ギャラリーへ戻る' : 'ホームへ戻る'} onClick={exit} class="og-free__back" />
        <p class="og-free__task">{task}</p>
        <button
          type="button"
          class="og-free__done"
          disabled={phase !== 'ready' || busy || ending}
          onClick={() => {
            setExported('idle');
            setError(null);
            setEnding(true);
          }}
        >
          終わる
        </button>
      </header>
      <div class="og-free__stage">
        <div class="og-free__host" ref={hostRef} />
        {phase === 'connecting' && (
          <div class="og-free__veil" aria-busy="true">
            <span>準備しています…</span>
          </div>
        )}
        {phase === 'unavailable' && (
          <div class="og-free__veil" role="alert">
            <p>{withReason('新しいお絵描きを開けませんでした。通信を確かめてから、もう一度開いてください。', failReason ?? 'missing')}</p>
            <Button variant="secondary" onClick={() => navigate(leaveTo(), { replace: true })}>
              戻る
            </Button>
          </div>
        )}
      </div>
      {sheet}
      <Modal
        open={leaveAsk !== null}
        onClose={() => setLeaveAsk(null)}
        title="描いた線が消えます。戻りますか？"
        actions={
          <>
            <Button variant="secondary" onClick={() => setLeaveAsk(null)}>
              描き続ける
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                const go = leaveAsk;
                setLeaveAsk(null);
                leavingRef.current = true;
                // 捨てる: OG のジャーナルを消し終わってから離れる（離れると埋め込みを畳むので、消す前に畳むと記録が残り、
                // 次に開いたときに捨てたはずの絵を「描きかけ」として出してしまう）。消せなくても長くは待たない
                const clearing = keeperRef.current ? keeperRef.current.clear() : Promise.resolve();
                void Promise.race([clearing.catch(() => undefined), new Promise((r) => setTimeout(r, LEAVE_CLEAR_WAIT_MS))]).then(() => go?.());
              }}
            >
              戻る
            </Button>
          </>
        }
      >
        <p>まだ保存していません。残したいときは「描き続ける」を選んで、「終わる」から保存しましょう。</p>
      </Modal>
      <Modal
        open={draftOffer !== null}
        onClose={() => answerDraft('continue')}
        title="描きかけがあります"
        actions={
          <>
            <Button variant="secondary" onClick={() => answerDraft('discard')}>
              捨てる
            </Button>
            <Button variant="primary" onClick={() => answerDraft('continue')}>
              続きから
            </Button>
          </>
        }
      >
        <p>前に開いたときの絵が残っています。続きから描きますか？</p>
      </Modal>
    </div>
  );
}
