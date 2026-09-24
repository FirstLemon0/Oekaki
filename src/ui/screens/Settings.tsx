/**
 * 設定  #/settings（?section=ai|scoring|practice|data|appearance|about）
 *
 * 左: グループ一覧＋左下に保存状況。右: 詳細（カード＋行）。値は getSettings/updateSettings で保存。
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { version as APP_VERSION } from '../../../package.json';
import { exportBackup, importBackup } from '@/data/backup';
import type { CritiqueEffort, Theme } from '@/data/types';
import { Button, Card, Modal, Segment, Stepper, TextField, Toggle, showToast } from '../components';
import { formatBytes, formatDate, yyyymmdd } from '../format';
import { href, navigate } from '../router';
import {
  critiques,
  persisted,
  profile,
  reloadData,
  saveSettings,
  saveUiPrefs,
  settings,
  uiPrefs,
} from '../state';
import { estimateCostJpy, testConnection } from '../stubs/critic';

type SectionId = 'ai' | 'scoring' | 'practice' | 'data' | 'appearance' | 'about';

const SECTIONS: { id: SectionId; label: string }[] = [
  { id: 'ai', label: 'AI 批評' },
  { id: 'scoring', label: '採点と校正' },
  { id: 'practice', label: '練習' },
  { id: 'data', label: 'データとバックアップ' },
  { id: 'appearance', label: '外観' },
  { id: 'about', label: 'このアプリについて' },
];

function isSection(v: string | undefined): v is SectionId {
  return SECTIONS.some((s) => s.id === v);
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
    const st = navigator.storage;
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
// 行
// ---------------------------------------------------------------------------

function Row({ title, desc, children }: { title: string; desc?: ComponentChildren; children?: ComponentChildren }) {
  return (
    <div class="set-row">
      <div class="set-row__text">
        <span class="set-row__title">{title}</span>
        {desc && <span class="set-row__desc">{desc}</span>}
      </div>
      <div class="set-row__control">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 各グループ
// ---------------------------------------------------------------------------

const MODEL_PRESETS = [
  { value: 'claude-opus-5-5', label: 'Opus 5.5' },
  { value: 'claude-opus-5', label: 'Opus 5' },
  { value: 'claude-sonnet-5', label: 'Sonnet 5' },
] as const;

function AiSection() {
  const s = settings.value;
  const [keyDraft, setKeyDraft] = useState(s?.apiKey ?? '');
  const [testState, setTestState] = useState<string | null>(null);
  const modelId = s?.modelId ?? 'claude-opus-5-5';
  const preset = MODEL_PRESETS.find((m) => m.value === modelId);
  const [custom, setCustom] = useState(!preset);
  const segValue = custom ? 'custom' : (preset?.value ?? 'custom');

  const nowD = new Date();
  const monthCount = critiques.value.filter((c) => {
    const d = new Date(c.createdAt);
    return d.getFullYear() === nowD.getFullYear() && d.getMonth() === nowD.getMonth();
  }).length;

  const saveKey = (v: string) => {
    setKeyDraft(v);
    void saveSettings({ apiKey: v.trim() === '' ? null : v.trim() });
  };

  const runTest = async () => {
    setTestState('確認しています…');
    const r = await testConnection(s?.apiKey ?? null, modelId);
    if (r.ok) setTestState(`接続できました（${r.model}）`);
    else setTestState(r.reason === 'no_api_key' ? 'キーが未設定です' : '未接続（批評機能は準備中です）');
  };

  return (
    <Card class="set-card">
      <Row title="API キー" desc="端末の中にだけ保存します。">
        <div class="set-inline">
          <TextField type="password" label="API キー" value={keyDraft} onChange={saveKey} placeholder="sk-ant-…" width={240} />
          <Button variant="secondary" onClick={() => void runTest()}>
            接続テスト
          </Button>
        </div>
        {testState && (
          <span class="set-row__status" role="status">
            {testState}
          </span>
        )}
      </Row>
      <Row title="モデル" desc="批評に使う Claude のモデルです。">
        <Segment
          label="モデル"
          value={segValue}
          options={[...MODEL_PRESETS.map((m) => ({ value: m.value as string, label: m.label })), { value: 'custom', label: 'ID を入力' }]}
          onChange={(v) => {
            if (v === 'custom') {
              setCustom(true);
            } else {
              setCustom(false);
              void saveSettings({ modelId: v });
            }
          }}
        />
        {custom && (
          <TextField
            label="モデル ID"
            value={modelId}
            width={280}
            placeholder="claude-…"
            onChange={(v) => v.trim() && void saveSettings({ modelId: v.trim() })}
          />
        )}
      </Row>
      <Row title="考える深さ" desc="深いほど時間と費用がかかります。">
        <Segment<CritiqueEffort>
          label="考える深さ"
          value={s?.effort ?? 'high'}
          options={[
            { value: 'low', label: '浅め' },
            { value: 'medium', label: 'ふつう' },
            { value: 'high', label: '深め' },
          ]}
          onChange={(v) => void saveSettings({ effort: v })}
        />
      </Row>
      <Row
        title="1 日の上限回数"
        desc={
          <span class="num">
            目安 約¥{estimateCostJpy(modelId)} / 回 ・ 今月ここまで {monthCount} 回
          </span>
        }
      >
        <Stepper
          label="1 日の上限回数"
          value={s?.dailyCritiqueLimit ?? 3}
          min={1}
          max={20}
          onChange={(v) => void saveSettings({ dailyCritiqueLimit: v })}
        />
      </Row>
    </Card>
  );
}

function ScoringSection() {
  const prefs = uiPrefs.value;
  const cal = profile.value?.calibration;
  return (
    <Card class="set-card">
      <Row
        title="校正"
        desc={cal ? `前回 ${formatDate(cal.calibratedAt)}。直線・円・楕円を数本描いて基準を作ります。` : 'まだ校正していません。数本描くだけで OK。'}
      >
        <Button variant="primary" onClick={() => navigate(href.calibrate())}>
          校正をやり直す
        </Button>
      </Row>
      <Row title="合格ラインの厳しさ" desc="点数で足止めはしません。目安の線だけ変わります。">
        <Segment<'easy' | 'normal'>
          label="合格ラインの厳しさ"
          value={prefs.strictness}
          options={[
            { value: 'easy', label: 'やさしめ' },
            { value: 'normal', label: 'ふつう' },
          ]}
          onChange={(v) => void saveUiPrefs({ strictness: v })}
        />
      </Row>
    </Card>
  );
}

function PracticeSection() {
  const s = settings.value;
  const prefs = uiPrefs.value;
  return (
    <Card class="set-card">
      <Row title="1 日の目標" desc="休日は追加ドリルか自由枠をどうぞ。">
        <span class="set-value">1 レッスン</span>
      </Row>
      <Row title="通知時刻" desc="この時刻に、今日のレッスンをお知らせします。">
        <TextField
          type="time"
          label="通知時刻"
          value={prefs.notifyTime ?? ''}
          width={140}
          onChange={(v) => void saveUiPrefs({ notifyTime: v || null })}
        />
      </Row>
      <Row title="左利き" desc="キャンバスの道具を右側に置きます。">
        <Toggle label="左利き" checked={prefs.leftHanded} onChange={(v) => void saveUiPrefs({ leftHanded: v })} />
      </Row>
      <Row title="ペン専用" desc="オンのとき、指では線を描きません。">
        <Toggle label="ペン専用" checked={prefs.penOnly} onChange={(v) => void saveUiPrefs({ penOnly: v })} />
      </Row>
      <Row title="外部お絵描きアプリ" desc="ステージ 7 から使います。">
        <TextField
          label="外部お絵描きアプリ名"
          value={s?.externalAppName ?? ''}
          placeholder="例: ibisPaint"
          width={220}
          onChange={(v) => void saveSettings({ externalAppName: v.trim() === '' ? null : v.trim() })}
        />
      </Row>
    </Card>
  );
}

function DataSection({ storage, refreshStorage }: { storage: StorageInfo; refreshStorage: () => void }) {
  const prefs = uiPrefs.value;
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Uint8Array | null>(null);
  const [busy, setBusy] = useState(false);

  const doExport = async () => {
    setBusy(true);
    try {
      const bytes = await exportBackup();
      const blob = new Blob([bytes.slice()], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `seichotsu-backup-${yyyymmdd()}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      await saveUiPrefs({ lastBackupAt: new Date().toISOString() });
      showToast('バックアップを書き出しました');
    } catch (e) {
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
    setPending(new Uint8Array(await file.arrayBuffer()));
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
    <Card class="set-card">
      <Row
        title="バックアップ"
        desc={prefs.lastBackupAt ? `最終 ${formatDate(prefs.lastBackupAt)}。zip で端末に保存します。` : 'まだ書き出していません。zip で端末に保存します。'}
      >
        <div class="set-inline">
          <Button variant="primary" size="md" disabled={busy} onClick={() => void doExport()}>
            書き出す
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => fileRef.current?.click()}>
            読み込む
          </Button>
          <input ref={fileRef} type="file" accept=".zip,application/zip" hidden onChange={(e) => void onPick(e)} />
        </div>
      </Row>
      <Row title="使用容量" desc="絵とバックアップ前のデータを含みます。">
        <span class="set-value num">
          {storage.usage !== null ? formatBytes(storage.usage) : '—'}
          {storage.quota !== null && <span class="faint"> / {formatBytes(storage.quota)}</span>}
        </span>
      </Row>
      <Row title="永続ストレージ" desc="オンなら、端末が勝手にデータを消しません。">
        <span class="set-value">{persisted.value === null ? '確認中' : persisted.value ? 'オン' : 'オフ'}</span>
      </Row>

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
    </Card>
  );
}

function AppearanceSection() {
  const s = settings.value;
  const prefs = uiPrefs.value;
  return (
    <Card class="set-card">
      <Row title="テーマ" desc="夜は暗めにすると目が楽です。">
        <Segment<Theme>
          label="テーマ"
          value={s?.theme ?? 'system'}
          options={[
            { value: 'light', label: 'ライト' },
            { value: 'dark', label: 'ダーク' },
            { value: 'system', label: '端末に合わせる' },
          ]}
          onChange={(v) => void saveSettings({ theme: v })}
        />
      </Row>
      <Row title="文字サイズ" desc="画面全体の文字が大きくなります。">
        <Segment<'normal' | 'large'>
          label="文字サイズ"
          value={prefs.fontScale}
          options={[
            { value: 'normal', label: '標準' },
            { value: 'large', label: '大きめ' },
          ]}
          onChange={(v) => void saveUiPrefs({ fontScale: v })}
        />
      </Row>
    </Card>
  );
}

function AboutSection() {
  return (
    <Card class="set-card">
      <Row title="成長通（せいちょうつう）" desc="毎日 15 分、一本道を 1 歩ずつ。">
        <span class="set-value num">版 {APP_VERSION}</span>
      </Row>
      <div class="set-about">
        <h3 class="set-about__title">点数の考え方</h3>
        <p>
          点数は線の精度だけを見ています。まっすぐさ、ブレ、狙った所に届いたか、といった測れるものだけです。
        </p>
        <p>絵全体の良し悪しは点数にしません。AI の先生が言葉で見ます。</p>
        <p>次へ進むのは「やったか」で決まります。点数で足止めはしません。</p>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 画面
// ---------------------------------------------------------------------------

export function Settings({ section }: { section?: string }) {
  const [active, setActive] = useState<SectionId>(isSection(section) ? section : 'ai');
  const [storage, refreshStorage] = useStorageInfo();
  const prefs = uiPrefs.value;

  useEffect(() => {
    if (isSection(section)) setActive(section);
  }, [section]);

  const current = SECTIONS.find((s) => s.id === active)!;

  return (
    <div class="settings">
      <aside class="settings__nav">
        <h1 class="settings__heading display">設定</h1>
        <ul class="settings__groups" role="tablist" aria-orientation="vertical">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                role="tab"
                aria-selected={s.id === active}
                class={s.id === active ? 'settings__group is-active' : 'settings__group'}
                onClick={() => setActive(s.id)}
              >
                {s.label}
              </button>
            </li>
          ))}
        </ul>
        <dl class="settings__status">
          <div>
            <dt>最終バックアップ</dt>
            <dd class="num">{prefs.lastBackupAt ? formatDate(prefs.lastBackupAt) : 'まだありません'}</dd>
          </div>
          <div>
            <dt>使用容量</dt>
            <dd class="num">{storage.usage !== null ? formatBytes(storage.usage) : '—'}</dd>
          </div>
          <div>
            <dt>永続ストレージ</dt>
            <dd>{persisted.value === null ? '確認中' : persisted.value ? 'オン' : 'オフ'}</dd>
          </div>
        </dl>
      </aside>
      <section class="settings__detail" role="tabpanel" aria-label={current.label}>
        <h2 class="settings__title display">{current.label}</h2>
        {active === 'ai' && <AiSection />}
        {active === 'scoring' && <ScoringSection />}
        {active === 'practice' && <PracticeSection />}
        {active === 'data' && <DataSection storage={storage} refreshStorage={refreshStorage} />}
        {active === 'appearance' && <AppearanceSection />}
        {active === 'about' && <AboutSection />}
      </section>
    </div>
  );
}
