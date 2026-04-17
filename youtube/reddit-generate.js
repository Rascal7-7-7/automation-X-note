/**
 * Reddit → YouTube台本生成モジュール
 *
 * youtube/queue/reddit_queue.json を読み込み、
 * 英語投稿を日本語5行スクリプトに変換して
 * youtube/drafts/{today}/reddit-short.json に保存する。
 *
 * 生成後は reddit_queue.json を削除（処理済みマーク）
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generate } from '../shared/claude-client.js';
import { logger } from '../shared/logger.js';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const DRAFTS_DIR = path.join(__dirname, 'drafts');
const QUEUE_FILE = path.join(__dirname, 'queue', 'reddit_queue.json');
const MODULE     = 'youtube:reddit-generate';

// ── プロンプト ──────────────────────────────────────────────────────

const SCRIPT_SYSTEM = `あなたはYouTubeショート動画のテロップライターです。
英語のReddit投稿を日本語に翻訳し、視聴者が最後まで見たくなる10〜12行のスクリプトを作成してください。

【絶対ルール】
- 出力は10〜12行のプレーンテキストのみ
- 1行 = 1テロップ、最大20文字
- Markdown記号（** # --- [] 【】 ✅ ・ > 等）は一切使わない
- ラベル・番号・記号・絵文字を使わない
- 投稿内容を正確に翻訳する（誇張・創作しない）

【構成】
1行目: 投稿タイトル（衝撃的・短縮）
2行目: 続きが気になる一言
3行目: 投稿の詳細・背景
4行目: 核心・驚きの事実
5行目: コメント1（スコア最高）を正確に翻訳
6行目: コメント2を正確に翻訳
7行目: コメント3を正確に翻訳
8行目: コメント4を正確に翻訳
9行目: コメント5を正確に翻訳
10行目: 総括・オチ
11行目: 視聴者への問いかけ
12行目（オプション）: 締めの一言

【良い例】
OpenClawが勝手にLINE送信
元カノに「また会いたい」と送った
AIに連絡先を与えたら暴走した
開発者本人も予期していなかった
「これ笑える、でも怖い」5万いいね
「俺のAIはAmazonで爆買いした」
「次は告白するの？」と茶化す声も
「さすがにこれはオフにした」共感
「でも少し嬉しかった」本音コメント
AIの暴走は笑い事じゃなくなってきた
あなたのAIはまだ安全ですか？

出力は10〜12行テキストのみ。`;

const TITLE_SYSTEM = `以下のReddit投稿を元に、日本語YouTubeタイトル案を5個生成してください。

条件:
- 50文字以内
- 「海外の反応」「Reddit民が」「AI界隈で話題」等のフレーズを活用
- クリック率が高いパターン:「〜に衝撃」「〜が話題沸騰」「〜の真実」「海外では〜」
- #Shorts は含めない（説明文に入れる）

出力: 1〜5の番号付きリストのみ`;

const DESCRIPTION_SYSTEM = `以下のReddit投稿を元に、YouTube動画の日本語説明文を作成してください。

条件:
- 冒頭2行以内に「海外Reddit」「r/{subreddit}」を自然に含める
- 元の投稿URLを末尾に掲載
- 本文150文字以上
- ハッシュタグ: #Reddit #海外の反応 #AI #Shorts を必ず含める

出力: 説明文テキストのみ`;

// ── メイン ──────────────────────────────────────────────────────────

export async function runGenerate({ type = 'reddit-short' } = {}) {
  if (!fs.existsSync(QUEUE_FILE)) {
    logger.warn(MODULE, 'reddit_queue.json not found — run reddit-fetch first');
    return { generated: false, reason: 'no queue' };
  }

  const item  = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
  const today = new Date().toISOString().split('T')[0];
  const draftDir  = path.join(DRAFTS_DIR, today);
  const draftPath = path.join(draftDir, `${type}.json`);

  if (!fs.existsSync(draftDir)) fs.mkdirSync(draftDir, { recursive: true });

  if (fs.existsSync(draftPath)) {
    const existing = JSON.parse(fs.readFileSync(draftPath, 'utf8'));
    if (existing.status !== 'error') {
      logger.info(MODULE, `draft already exists for ${type}, skipping`);
      return { generated: false, reason: 'already generated' };
    }
  }

  const context = buildContext(item);
  logger.info(MODULE, `generating ${type} from r/${item.subreddit}: "${item.title.slice(0, 50)}"`);

  const [script, titles, description] = await Promise.all([
    generate(SCRIPT_SYSTEM, context, { model: 'claude-sonnet-4-6', maxTokens: 512 }),
    generate(TITLE_SYSTEM,  context, { maxTokens: 512 }),
    generate(
      DESCRIPTION_SYSTEM.replace('{subreddit}', item.subreddit),
      context,
      { maxTokens: 512 }
    ),
  ]);

  const parsedTitles = titles
    .split('\n')
    .filter(l => /^\d[\.\)]/.test(l.trim()))
    .map(l => l.replace(/^\d[\.\)]\s*/, '').trim())
    .filter(Boolean);

  const lines = script.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  const draft = {
    theme:       `海外Reddit r/${item.subreddit}: ${item.title.slice(0, 40)}`,
    type,
    script,
    sceneCount:  lines.length,
    titles:      parsedTitles,
    description: description + `\n\n元投稿: ${item.url}`,
    tags:        ['Reddit', '海外の反応', 'AI', item.subreddit, 'Shorts', 'ChatGPT', '生成AI'],
    thumbnail:   null,
    thumbnailPath: null,
    thumbnailUrl:  item.thumbnailUrl ?? null,
    redditSource: {
      id:          item.id,
      subreddit:   item.subreddit,
      title:       item.title,
      score:       item.score,
      numComments: item.numComments,
      url:         item.url,
      imageUrl:    item.imageUrl ?? null,
    },
    date:         today,
    status:       'ready',
    videoPath:    null,
    videoId:      null,
    captionsPath: null,
    crossPublished: false,
    createdAt:    new Date().toISOString(),
  };

  fs.writeFileSync(draftPath, JSON.stringify(draft, null, 2));
  fs.rmSync(QUEUE_FILE, { force: true }); // 処理済み → キュー削除

  logger.info(MODULE, `draft saved → ${draftPath}`);
  return { generated: true, draft };
}

// ── ヘルパー ──────────────────────────────────────────────────────

function buildContext(item) {
  const commentLines = item.comments
    .slice(0, 8)
    .map((c, i) => `${i + 1}. [score: ${c.score}] ${c.text}`)
    .join('\n');

  return [
    `サブレディット: r/${item.subreddit}`,
    `投稿スコア: ${item.score} (コメント数: ${item.numComments})`,
    `タイトル: ${item.title}`,
    item.selftext ? `本文: ${item.selftext}` : '',
    '',
    'トップコメント:',
    commentLines,
  ].filter(Boolean).join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [type] = process.argv.slice(2);
  runGenerate({ type: type ?? 'reddit-short' });
}
