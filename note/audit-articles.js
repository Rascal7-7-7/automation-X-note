/**
 * note 記事監査スクリプト
 * - 全投稿済みドラフトのnoteURLをHTTPで取得
 * - カバー画像有無・有料設定・誤誘導テキスト・下書き残留を確認
 * - 修正が必要な記事を一覧出力
 *
 * Usage: node note/audit-articles.js
 */
import 'dotenv/config';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DRAFTS_DIRS = [
  { dir: path.join(__dirname, 'drafts'),          accountId: 1 },
  { dir: path.join(__dirname, 'drafts/account2'), accountId: 2 },
  { dir: path.join(__dirname, 'drafts/account3'), accountId: 3 },
];

const MISLEADING_TEXT = '続きは有料部分で解説します';

function fetchHtml(url) {
  return new Promise((resolve) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html',
        'Accept-Language': 'ja',
      },
    }, res => {
      // Follow single redirect
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchHtml(res.headers.location).then(resolve);
        return;
      }
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, html: data }));
    });
    req.on('error', () => resolve({ status: 0, html: '' }));
    req.setTimeout(15_000, () => { req.destroy(); resolve({ status: 0, html: '' }); });
  });
}

function checkArticle(html, draft) {
  const issues = [];

  // 1. カバー画像: og:image が social_images/ → note自動生成（実質カバーなし）
  //    uploads/images/ → ユーザーアップロード済み
  const ogImageMatch = html.match(/property="og:image"\s+content="([^"]+)"/);
  const ogImage = ogImageMatch?.[1] ?? '';
  if (!ogImage) {
    issues.push('カバー画像なし（og:imageなし）');
  } else if (ogImage.includes('social_images')) {
    issues.push('カバー画像なし（自動生成OGP）');
  }

  // 2. 有料設定: ¥500設定済みなら note.com に「価格」表示がある
  // note.com shows paid price as: <span>¥500</span> in article button
  const isPaidOnNotecom = /¥\d+/.test(html) && (html.includes('¥500') || html.includes('¥300') || html.includes('¥1000'));

  if (draft.price && draft.price > 0 && !isPaidOnNotecom) {
    issues.push(`有料設定なし（ローカルは¥${draft.price}だがnote.comは無料公開）`);
  }

  // 3. 無料記事に有料誘導テキスト
  const hasBodyMisleading = html.includes(MISLEADING_TEXT);
  const isFreeOnNotecom = !isPaidOnNotecom;
  if (isFreeOnNotecom && hasBodyMisleading) {
    issues.push('無料公開なのに「続きは有料部分で解説します↓」が残存 → 削除必要');
  }

  // 4. 下書き残留の兆候（note.comではログイン必須のため外部検出不可 — 注意喚起のみ）
  // ※ 編集履歴はログイン後に確認が必要

  return { ogImage, isPaidOnNotecom, issues };
}

async function loadAllPostedDrafts() {
  const items = [];
  for (const { dir, accountId } of DRAFTS_DIRS) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.json'))) {
      try {
        const draft = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        if (draft.status === 'posted' && draft.noteUrl) {
          items.push({ draft: { ...draft, accountId: draft.accountId ?? accountId }, filePath: path.join(dir, f) });
        }
      } catch { /* skip */ }
    }
  }
  return items;
}

async function runAudit() {
  console.log('=== note 記事監査 ===\n');
  const items = await loadAllPostedDrafts();
  console.log(`対象記事: ${items.length}件\n`);

  const results = [];

  for (const { draft, filePath } of items) {
    process.stdout.write(`checking acct${draft.accountId}: ${draft.title?.slice(0, 30)}... `);
    const { status, html } = await fetchHtml(draft.noteUrl);

    if (status === 0 || status >= 400) {
      console.log(`[ERROR ${status}]`);
      results.push({ draft, filePath, issues: [`HTTPエラー: ${status}`], ogImage: '', isPaidOnNotecom: false });
      continue;
    }

    const { ogImage, isPaidOnNotecom, issues } = checkArticle(html, draft);
    const hasMisleading = (draft.freeBody ?? draft.body ?? '').includes(MISLEADING_TEXT);

    console.log(issues.length === 0 ? '✓ OK' : `✗ ${issues.length}件の問題`);
    results.push({ draft, filePath, issues, ogImage, isPaidOnNotecom, hasMisleading });

    // Rate limit: 1秒間隔
    await new Promise(r => setTimeout(r, 1_000));
  }

  // ── レポート出力 ─────────────────────────────────────────────────
  console.log('\n=== 監査レポート ===\n');

  const problemItems = results.filter(r => r.issues.length > 0);
  if (problemItems.length === 0) {
    console.log('問題なし — 全記事OK');
    return results;
  }

  let noCover = 0, notPaid = 0, misleading = 0;

  for (const { draft, filePath, issues } of problemItems) {
    console.log(`【acct${draft.accountId}】${draft.title}`);
    console.log(`  URL: ${draft.noteUrl}`);
    console.log(`  ファイル: ${path.basename(filePath)}`);
    for (const issue of issues) console.log(`  ⚠️  ${issue}`);
    console.log('');

    if (issues.some(i => i.includes('カバー'))) noCover++;
    if (issues.some(i => i.includes('有料設定なし'))) notPaid++;
    if (issues.some(i => i.includes('続きは有料'))) misleading++;
  }

  console.log(`--- 集計 ---`);
  console.log(`カバー画像なし: ${noCover}件`);
  console.log(`有料設定なし  : ${notPaid}件`);
  console.log(`誤誘導テキスト: ${misleading}件`);
  console.log(`要修正合計    : ${problemItems.length}件 / ${results.length}件`);

  return results;
}

runAudit();
