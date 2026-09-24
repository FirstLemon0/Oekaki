/**
 * 教材レビュー「本文とアプリの動きのずれ」の修正を実操作で確かめる。
 *
 * - 構築ステップの手順カードが、ツールバー・グリッド欄・課題ピルと重ならずに読める（横・縦）。図解はタップで拡大できる
 * - copy の横表示のお手本と、重ね表示（キャンバスに収まる最大）の大きさが同じ（横・縦）
 * - 補助線はドリルで採点されない（本数・点数チップが増えない）
 * - ポーズ群: ?seed= で固定した出題が、群の母集団から pickPoseSequence どおりに出る
 *
 * 教材（content/**）は教材担当が並行して組み替えるので、対象のステップは教材 JSON から探す。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { POSE_GROUPS, pickPoseSequence, poseIdsOf, type PoseGroup } from '../src/mannequin/poses';
import { drawLine, gotoApp } from './helpers';

type AnyStep = { type: string; [k: string]: unknown };
type AnyLesson = { id: string; steps: AnyStep[] };

function allLessons(): AnyLesson[] {
  const dir = fileURLToPath(new URL('../content/stages', import.meta.url));
  const out: AnyLesson[] = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
    const stage = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { units?: { lessons: AnyLesson[] }[] };
    for (const u of stage.units ?? []) out.push(...u.lessons);
  }
  return out;
}

type Hit = { lessonId: string; index: number; step: AnyStep };

/** 条件に合う最初のステップ（prefer のレッスンにあればそれを優先）。無ければ null */
function tryFindStep(pred: (s: AnyStep) => boolean, prefer?: string): Hit | null {
  const lessons = allLessons();
  const ordered = prefer ? [...lessons.filter((l) => l.id === prefer), ...lessons.filter((l) => l.id !== prefer)] : lessons;
  for (const l of ordered) {
    const index = l.steps.findIndex(pred);
    if (index >= 0) return { lessonId: l.id, index, step: l.steps[index]! };
  }
  return null;
}

function findStep(pred: (s: AnyStep) => boolean, prefer?: string): Hit {
  const hit = tryFindStep(pred, prefer);
  if (!hit) throw new Error('条件に合うステップが教材にありません');
  return hit;
}

type Box = { x: number; y: number; width: number; height: number };

async function box(l: Locator): Promise<Box> {
  const b = await l.boundingBox();
  if (!b) throw new Error('要素が表示されていません');
  return b;
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5;
}

async function openStep(page: Page, lessonId: string, index: number, search = ''): Promise<void> {
  await page.goto(`/${search}#/lesson/${lessonId}/step/${index}`);
  await page.locator('.loading').waitFor({ state: 'detached' }).catch(() => undefined);
}

/** 構築（最初の手順に図解があるもの。s2-u2-l1 を優先） */
const constructHit = () =>
  findStep((s) => s.type === 'construct' && Array.isArray(s.stages) && Boolean((s.stages as { figure?: string }[])[0]?.figure), 's2-u2-l1');

async function expectCardReadable(page: Page, portrait: boolean): Promise<void> {
  const card = page.getByTestId('construct-card');
  await expect(card).toBeVisible();
  const column = page.getByTestId('canvas-topleft');
  const task = column.locator('.ls-task');
  await expect(task).toBeVisible();
  const cardBox = await box(card);
  const taskBox = await box(task);
  const toolbar = await box(page.locator('.ls-toolbar'));
  const grid = await box(page.locator('.ls-gridseg'));
  const vp = page.viewportSize()!;

  // ツールバー・グリッド欄と重ならない。課題ピルとも重ならない（ピルはカードの上）
  for (const b of [toolbar, grid]) {
    expect(overlaps(cardBox, b)).toBe(false);
    expect(overlaps(taskBox, b)).toBe(false);
  }
  expect(overlaps(cardBox, taskBox)).toBe(false);
  expect(taskBox.y + taskBox.height).toBeLessThanOrEqual(cardBox.y + 1);
  // 画面の中に収まっている
  expect(cardBox.x).toBeGreaterThanOrEqual(0);
  expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(vp.width);
  expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(vp.height);

  if (portrait) {
    // 縦向き: ツールバー（とグリッド欄）の下、上部に横長
    expect(taskBox.y).toBeGreaterThanOrEqual(Math.max(toolbar.y + toolbar.height, grid.y + grid.height));
    expect(cardBox.width).toBeGreaterThan(700);
  } else {
    // 横向き: ツールバーとグリッド欄の右隣。幅 360〜420
    expect(cardBox.x).toBeGreaterThanOrEqual(Math.max(toolbar.x + toolbar.width, grid.x + grid.width));
    expect(cardBox.width).toBeGreaterThanOrEqual(360);
    expect(cardBox.width).toBeLessThanOrEqual(420);
  }

  // 図解は 280px 以上
  const fig = card.getByTestId('zoom-figure');
  await expect(fig.locator('.ls-figure svg')).toBeVisible();
  const figBox = await box(fig);
  expect(figBox.width).toBeGreaterThanOrEqual(280);

  // 手順の見出し・本文が読める（カードの外にはみ出さない）
  await expect(card.locator('.ls-construct__title')).toBeVisible();
  await expect(card.locator('.ls-construct__text')).toBeVisible();

  // タップで拡大（画面幅の 80%）
  await fig.click();
  const sheet = page.getByTestId('figure-sheet');
  await expect(sheet).toBeVisible();
  const sheetBox = await box(sheet);
  expect(Math.abs(sheetBox.width - vp.width * 0.8)).toBeLessThanOrEqual(2);
  const bigFig = await box(sheet.locator('.ls-figsheet__fig svg'));
  expect(bigFig.width).toBeGreaterThan(figBox.width * 1.8);
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
}

/** 横のお手本（inline SVG）と重ね（キャンバスに収まる最大）の縮尺を比べる */
async function expectSameReferenceScale(page: Page): Promise<void> {
  const svg = page.getByTestId('ref-side').locator('svg').first();
  await expect(svg).toBeVisible();
  const viewBox = (await svg.getAttribute('viewBox')) ?? '0 0 800 500';
  const [, , vw, vh] = viewBox.split(/[\s,]+/).map(Number) as [number, number, number, number];
  const side = await box(svg);
  const paper = await box(page.locator('.ls-canvas__paper'));
  // inline SVG は枠に contain、重ねは紙に contain（engine の drawOverlay）
  const sideScale = Math.min(side.width / vw, side.height / vh);
  const overlayScale = Math.min(paper.width / vw, paper.height / vh);
  expect(Math.abs(sideScale - overlayScale) * vw).toBeLessThanOrEqual(3);
}

test.describe('教材との整合（構築カード・お手本の大きさ・補助線・ポーズ群）', () => {
  test('構築ステップの手順カードが読める（横向き）', async ({ page }) => {
    await gotoApp(page);
    const hit = constructHit();
    await openStep(page, hit.lessonId, hit.index);
    await expectCardReadable(page, false);
  });

  test('構築ステップの手順カードが読める（縦向き）', async ({ page }) => {
    await page.setViewportSize({ width: 920, height: 1472 });
    await gotoApp(page);
    const hit = constructHit();
    await openStep(page, hit.lessonId, hit.index);
    await expectCardReadable(page, true);
  });

  test('copy: 横に出るお手本と重ね表示の大きさが同じ（横・縦）', async ({ page }) => {
    await gotoApp(page);
    const hit = findStep((s) => s.type === 'copy' && s.reference === 'builtin' && typeof s.refId === 'string', 's1-u5-l2');
    await openStep(page, hit.lessonId, hit.index);
    await expectSameReferenceScale(page);

    // 描いて「重ねて見る」→ 重ねてもお手本の枠はそのまま（同じ縮尺）
    const canvas = page.locator('.ls-canvas__paper canvas');
    await drawLine(page, canvas);
    await page.getByRole('button', { name: '重ねて見る' }).click();
    await expect(page.getByRole('button', { name: '重ねを外す' })).toBeVisible();
    await expectSameReferenceScale(page);

    await page.setViewportSize({ width: 920, height: 1472 });
    await expect(page.locator('.ls-canvas.has-side-match')).toBeVisible();
    await expect
      .poll(async () => {
        const side = await box(page.getByTestId('ref-side'));
        const paper = await box(page.locator('.ls-canvas__paper'));
        return side.y + side.height <= paper.y + 1;
      })
      .toBe(true);
    await expectSameReferenceScale(page);
  });

  test('補助線はドリルで採点されない（本数・点数が増えない）', async ({ page }) => {
    await gotoApp(page);
    const hit = findStep((s) => s.type === 'drill' && s.drill === 'line' && Number(s.count) >= 2);
    await openStep(page, hit.lessonId, hit.index);
    await page.getByRole('button', { name: '描く' }).click();
    const canvas = page.locator('.ls-canvas__paper canvas');
    await expect(canvas).toBeVisible();
    const counter = page.locator('.ls-counter');
    const first = `1/${Number(hit.step.count)}`;
    await expect(counter).toHaveText(first);

    // 補助線を選んで長い線を 2 本 → 数えない・採点しない
    const guideBtn = page.getByRole('button', { name: /^補助線/ });
    await guideBtn.click();
    await expect(guideBtn).toHaveAttribute('aria-pressed', 'true');
    await drawLine(page, canvas);
    await drawLine(page, canvas, { yRatio: 0.6 });
    await expect(counter).toHaveText(first);
    await expect(page.getByTestId('score-chip')).toHaveCount(0);
    // 補助線は履歴には残る（取り消されない）: 元に戻すが押せる
    await expect(page.getByRole('button', { name: '元に戻す' })).toBeEnabled();

    // ペンに戻して引くと、1 本目として採点される
    await page.getByRole('button', { name: 'ペン' }).click();
    await drawLine(page, canvas, { yRatio: 0.45 });
    await expect(page.getByTestId('score-chip')).toHaveCount(1);
    await expect(counter).toHaveText(`2/${Number(hit.step.count)}`);
  });

  test('構築の keepPrevious: 直前のなぞりの線を残したまま始まる', async ({ page }) => {
    const lessons = allLessons();
    const lesson = lessons.find((l) =>
      l.steps.some((s, i) => s.type === 'construct' && s.keepPrevious === true && l.steps[i - 1]?.type === 'trace'),
    );
    test.skip(!lesson, '教材に「なぞり → keepPrevious の構築」がまだ無い');
    const ci = lesson!.steps.findIndex((s, i) => s.type === 'construct' && s.keepPrevious === true && lesson!.steps[i - 1]?.type === 'trace');
    const trace = lesson!.steps[ci - 1]!;
    await gotoApp(page);
    await openStep(page, lesson!.id, ci - 1);
    const canvas = page.locator('.ls-canvas__paper canvas');
    const count = Number(trace.count ?? 1);
    for (let k = 0; k < count; k++) {
      await drawLine(page, canvas);
      await page.locator('.ls-donebtn').click();
      await page.locator('.ls-sheet').getByRole('button', { name: k + 1 >= count ? '完了' : '次へ', exact: true }).click();
    }
    // 構築に進むと、なぞりの線が紙に残っている（紙色と違う画素がある）
    await expect(page.getByTestId('construct-card')).toBeVisible();
    await expect
      .poll(async () =>
        canvas.evaluate((el: HTMLCanvasElement) => {
          const c = el.getContext('2d')!;
          const { data } = c.getImageData(0, 0, el.width, el.height);
          let ink = 0;
          for (let i = 0; i < data.length; i += 4) if (data[i]! + data[i + 1]! + data[i + 2]! < 300) ink++;
          return ink;
        }),
      )
      .toBeGreaterThan(50);
    // 引き継いだ線は Undo では消えない
    await expect(page.getByRole('button', { name: '元に戻す' })).toBeDisabled();
  });

  test('ポーズ群: seed を固定すると、群の中から pickPoseSequence どおりに出る', async ({ page }) => {
    const seed = 42;
    // 群で絞ったステップ（standing / sitting / action）があればそれ。無ければ全種（all）のステップ
    const target =
      tryFindStep((s) => s.type === 'gesture' && s.source === 'mannequin' && typeof s.poseGroup === 'string' && s.poseGroup !== 'all') ??
      findStep((s) => s.type === 'gesture' && s.source === 'mannequin');
    const group = ((target.step.poseGroup as string | undefined) ?? 'all') as PoseGroup;
    const expected = pickPoseSequence(Number(target.step.count), seed, poseIdsOf(group));

    await gotoApp(page);
    await openStep(page, target.lessonId, target.index, `?seed=${seed}`);
    const side = page.getByTestId('pose-side');
    await expect(side).toBeVisible();
    await expect(side).toHaveAttribute('data-pose-group', group);
    const pose = await side.getAttribute('data-pose');
    expect(pose).toBe(expected[0]);
    expect(POSE_GROUPS[group]).toContain(pose);
  });
});
