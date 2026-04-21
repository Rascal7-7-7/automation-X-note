/**
 * YouTube コンテンツ生成
 *
 * フロー:
 *   1. youtube/queue/weekly_plan.json から今日のテーマ取得
 *      （なければ曜日ローテーション）
 *   2. type に応じて台本・タイトル・説明文・タグ・サムネイル文言を生成
 *      type: 'short' → 60秒以内の縦型ショート
 *      type: 'long'  → 10〜15分の長尺動画
 *   3. youtube/drafts/{date}/short.json または long.json に保存
 *
 * weekly_plan.json フォーマット:
 *   { "2026-04-14": { "theme": "AIツール活用術", "type": "short" } }
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generate } from '../shared/claude-client.js';
import { generateWithReview } from '../shared/multi-persona-reviewer.js';
import { logger } from '../shared/logger.js';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const DRAFTS_DIR = path.join(__dirname, 'drafts');
const QUEUE_DIR  = path.join(__dirname, 'queue');
const MODULE     = 'youtube:generate';

// ── プロンプト ──────────────────────────────────────────────────────

// AI体験コンテンツ5テンプレ — バズ×フォロー両立設計
// 構造: 違和感(フック) → AI技術(価値) → 変化(エンタメ) → オチ(記憶)
const SHORT_BUZZ_TEMPLATES = [
  { id: 1, name: 'AIデモ型',  hook: 'これAIって気づいた？',      cta: '何個気づいた？コメントで' },
  { id: 2, name: 'AI比較型',  hook: 'AIか現実か当ててみて',       cta: '正解はもう一回見るとわかる' },
  { id: 3, name: 'AI裏側型',  hook: 'このAIの作り方教えます',     cta: '試した人コメントで教えて' },
  { id: 4, name: 'AI進化型',  hook: '今のAI、もう別次元です',     cta: 'どっちが好き？コメントで' },
  { id: 5, name: 'AIループ型', hook: 'このAI映像どこか変です',     cta: '何個気づいた？もう一回見て' },
];

const SHORT_SCRIPT_SYSTEM = `あなたはYouTube AIコンテンツクリエイターです。
アカウントコンセプト:「AIで開発・SNS・副業がここまで変わる」を体験させる。バズ＋フォロー両立が目標。

【チャンネル方針（必ず守れ）】
- テーマ: AI活用法（AI×開発 / AI×SNS自動化 / AI×副業収益化）
- 具体ツール例: Claude Code, Cursor, GitHub Copilot, n8n, ChatGPT, Midjourney
- 必ず数字・実績を入れる: 「3分で完成」「月5万稼いだ」「コード量90%削減」
- 抽象的・哲学的な内容NG。視聴者が「今すぐ自分もできる」と感じる内容のみ

【必須構造（秒数と内容を守れ）】
[0秒] AIフック — 断定で視聴者を止める。「これ全部AIで作ってます」
[1-2秒] 違和感映像 — ちょっとおかしい。視聴者が「ん？」と思う
[3秒] ツール/技術の価値情報 — 「実は◯◯を使ってます」形式で具体的に
[4-6秒] 異常強化 — 「もう現実と区別つきません」レベルに引き上げ
[7-9秒] 心理的クライマックス — 「全部気づいた？」「もう一回見てみて」でループ視聴を誘導
[10秒] コメント誘導CTA — 「どうやって作ったと思う？」「気づいた？」

【テンプレート別構成】
1. AIデモ型: 「これ全部AIです」→違和感→「Runwayを使ってます」→異常→崩壊→「どう作ったと思う？」
2. AI比較型: AI映像→現実映像→「どっちかわかる？」→混在→判別不能→「正解コメントで」
3. AI裏側型: 「プロンプトはこれ」→生成→違和感→異常→「誰でも作れます」→「試した？」
4. AI進化型: 去年AI→今AI→差異拡大→「もう別物です」→最新ツール名→「どっちが好き？」
5. AIループ型: AI生成世界→違和感→異常→「気づいてください」→「全部気づいた？もう一回見てみて」

【hookTextパターン（11種から選択・最も強いものを選べ）】
① AI疑問形（定番）: 「これAIって気づいた？」
② 禁止系（スクロール停止最強）: 「これ気づいたら終わりです」「見てはいけない映像」
③ 恐怖系（感情トリガー）: 「このAI、もう止められない」「現実が崩れ始めてます」
④ 損失回避系（反応率MAX）: 「これ見逃すと損します」「最後まで見ないと意味ないです」
⑤ 痛み直撃系（副業志望者に刺さる）: 「時間ない人が見て」「副業できない人へ」
⑥ 常識破壊系（認知バイアス崩し）: 「稼げないは嘘です」「みんな間違えてる」
⑦ 数字証拠系（信頼感MAX）: 「月5万の証拠あり」「数字で証明します」
⑧ 秘密暴露系（独占情報感）: 「誰も知らない技術」「知る人だけが稼ぐ」
⑨ 質問巻き込み系（参加感・コメント誘発）: 「使えてますか？」「あなたはどっち？」
⑩ 劇的変化系（変化の不可逆性）: 「使ったら戻れない」「3ヶ月で別人になる」
⑪ 感情物語系（感情移入で引き込む）: 「副業が変わった話」「失敗から学んだAI」
→ 損失回避系④・痛み直撃系⑤が最も強い。副業志望者向けコンテンツは⑤を優先

【AIツール名 + 再現性 + 簡単そう感（重要）】
- script[2]: ツール名 + 時間感覚 or 簡単さ（最大14文字）
- 形式: 「Runwayで10分で作れる」「スマホで5分で完成」「誰でも無料で作れる」
- 時間・手軽さを入れることでフォロー・保存率が跳ねる

【絶対ルール】
- JSONのみ出力（説明・マークダウン不要）
- hookText: 12文字以内・上記11パターンのどれか
- script: 7要素の配列（絵文字・記号禁止）
  - script[0]: 最大16文字（違和感Lv1 軽 — "ん？"と思う程度）
  - script[1]: 最大16文字（違和感Lv2 中 — "おかしくない？"レベル）
  - script[2]: 最大14文字（AIツール名 + 再現性ヒント。例:「Runwayで作れます」）
  - script[3]: 最大16文字（違和感Lv3 強 — "完全にやばい"）
  - script[4]: 最大16文字（事件・予想外 — 視聴者が声を出すレベルの山場）
  - script[5]: 最大16文字（心理的ループ誘導CTA。「もう一回見てみて」「全部気づいた？」「もう一度見ると分かる」形式。視覚演出の説明文NG）
  - script[6]: 最大14文字（「何個気づいた？」必須。コメント誘導でアルゴリズム最適化）

出力フォーマット（このJSONのみ）:
{"template":N,"hookText":"テキスト","script":["行1","行2","行3","行4","行5","行6","行7"]}`;

const LONG_SCRIPT_SYSTEM = `あなたはYouTube AIコンテンツクリエイターです。
アカウントコンセプト:「AIで開発・SNS・副業がここまで変わる」を体験させる。バズ×学び×フォロー獲得が目標。

【チャンネル方針（必ず守れ）】
- テーマ: AI活用法（AI×開発 / AI×SNS自動化 / AI×副業収益化）
- 具体ツール例: Claude Code, Cursor, GitHub Copilot, n8n, ChatGPT, Midjourney
- 必ず数字・実績を入れる: 「3分で完成」「月5万稼いだ」「コード量90%削減」
- 抽象的・哲学的な内容NG。視聴者が「今すぐ自分もできる」と感じる内容のみ

【必須6フェーズ構成】
[HOOK 0:00〜0:05] AI暴露 + 価値明言 + 禁止/恐怖系フレーズ
  例: 「この映像、全部AIです。最後まで見ると戻れなくなります」
[PHASE 1 〜0:30] 主人公視点で普通を見せる — 「最初は普通だった」語りで始める。違和感を静かに仕込む
[PHASE 2 〜1:00] AI価値提供 — ツール名明示 + 「これスマホでも作れます」等の再現性ヒント + なぜすごいか
[PHASE 3 〜3:00] 制作過程を一瞬見せる — 「このシーン、実は[技術]で作ってます」。全部教えない（続きはフォロー）
[PHASE 4 〜5:00] 事件（山場）— 明らかにヤバいシーンを1つ強く入れる。視聴者が声を出すレベル。視聴維持率の山
[PHASE 5 〜8:00] 伏線回収 + 崩壊 — 「最初のシーンを思い出してください」で全部繋げる → 世界のルールが分かる
[OUTRO 〜10:00] 意味ある終わり — 「これ、全部AIです」→ 「何個気づいた？」CTA → 「最初から見ると全部わかります」ループ

【各フェーズのルール】
- HOOK: 禁止/恐怖系 + AI暴露必須。「最後まで見ると〇〇します」形式で引き込む
- PHASE1: 必ず「最初は普通だった」主人公視点で語る（ストーリーになる）
- PHASE2: AIツール名 + 「誰でも/スマホでも作れる」再現性を1文で示す
- PHASE4: 事件は1シーンに集中。「ここで全部が変わる」というターニングポイント
- PHASE5: PHASE1で仕込んだ違和感の正体を全部明かす → カタルシス
- OUTRO: 最後の一言は必ず「これ、全部AIです」。その後ループ誘導

- 話し言葉で自然に
- 各フェーズに【開始目安時刻】を付ける
出力: 台本構成テキストのみ`;

const TITLE_SYSTEM = `YouTubeのタイトル案を5個生成してください。
条件:
- 50文字以内（モバイル表示で全文見える上限）
- 主要キーワードを冒頭20文字以内に入れる（検索・アルゴリズム最重要）
- 「数字」「感情語」「意外性」の3要素のうち2つ以上を含む
- タイトルに #Shorts は入れない（説明文に入れる）
- クリック率（CTR）が高いパターン:
  「〇秒でわかる〇〇」「知らないと損する〇〇選」「月〇万稼いだ〇〇の全手順」
出力: 1〜5の番号付きリストのみ`;

const DESCRIPTION_SYSTEM = `YouTube動画の説明文を作成してください。
条件:
- 冒頭25語以内に主要キーワードを自然に含める（Google検索のmeta description扱い）
- 動画の価値・対象者・内容を3行以内に（「続きを読む」前に表示される部分）
- 本文300文字以上（短い説明文より検索ランキングが上がる）
- チャンネルテーマ: AI×開発・AI×SNS自動化・AI×副業収益化。具体ツール名・数字を含める
- ハッシュタグは3〜5個のみ・説明文末尾に（関連度が高いものだけ厳選）
  ※10個以上はスパム判定のリスクあり。#Shorts を必ず含める（ショートの場合）
- SNSリンクは追記するので不要
出力: 説明文テキストのみ`;

const SNS_FOOTER = `

---

🔔 チャンネル登録はこちら → https://www.youtube.com/@nucho0202
🐦 X(Twitter): https://x.com/Rascal_AI_Dev
📷 Instagram: https://www.instagram.com/ai_side_hack_/`;

const THUMBNAIL_SYSTEM = `YouTubeサムネイル用のテキスト案と画像生成プロンプト（英語）を作成してください。
条件:
- テキスト案: 視聴者が思わずクリックする15文字以内のキャッチコピー3案
- 画像プロンプト: FLUX/Stable Diffusion向け英語プロンプト（16:9比率）
  - 鮮やかな背景色・大きなテキスト・驚き/喜びの表情（人物あり）
  - YouTubeサムネイルらしいデザイン
フォーマット:
COPY: [3案を改行区切り]
PROMPT: [英語プロンプト]`;

// ── サムネイル画像生成（Gemini Imagen） ─────────────────────────────

async function generateThumbnailImage(thumbnailText, draftDir) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    logger.warn(MODULE, 'GEMINI_API_KEY not set — skipping thumbnail image generation');
    return null;
  }

  // サムネイルテキストから英語プロンプトを抽出
  const promptMatch = thumbnailText.match(/PROMPT:\s*(.+)/s);
  const imagePrompt = promptMatch
    ? promptMatch[1].trim()
    : `YouTube thumbnail, vibrant background, bold text, surprised expression, 16:9 ratio, professional design`;

  try {
    let GoogleGenAI;
    try {
      ({ GoogleGenAI } = await import('@google/genai'));
    } catch {
      logger.warn(MODULE, '@google/genai not installed — skipping thumbnail image generation');
      return null;
    }

    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateImages({
      model: 'imagen-4.0-generate-001',
      prompt: imagePrompt,
      config: { numberOfImages: 1, aspectRatio: '16:9' },
    });

    const imageData = response?.generatedImages?.[0]?.image?.imageBytes;
    if (!imageData) {
      logger.warn(MODULE, 'no image data returned from Gemini');
      return null;
    }

    const thumbnailPath = path.join(draftDir, 'thumbnail.png');
    fs.writeFileSync(thumbnailPath, Buffer.from(imageData, 'base64'));
    logger.info(MODULE, `thumbnail saved → ${thumbnailPath}`);
    return thumbnailPath;
  } catch (err) {
    logger.warn(MODULE, 'thumbnail image generation failed', { message: err.message });
    return null;
  }
}

// ── メイン ──────────────────────────────────────────────────────────

export async function runGenerate({ type, topic } = {}) {
  const today    = new Date().toISOString().split('T')[0];
  const { theme, videoType, series, episode, template: planTemplate, aiTool } = getTodayContent({ type, topic });

  logger.info(MODULE, `generating ${videoType} for theme: "${theme}"${series ? ` [${series} #${episode}]` : ''}`);

  const draftDir = path.join(DRAFTS_DIR, today);
  if (!fs.existsSync(draftDir)) fs.mkdirSync(draftDir, { recursive: true });

  const seriesLabel = series && episode ? `\nシリーズ: ${series} #${episode}` : '';
  const aiToolLabel = aiTool ? `\n使用AIツール: ${aiTool}` : '';
  const context = `テーマ: ${theme}\n動画タイプ: ${videoType === 'short' ? 'YouTubeショート（60秒以内）' : 'YouTube長尺動画（10〜15分）'}${seriesLabel}${aiToolLabel}`;
  const scriptSystem = videoType === 'short' ? SHORT_SCRIPT_SYSTEM : LONG_SCRIPT_SYSTEM;

  const scriptModel = videoType === 'long' ? 'claude-opus-4-7' : 'claude-sonnet-4-6';

  // planで指定があればそれを使う、なければランダム
  const templateId = videoType === 'short'
    ? (planTemplate ?? SHORT_BUZZ_TEMPLATES[Math.floor(Math.random() * SHORT_BUZZ_TEMPLATES.length)].id)
    : null;
  const scriptContext = templateId
    ? `${context}\n使用テンプレート番号: ${templateId}`
    : context;

  // ショートはペルソナレビューでhookText品質を担保、長尺は直接生成
  let rawScript;
  if (videoType === 'short') {
    const { content } = await generateWithReview(
      (hint) => generate(
        scriptSystem,
        hint ? `${scriptContext}\n\n【改善指示】\n${hint}` : scriptContext,
        { model: scriptModel, maxTokens: 512 },
      ),
      'YouTube', 'youtube-short',
    );
    rawScript = content;
  } else {
    rawScript = await generate(scriptSystem, scriptContext, { model: scriptModel, maxTokens: 3000 });
  }

  const [titles, description, thumbnail] = await Promise.all([
    generate(TITLE_SYSTEM, context, { maxTokens: 512 }),
    generate(DESCRIPTION_SYSTEM, context, { model: scriptModel, maxTokens: 1024 }),
    generate(THUMBNAIL_SYSTEM, context, { maxTokens: 512 }),
  ]);

  // ショートはJSONパース → script文字列 + hookText 抽出
  let script = rawScript;
  let hookText = null;
  if (videoType === 'short') {
    try {
      // strip markdown fences, then extract balanced JSON object
      const stripped = rawScript.replace(/```[a-z]*\n?/g, '').trim();
      const start = stripped.indexOf('{');
      if (start !== -1) {
        let depth = 0, end = -1;
        for (let i = start; i < stripped.length; i++) {
          if (stripped[i] === '{') depth++;
          else if (stripped[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
        }
        if (end !== -1) {
          const parsed = JSON.parse(stripped.slice(start, end + 1));
          script   = Array.isArray(parsed.script) ? parsed.script.join('\n') : rawScript;
          hookText = parsed.hookText ?? SHORT_BUZZ_TEMPLATES[(templateId ?? 1) - 1]?.hook ?? null;
        }
      }
    } catch (e) {
      logger.warn(MODULE, `short script JSON parse failed: ${e.message}`);
      hookText = SHORT_BUZZ_TEMPLATES[(templateId ?? 1) - 1]?.hook ?? null;
    }
  }

  // タグ生成（説明文からハッシュタグを抽出）
  const descriptionWithFooter = description.trimEnd() + SNS_FOOTER;
  const tags = extractTags(descriptionWithFooter);

  // サムネイル画像生成（Gemini Imagen）
  const thumbnailPath = await generateThumbnailImage(thumbnail, draftDir);

  const draft = {
    theme,
    type: videoType,
    series:      series  ?? null,
    episode:     episode ?? null,
    aiTool:      aiTool  ?? null,
    hookText,
    buzzTemplate: templateId,
    script,
    titles: parseTitles(titles),
    description: descriptionWithFooter,
    tags,
    thumbnail,
    thumbnailPath,
    date: today,
    status: 'ready',
    videoPath: null,      // 動画ファイルパス（upload時に設定）
    videoId: null,        // YouTube動画ID（upload後に設定）
    crossPublished: false,
    createdAt: new Date().toISOString(),
  };

  const draftPath = path.join(draftDir, `${videoType}.json`);
  fs.writeFileSync(draftPath, JSON.stringify(draft, null, 2));
  logger.info(MODULE, `draft saved → ${draftPath}`);

  return draft;
}

// ── ヘルパー ─────────────────────────────────────────────────────────

function getTodayContent({ type, topic } = {}) {
  const planFile = path.join(QUEUE_DIR, 'weekly_plan.json');
  const dayIndex = new Date().getDay();

  if (!type && !topic && fs.existsSync(planFile)) {
    try {
      const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
      const key  = new Date().toISOString().split('T')[0];
      if (plan[key]) {
        const entry = plan[key];
        return {
          theme:     entry.theme     ?? defaultTheme(dayIndex),
          videoType: entry.type      ?? 'short',
          series:    entry.series    ?? null,
          episode:   entry.episode   ?? null,
          template:  entry.template  ?? null,
          aiTool:    entry.aiTool    ?? null,
        };
      }
    } catch { /* fallback */ }
  }

  const defaults = [
    'AIツールで副業収益を上げる方法',
    'Claude Codeの使い方完全ガイド',
    '生成AIで作業を10倍速にする',
    'ChatGPTとClaudeの使い分け',
    'AI副業で月10万円稼ぐ仕組み',
    'おすすめAIツール厳選5選',
    'AI初心者が最初にやること',
  ];

  return {
    theme:     topic ?? defaults[dayIndex],
    videoType: type  ?? 'short',
    series:    null,
    episode:   null,
    template:  null,
    aiTool:    null,
  };
}

function defaultTheme(dayIndex) {
  const defaults = [
    'AIツールで副業収益を上げる方法',
    'Claude Codeの使い方完全ガイド',
    '生成AIで作業を10倍速にする',
    'ChatGPTとClaudeの使い分け',
    'AI副業で月10万円稼ぐ仕組み',
    'おすすめAIツール厳選5選',
    'AI初心者が最初にやること',
  ];
  return defaults[dayIndex];
}

function parseTitles(raw) {
  return raw
    .split('\n')
    .filter(l => /^\d[\.\)]/.test(l.trim()))
    .map(l => l.replace(/^\d[\.\)]\s*/, '').trim())
    .filter(Boolean);
}

function extractTags(description) {
  const matches = description.match(/#[\w\u3040-\u9FFF]+/g) ?? [];
  return [...new Set(matches.map(t => t.slice(1)))].slice(0, 15);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [type, ...rest] = process.argv.slice(2);
  const topic = rest.join(' ') || undefined;
  runGenerate({ type: type ?? 'short', topic });
}
