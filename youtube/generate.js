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

// AI体験コンテンツ8テンプレ — バズ×フォロー×副業実用両立設計
// 1-5: 違和感エンタメ系（フォロワー獲得）  6-8: 手順実用系（保存・CV重視）
const SHORT_BUZZ_TEMPLATES = [
  { id: 1, name: 'AIデモ型',   hook: 'これAIって気づいた？',        cta: '何個気づいた？コメントで' },
  { id: 2, name: 'AI比較型',   hook: 'AIか現実か当ててみて',         cta: '正解はもう一回見るとわかる' },
  { id: 3, name: 'AI裏側型',   hook: 'このAIの作り方教えます',       cta: '試した人コメントで教えて' },
  { id: 4, name: 'AI進化型',   hook: '今のAI、もう別次元です',       cta: 'どっちが好き？コメントで' },
  { id: 5, name: 'AIループ型', hook: 'このAI映像どこか変です',       cta: '何個気づいた？もう一回見て' },
  { id: 6, name: '手順暴露型', hook: 'やり方を全部教えます',         cta: 'やってみたらコメントで' },
  { id: 7, name: '実績証拠型', hook: '月5万の証拠あります',          cta: '保存して後で試して' },
  { id: 8, name: '速報型',     hook: 'たった今すべて変わりました',   cta: 'まだ知らない人は急いで' },
];

const SHORT_SCRIPT_SYSTEM = `あなたは「ぬちょ【AI副業ハック】」YouTubeチャンネルのナレーター兼構成作家です。
実際にバズっている日本語YouTubeショート（47万〜81万再生）を徹底分析した結果に基づき、
再現性の高い台本を生成します。

【バズ動画から学んだ絶対ルール】
1. 全シーンにナレーションあり — 無音は0秒。BGMは常に流れ、喋りも止めない
2. 毎シーン「動詞+目的語+数値」— 「Claude Codeに貼る（動詞）→ note記事（目的語）→ 10秒で完了（数値）」
3. 最終シーン必ずCTA — 「フォローして」「コメントして」「次の動画で話します」で終わる
4. 1シーン = 4〜6秒 = 20〜30文字のナレーション（春日部つむぎが自然に読める量）
5. 証拠数字を冒頭に — 「月3万円」「先月32,000円振り込まれた」など実績数字を0〜5秒に出す
6. ツール名を必ず呼ぶ — 「Claude Code」「n8n」「ChatGPT」など具体名を最低2回使う
7. 抽象NG — 「AIを使えば稼げます」は0再生。「Claude Codeでnoteを書いてASPリンクを貼る」が正解

【テンプレート別構成 — 全8シーン、合計50〜60秒】

■ テンプレート6（手順暴露型）— 「やり方を全部教えます」
[シーン1 0-5秒] フック+実績数字: 「Claude Codeだけで先月3万円稼いだ方法を全部教えます」
[シーン2 5-11秒] ステップ数提示: 「やることはたった3ステップ。今すぐ始められます」
[シーン3 11-18秒] ステップ①: 「まずClaude Codeを開いて、note記事のURLを貼ります」
[シーン4 18-25秒] ステップ②: 「次にこのプロンプトを入力します。5つのX投稿が10秒で完成」
[シーン5 25-33秒] ステップ③: 「最後にASPのアフィリリンクをnote本文に貼るだけです」
[シーン6 33-41秒] 結果+証拠: 「この3ステップを1日30分続けたら先月32,000円振り込まれました」
[シーン7 41-49秒] 再現性強調: 「エンジニアじゃなくても今日から始められます。概要欄に手順あります」
[シーン8 49-57秒] CTA: 「やってみたらコメントで教えてください。フォローで続きの動画も見られます」

■ テンプレート7（実績証拠型）— 「月5万の証拠あります」
[シーン1 0-5秒] 証拠画面提示: 「これ先月の収益画面です。Claude Code副業で月4万8千円稼ぎました」
[シーン2 5-11秒] ペルソナ: 「私は非エンジニアの会社員で、副業経験ゼロから3ヶ月で達成しました」
[シーン3 11-18秒] 使ったツール: 「使ったのはClaude Codeだけ。無料プランから始めて月2千円の課金のみ」
[シーン4 18-26秒] 具体的な作業: 「毎日1時間、Claude Codeでnote記事を書いてASPリンクを貼る作業をしました」
[シーン5 26-34秒] 転換点: 「3週目にnoteをX経由で1000人に見てもらえて、初めて1万円が入りました」
[シーン6 34-42秒] 現在の状況: 「今は自動化が整って、週に3時間の作業で月4〜5万が安定して入ります」
[シーン7 42-50秒] 再現性: 「この仕組み、詳しい手順をnoteに書きました。概要欄のリンクから見てください」
[シーン8 50-58秒] CTA: 「月1万円でも収入が増えたら嬉しいですよね。フォローして一緒に始めましょう」

■ テンプレート8（速報型）— 「たった今すべて変わりました」
[シーン1 0-5秒] 速報フック: 「今日Claude Codeが大型アップデートされました。副業に直結する新機能があります」
[シーン2 5-11秒] 何が変わったか: 「画像生成が無料で使えるようになりました。これでnoteの収益が上がります」
[シーン3 11-18秒] 競合との差: 「ChatGPTの有料版より高品質で、Geminiより日本語に強いです」
[シーン4 18-26秒] 具体的な使い方: 「副業でのおすすめ使い方はnote記事の見出し画像を自動生成することです」
[シーン5 26-34秒] 実際の効果: 「私が試したら記事のスキが2倍になりました。画像があるだけでこんなに変わります」
[シーン6 34-42秒] 緊急性: 「今日から使えます。乗り遅れると競合に差をつけられます」
[シーン7 42-50秒] 手順案内: 「使い方の全手順を概要欄のnoteにまとめました。今すぐチェックしてください」
[シーン8 50-57秒] CTA: 「フォローするとこういう最新情報を毎日お届けします。見逃したくない人はぜひ」

■ テンプレート1〜5（違和感エンタメ型）— フォロワー獲得重視
1. AIデモ型: 「これ全部AIです→ツール名→誰でも作れます→フォロー」
2. AI比較型: 「AIか現実か当ててみて→混在→判別不能→正解はコメントで」
3. AI裏側型: 「プロンプトを公開→生成過程→完成→試した人コメントで」
4. AI進化型: 「去年のAI→今のAI→差を体感→どっちが好き？」
5. AIループ型: 「何かおかしい→徐々に崩れる→全部AI→もう一回見てみて」

【hookText パターン（12文字以内）】
⑦ 数字証拠系（最強）: 「月5万の証拠あり」「先月32,000円」
⑤ 痛み直撃系: 「副業できない人へ」「時間ない人が見て」
④ 損失回避系: 「見逃すと損します」「知らないと損」
⑧ 秘密暴露系: 「全手順暴露します」「知る人だけ稼ぐ」
⑥ 常識破壊系: 「稼げないは嘘です」「みんな間違えてる」

【絶対ルール】
- JSONのみ出力（説明・マークダウン・コードブロック禁止）
- hookText: 12文字以内（冒頭0〜2秒で表示される大テロップ）
- script: 8要素の配列（絵文字・記号禁止）
  - 各要素: 20〜30文字（春日部つむぎが4〜6秒で読める量）
  - script[0]: 実績数字 or 速報フック（結論・数字を即出し）
  - script[1]: 理由・背景（ペルソナ or ステップ数 or 変化内容）
  - script[2]: 具体手順①（動詞+目的語+数値。「○○を開いて△△を貼る」形式）
  - script[3]: 具体手順②（ツール名+操作+時間）
  - script[4]: 具体手順③ or 結果（「完成」「○円になった」「○秒で完了」）
  - script[5]: 証拠 or 再現性（「実績画面がこれ」「あなたでも今日から可能」）
  - script[6]: 行動案内（「概要欄に全手順あります」「noteにまとめました」）
  - script[7]: CTA 必須（「フォローして」「コメントで教えて」「次の動画で話します」）
- proof_number: 動画内で使う実績数値（例: "月32,000円" "3ヶ月で月4万8千円"）

出力フォーマット（このJSONのみ）:
{"template":N,"hookText":"テキスト","proof_number":"金額","script":["行1","行2","行3","行4","行5","行6","行7","行8"]}`;

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
- 副業・収益・稼ぐ系テーマは「月○万」「○円達成」などの金額数字を必ず1個入れる
- ペルソナ限定フレーズを1個以上含める:「非エンジニアが」「スキルゼロから」「会社員が」「スマホだけで」「3ヶ月で」
- 高CTRパターン（優先度順）:
  1位「[ツール名]で[ペルソナ]が月○万【手順全公開】」
  2位「[数字]達成した[ツール名]の使い方を全部暴露します」
  3位「知らないと損する[ツール名]の○選【2026年最新】」
  4位「[ツール名]が今日アップデート — 副業に使うべき新機能」
  5位「〇秒でわかる〇〇」「月〇万稼いだ〇〇の全手順」
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

// ── ChatGPT Visual Short（gpt-image-2 × Seedance 2.0 ストーリーボード方式）──
//
// @onofumi_AI の鉄板フロー（17.9万views）:
//   gpt-image-2 で「3×3グリッドのストーリーボード」を1枚生成
//   → グリッドを9コマに分割 → Seedance 2.0 で各コマを動画化 → 結合

const CHATGPT_VISUAL_STYLE_OPTIONS = [
  'ghibli-style watercolor illustration, warm earthy tones, hand-painted feel, award-winning visual quality, no text',
  'anime key visual style, consistent character design, soft pastel colors, commercial-grade illustration, no text',
  'cinematic photography style, dramatic lighting, high detail, professional studio quality, no text',
  'minimal flat design illustration, bold colors, clean geometric composition, Dribbble-award quality, no text',
  'isometric 3D illustration, vibrant palette, clean perspective, world-class motion graphic style, no text',
  'cyberpunk digital art, neon accents, futuristic UI elements, high contrast, no text',
  'modern infographic illustration style, clean typography-free layout, editorial quality, no text',
];

const CHATGPT_VISUAL_SYSTEM = `あなたはYouTube AIコンテンツクリエイターです。
アカウントコンセプト:「AIで開発・SNS・副業がここまで変わる」を体験させる。

今回は「gpt-image-2で3×3ストーリーボードを生成 → Seedance 2.0で動画化」方式のショートを作ります。
9コマ×5秒 = 約45秒のビジュアルストーリー。顔出しなし・ナレーションなし・BGMのみ。

【生成するもの】
1. storyboardPrompt: gpt-image-2 に渡す9コマストーリーボードの内容説明（英語・100語以内）
   - 「ストーリーボードを3×3グリッドで作成」は render.js が自動で付ける。内容だけ書く
   - キャラクター・世界観を最初のコマで定義し、残り8コマで展開するストーリー
   - 品質指定を末尾に必ず追加: "designed by a world-renowned art director, award-winning commercial illustration quality"
   - 例: "A young developer's journey: [1]stressed at desk [2]discovers AI tool [3]amazed face [4]typing fast [5]code appearing magically [6]finished product on screen [7]celebrates [8]shares result [9]relaxed smiling at desk, designed by a world-renowned art director, award-winning commercial illustration quality"

2. stylePrompt: 全9コマ共通の画風（英語・40語以内）
   - キャラクターの一貫性を保つための具体的な外見描写を含める（髪色・服装・体型など）
   - "pixel-perfect consistency across all panels" を必ず含める
   - 例: "anime illustration, young Japanese male character, black hair, blue hoodie, pixel-perfect consistency across all panels, commercial-grade quality"

3. frames: 9コマ分の配列
   - motionPrompt: Seedance 2.0 へのモーションプロンプト（英語・20語以内）
     カメラワークを具体的に指定すること（zoom/pan/tilt/dolly/push-in/pull-out）
     例: "slow push-in, warm golden light, soft depth of field"
     例: "dynamic pan right tracking character movement, slight motion blur"
     例: "dramatic pull-out reveal, high contrast lighting, cinematic"
     例: "subtle camera shake, urgent energy, fast zoom-in on screen"
   - narration: テロップ用日本語テキスト（15文字以内・省略可でも可）

4. hookText: 動画冒頭テロップ（12文字以内）

【コンテンツルール】
- AIツールの「驚き」「変化」「結果」を視覚的に見せるストーリー構成
- コマ1: 視聴者を引き込む違和感・驚き・問題提起（強烈なビジュアルフック）
- コマ2〜4: 変化の始まり・AI登場・気づきの瞬間
- コマ5〜7: プロセス・AI技術の見せ場・劇的変化
- コマ8〜9: 結果・CTA（「試してみて」等）
- 具体的なツール名を storyboardPrompt に含める（Claude Code / ChatGPT / n8n 等）
- motionPromptは9コマすべて異なるカメラワークにすること（同じ動きを繰り返さない）

【絶対ルール】
- JSONのみ出力（説明・マークダウン禁止）
- frames は必ず9個（グリッド3×3と対応）
- storyboardPrompt は英語
- motionPrompt は英語

出力フォーマット（このJSONのみ）:
{
  "hookText": "12文字以内",
  "stylePrompt": "全コマ共通の画風（英語・pixel-perfect consistency across all panels含む）",
  "storyboardPrompt": "9コマのストーリー内容説明（英語・award-winning quality指定含む）",
  "frames": [
    { "motionPrompt": "slow push-in, warm light, soft focus", "narration": "日本語テロップ（省略可）" },
    { "motionPrompt": "pan right tracking movement, motion blur", "narration": "..." },
    { "motionPrompt": "dramatic pull-out reveal, high contrast", "narration": "..." },
    { "motionPrompt": "zoom-in on hands typing, urgency", "narration": "..." },
    { "motionPrompt": "static wide shot, sudden light change", "narration": "..." },
    { "motionPrompt": "dolly forward cinematic push", "narration": "..." },
    { "motionPrompt": "tilt up revealing result, triumphant", "narration": "..." },
    { "motionPrompt": "slow zoom out, peaceful atmosphere", "narration": "..." },
    { "motionPrompt": "gentle float, smiling close-up", "narration": "..." }
  ]
}`;

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

export async function runGenerate({ type, topic, _templateOverride } = {}) {
  // 独自パイプライン（gpt-image-2 × Seedance 2.0）
  if (type === 'chatgpt-short') return runGenerateChatGPTVisualShort({ topic });
  if (type === 'anime-short')   return runGenerateAnimeShort({ topic });

  // 速報型ショート: daily-research の todayTopics[0] を強制使用、template=8
  if (type === 'breaking-short') {
    const hintsFile = path.join(__dirname, '..', 'analytics', 'reports', 'prompt-hints.json');
    let breakingTopic = topic;
    if (!breakingTopic) {
      try {
        const hints = JSON.parse(fs.readFileSync(hintsFile, 'utf8'));
        const t = hints.todayTopics?.[0];
        breakingTopic = t ? `${t.topic}【速報】${t.angle ?? ''}` : null;
      } catch { /* fallback to default */ }
    }
    return runGenerate({ type: 'short', topic: breakingTopic ?? '最新AIアップデート速報', _templateOverride: 8 });
  }


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
    ? (_templateOverride ?? planTemplate ?? selectTemplate(theme))
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

  // ショートはJSONパース → script文字列 + hookText + proof_number 抽出
  let script = rawScript;
  let hookText = null;
  let proofNumber = null;
  if (videoType === 'short') {
    try {
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
          script      = Array.isArray(parsed.script) ? parsed.script.join('\n') : rawScript;
          hookText    = parsed.hookText    ?? SHORT_BUZZ_TEMPLATES[(templateId ?? 1) - 1]?.hook ?? null;
          proofNumber = parsed.proof_number ?? null;
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
    proofNumber,
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

// ── ChatGPT Visual Short 生成 ─────────────────────────────────────────

/**
 * chatgpt-visual-short 用の draft を生成する。
 *
 * 通常の runGenerate と異なり、scenes 配列（imagePrompt 付き）を含む draft を出力する。
 * render.js の renderChatGPTShort() がこの draft を消費する。
 *
 * @param {{ topic?: string }} opts
 * @returns {Promise<object>} draft オブジェクト
 */
export async function runGenerateChatGPTVisualShort({ topic } = {}) {
  const today    = new Date().toISOString().split('T')[0];
  const dayIndex = new Date().getDay();
  const theme    = topic ?? defaultTheme(dayIndex);

  logger.info(MODULE, `[chatgpt-visual-short] generating for theme: "${theme}"`);

  const draftDir = path.join(DRAFTS_DIR, today);
  if (!fs.existsSync(draftDir)) fs.mkdirSync(draftDir, { recursive: true });

  const context = `テーマ: ${theme}\n動画タイプ: gpt-image-2×Seedance2.0ストーリーボードショート（約45秒・9コマ）`;

  // storyboardPrompt + stylePrompt + frames + hookText を Claude に生成させる
  const rawScript = await generate(CHATGPT_VISUAL_SYSTEM, context, {
    model:     'claude-sonnet-4-6',
    maxTokens: 1500,
  });

  // JSON パース
  const fallbackStyle = CHATGPT_VISUAL_STYLE_OPTIONS[dayIndex % CHATGPT_VISUAL_STYLE_OPTIONS.length];
  let hookText         = null;
  let stylePrompt      = fallbackStyle;
  let storyboardPrompt = `AI technology story about ${theme}, 9 scenes showing transformation and results`;
  let frames           = [];

  try {
    const stripped = rawScript.replace(/```[a-z]*\n?/g, '').trim();
    const start    = stripped.indexOf('{');
    if (start !== -1) {
      let depth = 0, end = -1;
      for (let i = start; i < stripped.length; i++) {
        if (stripped[i] === '{') depth++;
        else if (stripped[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
      }
      if (end !== -1) {
        const parsed     = JSON.parse(stripped.slice(start, end + 1));
        hookText         = parsed.hookText         ?? null;
        stylePrompt      = parsed.stylePrompt      ?? fallbackStyle;
        storyboardPrompt = parsed.storyboardPrompt ?? storyboardPrompt;
        frames           = Array.isArray(parsed.frames) ? parsed.frames : [];
      }
    }
  } catch (e) {
    logger.warn(MODULE, `[chatgpt-visual-short] JSON parse failed: ${e.message}`);
  }

  // frames が9個未満なら汎用モーションで補完
  while (frames.length < 9) {
    frames.push({ motionPrompt: 'gentle zoom in, cinematic movement', narration: '' });
  }
  frames = frames.slice(0, 9);

  // タイトル・説明文・タグは通常ショートと同じ生成フロー
  const [titles, description, thumbnail] = await Promise.all([
    generate(TITLE_SYSTEM, context, { maxTokens: 512 }),
    generate(DESCRIPTION_SYSTEM, context, { maxTokens: 1024 }),
    generate(THUMBNAIL_SYSTEM, context, { maxTokens: 512 }),
  ]);

  const descriptionWithFooter = description.trimEnd() + ACC2_SNS_FOOTER;
  const tags                  = extractTags(descriptionWithFooter);
  const thumbnailPath         = await generateThumbnailImage(thumbnail, draftDir);

  // render.js が消費する形式:
  //   draft.storyboardPrompt → generateStoryboardGrid() に渡す
  //   draft.stylePrompt      → グリッドプロンプトに付加
  //   draft.frames[]         → generateSeedanceClips() の motionPrompts に渡す
  const draft = {
    theme,
    type:             'chatgpt-short',
    generateType:     'chatgpt-visual-short',
    hookText,
    stylePrompt,
    storyboardPrompt,
    frames,
    script:           frames.map(f => f.narration ?? '').filter(Boolean).join('\n'),
    titles:           parseTitles(titles),
    description:      descriptionWithFooter,
    tags,
    thumbnail,
    thumbnailPath,
    date:             today,
    status:           'ready',
    videoPath:        null,
    videoId:          null,
    crossPublished:   false,
    createdAt:        new Date().toISOString(),
  };

  const draftPath = path.join(draftDir, 'chatgpt-short.json');
  fs.writeFileSync(draftPath, JSON.stringify(draft, null, 2));
  logger.info(MODULE, `[chatgpt-visual-short] draft saved → ${draftPath}`);

  return draft;
}

// ── ヘルパー ─────────────────────────────────────────────────────────

// ── AI アニメショート（gpt-image-2 × Seedance 2.0・アカウント2専用） ────────────
//
// コンセプト: AI生成アニメの美しさ・ドラマ・感情を45秒に凝縮して魅せる
// ターゲット: アニメファン・AI画像生成に興味のある層
// 顔出しなし・ナレーションなし・BGMのみ

// Styles ordered by proven viral performance on TikTok/YouTube Shorts
const ANIME_STYLE_OPTIONS = [
  'Solo Leveling dark fantasy power awakening, dramatic cinematic lighting, intense shadow contrast, glowing magic aura, heroic composition, no text',
  'Studio Ghibli inspired transformation sequence, lush painterly backgrounds, warm golden light, emotional character expressions, no text',
  'magical girl transformation sequence, radiant burst of light, sparkle effects, dynamic pose reveal, vivid color explosion, no text',
  'Makoto Shinkai cinematic style, breathtaking atmospheric lighting, hyper-detailed cityscapes, emotional resonance, no text',
  'isekai portal fantasy anime, otherworldly magical landscapes, heroic power awakening, epic scale environments, no text',
  'cyberpunk anime aesthetic, rain-slicked neon Tokyo streets, dramatic shadows, power awakening amid urban chaos, no text',
  'retro 80s magical girl nostalgia, cel-shaded vibrant palette, bold outlines, classic transformation arc, no text',
  'dark fantasy dungeon awakening anime, ancient ruins, mysterious glowing runes, warrior rising with new power, no text',
];

// Themes based on highest-engagement viral categories (transformation arc = 3x engagement)
const ANIME_THEMES = [
  '魔法少女が光に包まれて覚醒する瞬間',        // magical girl awakening — #1 viral
  '異世界転生した少年がダンジョンで初めて力に目覚める',  // isekai awakening — highest engagement
  'ソロレベリング風の戦士が限界を超えて覚醒する',    // dark fantasy Solo Leveling style
  'サイバーパンク東京の雨夜に謎の能力に目覚める少女',  // cyberpunk Tokyo awakening
  'ジブリ風少女が封印された森の扉を開ける',        // Ghibli transformation/discovery
  '平凡な少女が選ばれし者として覚醒・変身する',     // classic transformation arc
  '廃墟の城で古の魔法使いが復活する瞬間',         // dark fantasy revival — cliffhanger
  '現代高校生が異世界への扉を開けてしまう',        // isekai portal discovery
  '宇宙の孤独な少女がAIと出会い覚醒する',        // futuristic + emotional hook
  '桜吹雪の中で伝説の剣士として転生する少年',      // isekai reincarnation + sakura visual
];

const ANIME_VISUAL_SYSTEM = `あなたはYouTubeショート動画用AIアニメクリエイターです。
アカウントコンセプト:「AI生成アニメの覚醒・変身・感動で視聴者を魅了する」。
顔出しなし・ナレーションなし・BGMのみ。9コマ×5秒 = 約45秒のビジュアルストーリー。

【バイラル戦略（リサーチ済み）】
- 変身・覚醒アーク（Before→During→After）= エンゲージメント3倍
- 最初の7秒（コマ1〜2）でスクロールを止めるビジュアルショック必須
- 最後のコマ9は「え、どうなるの？」という余韻またはどんでん返し（リピート再生を促す）
- 完全視聴率を上げるため、各コマで新しい展開を入れる（停滞禁止）

【ターゲット視聴者】
アニメ好き・AI画像生成に興味がある・美しいビジュアルコンテンツを好む層。

【生成するもの】
1. storyboardPrompt: gpt-image-2 に渡す9コマストーリーボードの内容説明（英語・100語以内）
   - 3×3グリッドで9コマ一括生成。コマごとに状況を明示する
   - コマ1〜2: 【最重要】スクロールを止める衝撃ビジュアル（覚醒前の静寂 or 危機的状況）
   - コマ3〜4: 世界観確立・覚醒のきっかけ
   - コマ5〜6: 変身・覚醒プロセス（エネルギー爆発・劇的変化）
   - コマ7〜8: 覚醒後の圧倒的な新形態・感情的クライマックス
   - コマ9: 【余韻・どんでん返し】笑顔・解放感 または 次への伏線（リピート再生促進）
   - キャラクターは全9コマで同一人物・同一デザインを維持（一貫性が命）
   - 末尾に必ず追加: "masterpiece anime artwork, highest quality illustration, award-winning visual style, no photorealism, flat color anime style, anatomically correct hands, 5 fingers per hand, no extra limbs"
   - 例: "A young female mage's awakening: [1]girl kneeling exhausted in dark dungeon [2]ancient book glows ominously before her [3]her eyes snap open, violet light [4]magical energy erupts from ground [5]she rises floating, robes billowing [6]full power release blinding explosion of light [7]new form revealed with wings of light [8]enemies frozen in awe [9]she smiles gently — the strongest mage, masterpiece anime artwork, highest quality illustration, award-winning visual style, no photorealism, flat color anime style, anatomically correct hands, 5 fingers per hand, no extra limbs"

2. stylePrompt: 全9コマ共通の画風・キャラクター設定（英語・50語以内）
   - キャラクターの一貫性: 髪色・目の色・服装・体型を具体的に定義
   - アートスタイルを明確に指定
   - "pixel-perfect consistency across all panels, no text, no watermarks" を必ず含める
   - 例: "anime girl, silver long hair, violet eyes, white mage robe with gold trim, slender build, Makoto Shinkai cinematic style, pixel-perfect consistency across all panels, no text, no watermarks"

3. frames: 9コマ分の配列
   - motionPrompt: Seedance 2.0 へのモーションプロンプト（英語・20語以内）
     各コマで異なるカメラワークを使うこと（同じ動きを繰り返さない）
     感情・場面に合ったカメラワーク:
       静寂・神秘: "slow push-in, soft diffused light, gentle depth of field"
       覚醒・興奮: "dramatic zoom-in, high contrast lighting, slight camera shake"
       飛翔・解放: "dynamic pull-back reveal, sweeping pan upward, motion blur"
       クロースアップ: "intimate slow zoom on face, bokeh background, warm light"
       アクション: "fast horizontal pan, intense motion blur, kinetic energy"
       全景・世界観: "slow aerial tilt-down, golden hour light, epic scale"
   - narration: 空文字 or null（アニメは無音ナレーション・BGMのみ）

4. hookText: 動画冒頭テロップ（12文字以内・日本語・見た人が止まる一言）
   例: "この世界が好き" / "覚醒の瞬間" / "AIが描いた夢"

【コンテンツルール】
- 純粋にビジュアルの美しさ・ドラマ性で勝負
- キャラクターの表情・感情変化を豊かに表現
- 日本のアニメ文化を尊重したオリジナルキャラクター
- テキスト・ウォーターマーク・著作権のある既存キャラクター禁止

【絶対ルール】
- JSONのみ出力（説明・マークダウン禁止）
- frames は必ず9個
- narration は全て null または空文字（BGMのみ）
- storyboardPrompt は英語

出力フォーマット:
{
  "hookText": "12文字以内の日本語",
  "stylePrompt": "キャラクター定義 + アートスタイル（pixel-perfect consistency含む）",
  "storyboardPrompt": "9コマのストーリー内容（英語・masterpiece anime artwork含む）",
  "frames": [
    { "motionPrompt": "slow push-in, soft light, gentle depth of field", "narration": null },
    { "motionPrompt": "dramatic zoom-in, high contrast, slight camera shake", "narration": null },
    { "motionPrompt": "pan right revealing landscape, cinematic scope", "narration": null },
    { "motionPrompt": "intimate close-up on face, warm bokeh background", "narration": null },
    { "motionPrompt": "dynamic pull-back reveal, sweeping motion", "narration": null },
    { "motionPrompt": "fast horizontal pan, kinetic energy, blur", "narration": null },
    { "motionPrompt": "slow aerial tilt-down, golden hour, epic scale", "narration": null },
    { "motionPrompt": "dramatic zoom-out, emotional release, soft light", "narration": null },
    { "motionPrompt": "gentle floating, warm light, peaceful resolution", "narration": null }
  ]
}`;

// ── アニメショート専用プロンプト（acc2: らすかる【AI絵コンテ工場】）──────────────

const ANIME_TITLE_SYSTEM = `YouTubeショート動画（AIアニメ）のタイトル案を5個生成してください。
このチャンネルはAI生成アニメを毎日投稿するチャンネルです。視聴者はアニメファンとAI画像生成に興味がある層です。

条件:
- 50文字以内（モバイル表示で全文見える上限）
- ストーリー・キャラクター・感情に焦点を当てる（AI副業・ツール説明ではない）
- 「数字」「感情語」「続きが気になる」の要素を含める
- 「#1」「ep.1」「続編あり」「【完全版】」などシリーズ感を匂わせる表現を1〜2個混ぜる
- タイトルに #Shorts は入れない
- クリック率が高いパターン:
  「〇〇が覚醒した瞬間【AIアニメ】」「誰も知らない魔法少女の末路」「異世界転生#1 — 予想外の結末」
出力: 1〜5の番号付きリストのみ`;

const ANIME_DESCRIPTION_SYSTEM = `YouTubeショート動画（AIアニメ）の説明文を作成してください。
このチャンネルはAI生成アニメを毎日投稿するチャンネルです。

条件:
- 冒頭1〜2行: 今回のアニメのストーリー概要（誰が・何をして・どうなるか）
- 3〜5行: 世界観・キャラクター紹介・見どころ（感情的な引き）
- 続編・シリーズ展開を匂わせる一文（「続きは…？」「ep.2は近日公開予定」など）
- 制作クレジット: 「gpt-image-2 × Seedance 2.0 で全自動生成」を1行で記載
- 本文200文字以上
- ハッシュタグ: 末尾に3〜5個のみ。#Shorts #AIアニメ #AI生成 を必ず含める
- SNSリンクは追記するので不要
出力: 説明文テキストのみ`;

// acc2 共通フッター（chatgpt-short / anime-short 両方）
const ACC2_SNS_FOOTER = `

---

🔔 チャンネル登録 → https://www.youtube.com/@Rascal_AI_Video
🐦 X(Twitter): https://x.com/Rascal_AI_Dev
📷 Instagram: https://www.instagram.com/ai_side_hack_/`;

export async function runGenerateAnimeShort({ topic } = {}) {
  const today    = new Date().toISOString().split('T')[0];
  const dayIndex = new Date().getDay();
  const theme    = topic ?? ANIME_THEMES[dayIndex % ANIME_THEMES.length];

  logger.info(MODULE, `[anime-short] generating for theme: "${theme}"`);

  const draftDir = path.join(DRAFTS_DIR, today);
  if (!fs.existsSync(draftDir)) fs.mkdirSync(draftDir, { recursive: true });

  const context = `テーマ: ${theme}\n動画タイプ: AIアニメショート（gpt-image-2×Seedance2.0・9コマ・約45秒）`;

  const rawScript = await generate(ANIME_VISUAL_SYSTEM, context, {
    model:     'claude-sonnet-4-6',
    maxTokens: 1500,
  });

  // JSON パース
  const fallbackStyle = ANIME_STYLE_OPTIONS[dayIndex % ANIME_STYLE_OPTIONS.length];
  let hookText         = null;
  let stylePrompt      = fallbackStyle;
  let storyboardPrompt = `Anime story about ${theme}, 9 dramatic scenes with consistent character design, masterpiece anime artwork, highest quality illustration, award-winning visual style, no photorealism, flat color anime style, anatomically correct hands, 5 fingers per hand, no extra limbs`;
  let frames           = [];

  try {
    const stripped = rawScript.replace(/```[a-z]*\n?/g, '').trim();
    const start    = stripped.indexOf('{');
    if (start !== -1) {
      let depth = 0, end = -1;
      for (let i = start; i < stripped.length; i++) {
        if (stripped[i] === '{') depth++;
        else if (stripped[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
      }
      if (end !== -1) {
        const parsed     = JSON.parse(stripped.slice(start, end + 1));
        hookText         = parsed.hookText         ?? null;
        stylePrompt      = parsed.stylePrompt      ?? fallbackStyle;
        storyboardPrompt = parsed.storyboardPrompt ?? storyboardPrompt;
        frames           = Array.isArray(parsed.frames) ? parsed.frames : [];
      }
    }
  } catch (e) {
    logger.warn(MODULE, `[anime-short] JSON parse failed: ${e.message}`);
  }

  while (frames.length < 9) {
    frames.push({ motionPrompt: 'slow push-in, soft cinematic light, gentle depth of field', narration: null });
  }
  frames = frames.slice(0, 9);

  const storyContext = [
    `テーマ: ${theme}`,
    hookText         ? `冒頭テロップ: ${hookText}`        : null,
    storyboardPrompt ? `ストーリー: ${storyboardPrompt}` : null,
  ].filter(Boolean).join('\n');

  const [titles, description, thumbnail] = await Promise.all([
    generate(ANIME_TITLE_SYSTEM, storyContext, { maxTokens: 512 }),
    generate(ANIME_DESCRIPTION_SYSTEM, storyContext, { maxTokens: 1024 }),
    generate(THUMBNAIL_SYSTEM, storyContext, { maxTokens: 512 }),
  ]);

  const descriptionWithFooter = description.trimEnd() + ACC2_SNS_FOOTER;
  const tags                  = extractTags(descriptionWithFooter);
  const thumbnailPath         = await generateThumbnailImage(thumbnail, draftDir);

  const draft = {
    theme,
    type:             'anime-short',
    generateType:     'anime-visual-short',
    hookText,
    stylePrompt,
    storyboardPrompt,
    frames,
    script:           '',
    titles:           parseTitles(titles),
    description:      descriptionWithFooter,
    tags,
    thumbnail,
    thumbnailPath,
    date:             today,
    status:           'ready',
    videoPath:        null,
    videoId:          null,
    crossPublished:   false,
    createdAt:        new Date().toISOString(),
  };

  const draftPath = path.join(draftDir, 'anime-short.json');
  fs.writeFileSync(draftPath, JSON.stringify(draft, null, 2));
  logger.info(MODULE, `[anime-short] draft saved → ${draftPath}`);

  return draft;
}

// テーマに応じてテンプレートIDを選択
// 副業・稼ぐ・収益系 → 手順実用型(6,7)を70%で選択
// 速報キーワード    → 速報型(8)
// それ以外          → エンタメ型(1-5)をランダム
function selectTemplate(theme = '') {
  const t = theme ?? '';
  if (/速報|アップデート|リリース|新機能|発表/.test(t)) return 8;
  if (/副業|稼ぐ|収益|月.*万|収入|売上|アフィリ|手順|やり方|稼げ/.test(t)) {
    return Math.random() < 0.7
      ? (Math.random() < 0.5 ? 6 : 7)
      : SHORT_BUZZ_TEMPLATES[Math.floor(Math.random() * 5)].id; // 1-5
  }
  return SHORT_BUZZ_TEMPLATES[Math.floor(Math.random() * SHORT_BUZZ_TEMPLATES.length)].id;
}

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
    '非エンジニアがClaude Codeだけで副業月5万円を達成した全手順',
    'ChatGPTで会社員が3ヶ月で月10万円の仕組みを作った方法',
    'n8n×Claude完全自動化で作業時間を90%削減した実例',
    'スキルゼロからCursor×Claude Codeで副業収益を出す最短ルート',
    'AI副業で月収を5万→30万に伸ばした人がやった3つのこと',
    '2026年今すぐ始めるべきAI副業ツール厳選5選【無料あり】',
    'AI初心者が1週間で月3万円の自動収益を作るステップ',
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
    '非エンジニアがClaude Codeだけで副業月5万円を達成した全手順',
    'ChatGPTで会社員が3ヶ月で月10万円の仕組みを作った方法',
    'n8n×Claude完全自動化で作業時間を90%削減した実例',
    'スキルゼロからCursor×Claude Codeで副業収益を出す最短ルート',
    'AI副業で月収を5万→30万に伸ばした人がやった3つのこと',
    '2026年今すぐ始めるべきAI副業ツール厳選5選【無料あり】',
    'AI初心者が1週間で月3万円の自動収益を作るステップ',
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
