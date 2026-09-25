/**
 * 設定  #/settings（?section=ai|scoring|practice|data|appearance|about）
 * （DESIGN_SYSTEM.md §3 設定）
 *
 * 左列 300: 見出し「設定」＋ グループ一覧（行 52、選択 accent-soft）＋ 下に版と最終バックアップ。
 * 右: 2 列グリッドにグループカードを並べる（ラベル 12 700 ＋ カード、行 56〜64・下罫線）。
 * 左の一覧を押すと、そのグループへスクロールする。
 * 値はすべて Settings（getSettings / updateSettings）に保存する。
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { version as APP_VERSION } from '../../../package.json';
import { estimateCostJpy, testConnection, type CriticErrorKind } from '@/critic';
import { exportBackupBlob, importBackup } from '@/data/backup';
import type { CritiqueEffort, FontScale, Strictness, Theme } from '@/data/types';
import { Button, Icon, ListRow, Modal, Segment, Stepper, TextField, Toggle, showToast } from '../components';
import { formatBytes, yyyymmdd } from '../format';
import { href, navigate } from '../router';
import { critiques, persisted, profile, reloadData, saveSettings, settings, uiPrefs } from '../state';

type SectionId = 'ai' | 'scoring' | 'practice' | 'data' | 'appearance' | 'about';

const SECTIONS: { id: SectionId; label: string }[] = [
  { id: 'ai', label: 'AI 批評' },
  { id: 'scoring', label: '採点' },
  { id: 'practice', label: '練習' },
  { id: 'data', label: 'データ' },
  { id: 'appearance', label: '外観' },
  { id: 'about', label: 'このアプリについて' },
];

function isSection(v: string | undefined): v is SectionId {
  return SECTIONS.some((s) => s.id === v);
}

/** 9/24 */
function md(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 9/24 07:12 */
function mdhm(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function daysSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

// ---------------------------------------------------------------------------
// ストレージ使用量
// ---------------------------------------------------------------------------

interface StorageInfo {
  usage: number | null;
  quota: number | null;
}

function useStorageInfo(): [StorageInfo, () => void] {
  const [info, setInfo] = useState<StorageInfo>({ usage: null, quota: null });
  const refresh = () => {
    const st = typeof navigator !== 'undefined' ? navigator.storage : undefined;
    if (!st?.estimate) return;
    st.estimate()
      .then((e) => setInfo({ usage: e.usage ?? null, quota: e.quota ?? null }))
      .catch(() => undefined);
    if (st.persisted) {
      st.persisted()
        .then((p) => {
          persisted.value = p;
        })
        .catch(() => undefined);
    }
  };
  useEffect(refresh, []);
  return [info, refresh];
}

// ---------------------------------------------------------------------------
// グループの枠
// ---------------------------------------------------------------------------

function Group({ id, label, children }: { id: SectionId; label: string; children: ComponentChildren }) {
  return (
    <section class="set-group" id={`set-${id}`} data-section={id} aria-labelledby={`set-${id}-h`}>
      <h2 class="set-group__label" id={`set-${id}-h`}>
        {label}
      </h2>
      <div class="set-card">{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// AI 批評
// ---------------------------------------------------------------------------

const MODEL_PRESETS = [
  { value: 'claude-opus-5-5', label: 'Opus 5.5' },
  { value: 'claude-opus-5', label: 'Opus 5' },
  { value: 'claude-sonnet-5', label: 'Sonnet 5' },
] as const;

/** 接続テスト失敗の理由（種別ごとの短い文言） */
function connectionReason(kind: CriticErrorKind, key: string): string {
  switch (kind) {
    case 'no_api_key':
      return key.trim() === '' ? 'API キーが未設定です' : 'キーが違います（貼り付け直しましょう）';
    case 'daily_limit':
      return '利用上限に達しています（しばらく待つか、上限を確かめましょう）';
    case 'network':
      return '通信できませんでした（ネットワークを確かめましょう）';
    case 'model_unavailable':
      return 'このモデルは使えません（モデル ID を確かめましょう）';
    case 'rate_limited':
      return '混み合っています（少し待ってからもう一度試しましょう）';
    case 'truncated':
    case 'refused':
    case 'bad_response':
      return '応答を確認できませんでした';
  }
}

type TestState =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'ok'; model: string; at: Date }
  | { kind: 'ng'; text: string };

function AiGroup() {
  const s = settings.value;
  const [keyDraft, setKeyDraft] = useState(s?.apiKey ?? '');
  const [test, setTest] = useState<TestState>({ kind: 'idle' });
  const modelId = s?.modelId ?? 'claude-opus-5-5';
  const preset = MODEL_PRESETS.find((m) => m.value === modelId);
  const [custom, setCustom] = useState(!preset);
  const segValue = custom ? 'custom' : (preset?.value ?? 'custom');

  const nowD = new Date();
  const monthCount = critiques.value.filter((c) => {
    const d = new Date(c.createdAt);
    return d.getFullYear() === nowD.getFullYear() && d.getMonth() === nowD.getMonth();
  }).length;
  const perCall = estimateCostJpy(modelId);

  const saveKey = (v: string) => {
    setKeyDraft(v);
    setTest({ kind: 'idle' });
    void saveSettings({ apiKey: v.trim() === '' ? null : v.trim() });
  };

  const runTest = async () => {
    setTest({ kind: 'busy' });
    const key = keyDraft.trim();
    try {
      const r = await testConnection({ apiKey: key, model: modelId });
      if (r.ok) setTest({ kind: 'ok', model: r.model, at: new Date() });
      else setTest({ kind: 'ng', text: `接続できませんでした: ${connectionReason(r.kind, key)}` });
    } catch (e) {
      setTest({ kind: 'ng', text: `接続できませんでした: ${e instanceof Error ? e.message : String(e)}` });
    }
  };

  return (
    <Group id="ai" label="AI 批評">
      <ListRow title="API キー" stacked>
        <div class="set-key">
          <TextField type="password" label="API キー" value={keyDraft} onChange={saveKey} placeholder="sk-ant-…" />
          <Button variant="secondary" size="md" disabled={test.kind === 'busy'} onClick={() => void runTest()}>
            接続テスト
          </Button>
        </div>
        <span class={`set-test set-test--${test.kind}`} role="status">
          {test.kind === 'ok' && (
            <>
              <Icon name="check" size={14} strokeWidth={2.5} />
              接続できました（<span class="num">{mdhm(test.at)}</span>
              {test.model !== modelId ? ` · ${test.model}` : ''}）
            </>
          )}
          {test.kind === 'busy' && '確認しています…'}
          {test.kind === 'ng' && test.text}
          {test.kind === 'idle' && (s?.apiKey ? '未接続' : 'キーは端末の中にだけ保存します')}
        </span>
      </ListRow>
      <ListRow title="モデル">
        <Segment
          size="sm"
          label="モデル"
          value={segValue}
          options={[...MODEL_PRESETS.map((m) => ({ value: m.value as string, label: m.label })), { value: 'custom', label: 'ID 入力' }]}
          onChange={(v) => {
            if (v === 'custom') {
              setCustom(true);
            } else {
              setCustom(false);
              void saveSettings({ modelId: v });
            }
          }}
        />
      </ListRow>
      <ListRow title="モデル ID">
        {custom ? (
          <TextField label="モデル ID" value={modelId} width={220} placeholder="claude-…" onChange={(v) => v.trim() && void saveSettings({ modelId: v.trim() })} />
        ) : (
          <span class="num set-mono">{modelId}</span>
        )}
      </ListRow>
      <ListRow title="思考の深さ">
        <Segment<CritiqueEffort>
          size="sm"
          label="思考の深さ"
          value={s?.effort ?? 'high'}
          options={[
            { value: 'low', label: 'low' },
            { value: 'medium', label: 'medium' },
            { value: 'high', label: 'high' },
          ]}
          onChange={(v) => void saveSettings({ effort: v })}
        />
      </ListRow>
      <ListRow title="1日の上限回数">
        <Stepper label="1日の上限回数" value={s?.dailyCritiqueLimit ?? 3} min={1} max={20} onChange={(v) => void saveSettings({ dailyCritiqueLimit: v })} />
      </ListRow>
      <ListRow title="費用の目安">
        <span class="set-value">
          1回 約¥<span class="num">{perCall}</span> · 今月 <span class="num">¥{perCall * monthCount}</span>
        </span>
      </ListRow>
    </Group>
  );
}

// ---------------------------------------------------------------------------
// 採点
// ---------------------------------------------------------------------------

function ScoringGroup() {
  const prefs = uiPrefs.value;
  const cal = profile.value?.calibration;
  return (
    <Group id="scoring" label="採点">
      <ListRow title="校正モード" desc={`直線・円・楕円を数本描いて基準を作る${cal ? ` · 前回 ${md(cal.calibratedAt)}` : ' · まだです'}`}>
        <Button variant="secondary" size="md" onClick={() => navigate(href.calibrate())}>
          {cal ? '再実行' : '始める'}
        </Button>
      </ListRow>
      <ListRow title="合格ラインの厳しさ" desc="点数で足止めはしません。目安の線だけ変わります">
        <Segment<Strictness>
          size="sm"
          label="合格ラインの厳しさ"
          value={prefs.strictness}
          options={[
            { value: 'normal', label: 'ふつう' },
            { value: 'easy', label: 'やさしめ' },
          ]}
          onChange={(v) => void saveSettings({ strictness: v })}
        />
      </ListRow>
    </Group>
  );
}

// ---------------------------------------------------------------------------
// 練習
// ---------------------------------------------------------------------------

function PracticeGroup() {
  const s = settings.value;
  const prefs = uiPrefs.value;
  const lastTime = useRef(prefs.notifyTime ?? '20:00');
  if (prefs.notifyTime) lastTime.current = prefs.notifyTime;
  return (
    <Group id="practice" label="練習">
      <ListRow title="1日の目標">
        <span class="set-value set-value--chev">
          平日15分・休日30分
          <Icon name="chevron" size={18} class="faint" />
        </span>
      </ListRow>
      <ListRow title="通知">
        {prefs.notifyTime !== null && (
          <TextField type="time" label="通知時刻" value={prefs.notifyTime} width={150} onChange={(v) => v && void saveSettings({ notifyTime: v })} />
        )}
        <Toggle
          label="通知"
          checked={prefs.notifyTime !== null}
          onChange={(on) => void saveSettings({ notifyTime: on ? lastTime.current : null })}
        />
      </ListRow>
      <ListRow title="復習を差し込む" desc="レッスンの始めに、点が落ちたドリルの復習を出します。出ても「スキップ」できます">
        <Toggle label="復習を差し込む" checked={s?.reviewWarmup !== false} onChange={(v) => void saveSettings({ reviewWarmup: v })} />
      </ListRow>
      <ListRow title="利き手" desc="ツールバーと完了ボタンの位置が入れ替わります（キャンバスの「反対側へ」でも切り替わります）">
        <Segment<'right' | 'left'>
          size="sm"
          label="利き手"
          value={prefs.leftHanded ? 'left' : 'right'}
          options={[
            { value: 'right', label: '右' },
            { value: 'left', label: '左' },
          ]}
          onChange={(v) => void saveSettings({ leftHanded: v === 'left' })}
        />
      </ListRow>
      <ListRow title="ペン専用モード" desc="オンのとき、指では線を描きません">
        <Toggle label="ペン専用モード" checked={prefs.penOnly} onChange={(v) => void saveSettings({ penOnly: v })} />
      </ListRow>
      <ListRow title="外部お絵描きアプリ" desc="ステージ 7 から使います">
        <TextField
          label="外部お絵描きアプリ名"
          value={s?.externalAppName ?? ''}
          placeholder="例: Krita"
          width={180}
          onChange={(v) => void saveSettings({ externalAppName: v.trim() === '' ? null : v.trim() })}
        />
      </ListRow>
    </Group>
  );
}

// ---------------------------------------------------------------------------
// データ
// ---------------------------------------------------------------------------

function DataGroup({ storage, refreshStorage }: { storage: StorageInfo; refreshStorage: () => void }) {
  const prefs = uiPrefs.value;
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false);

  const since = prefs.lastBackupAt ? daysSince(prefs.lastBackupAt) : null;
  const stale = since === null || since >= 30;
  const ratio = storage.usage !== null && storage.quota ? Math.min(1, storage.usage / storage.quota) : 0;

  const doExport = async () => {
    setBusy(true);
    // 先に最終バックアップ日時を記録してから書き出す（zip の中の設定にも新しい値が入る）。
    // 書き出しに失敗したら元の値に戻す。
    const previous = settings.value?.lastBackupAt ?? null;
    let recorded = false;
    try {
      await saveSettings({ lastBackupAt: new Date().toISOString() });
      recorded = true;
      // Blob 版は画像を 1 枚ずつ流すので、全体を一度にメモリへ載せない
      const blob = await exportBackupBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `seichotsu-backup-${yyyymmdd()}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast('バックアップを書き出しました');
    } catch (e) {
      if (recorded) await saveSettings({ lastBackupAt: previous }).catch(() => undefined);
      showToast(`書き出せませんでした: ${e instanceof Error ? e.message : String(e)}`, 'danger', 4000);
    } finally {
      setBusy(false);
    }
  };

  const onPick = async (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    // File（Blob）をそのまま保持し、読み込み時に逐次展開する
    setPending(file);
  };

  const doImport = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      await importBackup(pending, 'replace');
      await reloadData();
      refreshStorage();
      showToast('バックアップを読み込みました');
    } catch (e) {
      showToast(`読み込めませんでした: ${e instanceof Error ? e.message : String(e)}`, 'danger', 5000);
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  return (
    <Group id="data" label="データ">
      <div class="set-storage">
        <div class="set-storage__head">
          <span>ストレージ</span>
          <span class="num set-mono">
            {storage.usage !== null ? formatBytes(storage.usage) : '—'}
            {storage.quota !== null && ` / ${formatBytes(storage.quota)}`}
          </span>
        </div>
        <span class="set-storage__bar" aria-hidden="true">
          <span style={{ width: `${Math.max(ratio * 100, storage.usage ? 1 : 0)}%` }} />
        </span>
        <span class="set-storage__note">
          永続ストレージ {persisted.value === null ? '確認中' : persisted.value ? 'オン（端末が勝手に消しません）' : 'オフ'}
        </span>
      </div>
      <ListRow
        title="バックアップ"
        descTone={stale ? 'danger' : 'default'}
        desc={
          prefs.lastBackupAt ? (
            <>
              最終 <span class="num">{md(prefs.lastBackupAt)}</span>
              {since !== null && since >= 30 && (
                <>
                  {' '}
                  · <span class="num">{since}</span>日経過
                </>
              )}
            </>
          ) : (
            'まだ書き出していません'
          )
        }
      >
        <Button variant="secondary" size="md" disabled={busy} onClick={() => fileRef.current?.click()}>
          読み込む
        </Button>
        <Button variant="primary" size="md" disabled={busy} onClick={() => void doExport()}>
          zip で書き出す
        </Button>
        <input ref={fileRef} type="file" accept=".zip,application/zip" hidden onChange={(e) => void onPick(e)} />
      </ListRow>

      <Modal
        open={pending !== null}
        onClose={() => setPending(null)}
        title="データを置き換えますか"
        actions={
          <>
            <Button variant="secondary" onClick={() => setPending(null)}>
              やめる
            </Button>
            <Button variant="danger" disabled={busy} onClick={() => void doImport()}>
              置き換える
            </Button>
          </>
        }
      >
        <p>今のデータは消え、バックアップの内容になります。先に書き出しておくと安心です。</p>
      </Modal>
    </Group>
  );
}

// ---------------------------------------------------------------------------
// 外観・このアプリについて
// ---------------------------------------------------------------------------

function AppearanceGroup() {
  const s = settings.value;
  const prefs = uiPrefs.value;
  return (
    <Group id="appearance" label="外観">
      <ListRow title="テーマ" desc="ダークでは描く紙も暗くなります">
        <Segment<Theme>
          size="sm"
          label="テーマ"
          value={s?.theme ?? 'system'}
          options={[
            { value: 'light', label: 'ライト' },
            { value: 'dark', label: 'ダーク' },
            { value: 'system', label: '端末' },
          ]}
          onChange={(v) => void saveSettings({ theme: v })}
        />
      </ListRow>
      <ListRow title="文字サイズ">
        <Segment<FontScale>
          size="sm"
          label="文字サイズ"
          value={prefs.fontScale}
          options={[
            { value: 'normal', label: '標準' },
            { value: 'large', label: '大きめ' },
          ]}
          onChange={(v) => void saveSettings({ fontScale: v })}
        />
      </ListRow>
    </Group>
  );
}

function AboutGroup() {
  return (
    <Group id="about" label="このアプリについて">
      <ListRow title="成長通（せいちょうつう）" desc="毎日 15 分、一本道を 1 歩ずつ">
        <span class="num set-mono">v{APP_VERSION}</span>
      </ListRow>
      <div class="set-about">
        <p>点数は線の精度だけを見ています。まっすぐさ、ブレ、狙った所に届いたか、といった測れるものだけです。</p>
        <p>絵全体の良し悪しは点数にしません。AI の先生が言葉で見ます。</p>
        <p>次へ進むのは「やったか」で決まります。点数で足止めはしません。</p>
      </div>
    </Group>
  );
}

// ---------------------------------------------------------------------------
// 画面
// ---------------------------------------------------------------------------

export function Settings({ section }: { section?: string }) {
  const [active, setActive] = useState<SectionId>(isSection(section) ? section : 'ai');
  const [storage, refreshStorage] = useStorageInfo();
  const detailRef = useRef<HTMLDivElement>(null);
  const prefs = uiPrefs.value;

  const jump = (id: SectionId, smooth: boolean) => {
    setActive(id);
    const host = detailRef.current;
    const el = host?.querySelector<HTMLElement>(`#set-${id}`);
    if (host && el) {
      host.scrollTo({ top: Math.max(0, el.offsetTop - 32), behavior: smooth ? 'smooth' : 'auto' });
    }
  };

  useEffect(() => {
    if (isSection(section)) jump(section, false);
  }, [section]);

  const since = prefs.lastBackupAt ? daysSince(prefs.lastBackupAt) : null;

  return (
    <div class="settings">
      <aside class="settings__nav">
        <h1 class="settings__heading">設定</h1>
        <ul class="settings__groups">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                aria-current={s.id === active ? 'true' : undefined}
                class={s.id === active ? 'settings__group is-active' : 'settings__group'}
                onClick={() => jump(s.id, true)}
              >
                {s.label}
              </button>
            </li>
          ))}
        </ul>
        <p class="settings__foot">
          成長通 <span class="num">v{APP_VERSION}</span>
          <br />
          最終バックアップ{' '}
          {prefs.lastBackupAt ? (
            <>
              <span class="num">{md(prefs.lastBackupAt)}</span>（<span class="num">{since}</span>日前）
            </>
          ) : (
            'まだありません'
          )}
        </p>
      </aside>
      <div class="settings__detail" ref={detailRef}>
        <div class="settings__col">
          <AiGroup />
          <ScoringGroup />
          <AppearanceGroup />
        </div>
        <div class="settings__col">
          <PracticeGroup />
          <DataGroup storage={storage} refreshStorage={refreshStorage} />
          <AboutGroup />
        </div>
      </div>
    </div>
  );
}
