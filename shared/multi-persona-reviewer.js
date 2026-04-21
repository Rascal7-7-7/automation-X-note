/**
 * 多視点コンテンツレビュー
 * - カテゴリ別ペルソナセット（tech-sns / affiliate / x-general / instagram-ai / instagram-affiliate）
 * - 5ペルソナ並列評価（Claude Haiku）
 * - 平均 < 7 → 改善提案を返す（呼び出し元が再生成）
 */
import { generate } from './claude-client.js';
import { logger } from './logger.js';
import { saveFeedback, loadFeedbackHint } from './quality-feedback-store.js';

const MODULE = 'reviewer:multi-persona';

// ── ペルソナ定義 ────────────────────────────────────────────────────

const ALL_PERSONAS = {
  engineer: {
    id: 'engineer',
    name: 'ITエンジニア（副業・効率化に詳しい）',
    focus: '技術的正確性・具体性・再現性。曖昧な表現や誇張を嫌う。数字と手順を重視。',
  },
  sns_operator: {
    id: 'sns_operator',
    name: 'SNS担当者（業務でSNS運用を任されている）',
    focus: '実際に使えるか・業務に応用できるか。抽象論より具体的な運用手順が刺さる。',
  },
  ai_beginner: {
    id: 'ai_beginner',
    name: 'AI初心者（ChatGPTを使い始めたばかりの会社員）',
    focus: 'わかりやすさ・とっつきやすさ。「自分でも今日からできそう」と感じるか。',
  },
  indie_dev: {
    id: 'indie_dev',
    name: '個人開発者（副業でアプリやツールを作っている）',
    focus: '実装精度・コスパ・工数削減効果。実際のコードや手順の具体性を重視。',
  },
  side_hustle: {
    id: 'side_hustle',
    name: '副業志望のサラリーマン（本業の傍ら収益化したい）',
    focus: '再現性・時間対効果・リスクの少なさ。「本当に稼げるか」を最重視。',
  },
  housewife: {
    id: 'housewife',
    name: '主婦（スマホは使うが技術に詳しくない）',
    focus: 'わかりやすさ・親しみやすさ・生活コスト削減への関連性。専門用語が多いと離脱。',
  },
  cost_conscious: {
    id: 'cost_conscious',
    name: '節約志向の一般層（固定費を下げたい30〜40代）',
    focus: '費用対効果・信頼性・切り替えの手間。「本当にお得か」「失敗しないか」が判断軸。',
  },
  marketer: {
    id: 'marketer',
    name: 'SNSマーケター（エンゲージ率を追う）',
    focus: 'フックの強さ・CTA明確性・シェア・保存・コメント誘発力。バズ型の使い方の正確さ。',
  },
  creator: {
    id: 'creator',
    name: 'SNSクリエイター（毎日発信・ライバル目線）',
    focus: '差別化・独自性・構成のテンポ。「自分も似たもの書いてる」と感じるかどうか。',
  },
};

// ── ペルソナセット ───────────────────────────────────────────────────

export const PERSONA_SETS = {
  // note: AI/自動化/開発/SNS運用 記事（メイン）
  'note-tech': [
    ALL_PERSONAS.engineer,
    ALL_PERSONAS.sns_operator,
    ALL_PERSONAS.ai_beginner,
    ALL_PERSONAS.indie_dev,
    ALL_PERSONAS.marketer,
  ],
  // note: アフィリエイト記事（通信・ホスティング・ツール等）
  'note-affiliate': [
    ALL_PERSONAS.housewife,
    ALL_PERSONAS.cost_conscious,
    ALL_PERSONAS.side_hustle,
    ALL_PERSONAS.ai_beginner,
    ALL_PERSONAS.marketer,
  ],
  // Instagram account1: AI活用Tips
  'instagram-ai': [
    ALL_PERSONAS.ai_beginner,
    ALL_PERSONAS.sns_operator,
    ALL_PERSONAS.side_hustle,
    ALL_PERSONAS.marketer,
    ALL_PERSONAS.creator,
  ],
  // Instagram account2: アフィリエイト
  'instagram-affiliate': [
    ALL_PERSONAS.housewife,
    ALL_PERSONAS.cost_conscious,
    ALL_PERSONAS.side_hustle,
    ALL_PERSONAS.marketer,
    ALL_PERSONAS.creator,
  ],
  // note: 投資・FX・株
  'note-finance': [
    ALL_PERSONAS.cost_conscious,
    ALL_PERSONAS.side_hustle,
    ALL_PERSONAS.ai_beginner,
    ALL_PERSONAS.housewife,
    ALL_PERSONAS.marketer,
  ],
  // YouTubeショート（AI副業・自動化チャンネル）
  'youtube-short': [
    ALL_PERSONAS.ai_beginner,
    ALL_PERSONAS.side_hustle,
    ALL_PERSONAS.sns_operator,
    ALL_PERSONAS.marketer,
    ALL_PERSONAS.creator,
  ],
  // Ghost英語記事
  'ghost': [
    ALL_PERSONAS.engineer,
    ALL_PERSONAS.indie_dev,
    ALL_PERSONAS.ai_beginner,
    ALL_PERSONAS.side_hustle,
    ALL_PERSONAS.marketer,
  ],
  // X一般投稿（副業・AI・節約ミックス）
  'x-general': [
    ALL_PERSONAS.ai_beginner,
    ALL_PERSONAS.side_hustle,
    ALL_PERSONAS.housewife,
    ALL_PERSONAS.marketer,
    ALL_PERSONAS.creator,
  ],
};

const REVIEW_SYSTEM = `あなたは以下のペルソナとしてSNSコンテンツを評価します。

ペルソナ: {PERSONA_NAME}
評価軸: {PERSONA_FOCUS}

以下のJSON形式のみで出力してください（他の文章禁止）：
{
  "score": 1〜10の整数,
  "good": "良い点を1文（20字以内）",
  "bad": "改善点を1文（20字以内）",
  "verdict": "post" または "revise"
}

スコア基準:
- 9-10: 即拡散レベル・このペルソナが保存/シェアする
- 7-8: 問題なし・通常投稿として適切
- 5-6: 弱い・改善すれば良くなる
- 1-4: 投稿すべきでない・マイナスイメージのリスクあり`;

async function reviewWithPersona(persona, content, platform) {
  const system = REVIEW_SYSTEM
    .replace('{PERSONA_NAME}', persona.name)
    .replace('{PERSONA_FOCUS}', persona.focus);
  const prompt = `プラットフォーム: ${platform}\n\n---\n${content}\n---\n\n上記コンテンツを評価してください。`;
  try {
    const raw = await generate(system, prompt, { model: 'claude-haiku-4-5-20251001', maxTokens: 150 });
    const json = JSON.parse(raw.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
    return { persona: persona.id, name: persona.name, ...json };
  } catch {
    return { persona: persona.id, name: persona.name, score: 7, good: '評価スキップ', bad: '-', verdict: 'post' };
  }
}

function buildImprovementPrompt(results) {
  const issues = results
    .filter(r => r.verdict === 'revise' || r.score < 7)
    .map(r => `・${r.name}（${r.score}点）: ${r.bad}`)
    .join('\n');
  return issues ? `以下の視点からの改善が必要です:\n${issues}` : '';
}

/**
 * @param {string} content
 * @param {string} platform - 表示用（ログ）
 * @param {string} personaSet - PERSONA_SETS のキー（省略時 'x-general'）
 */
export async function reviewContent(content, platform = 'X', personaSet = 'x-general') {
  const personas = PERSONA_SETS[personaSet] ?? PERSONA_SETS['x-general'];
  logger.info(MODULE, `reviewing for ${platform}[${personaSet}] (${content.length} chars)`);

  const results = await Promise.all(personas.map(p => reviewWithPersona(p, content, platform)));

  const avgScore = results.reduce((s, r) => s + r.score, 0) / results.length;
  const approved = avgScore >= 7;

  logger.info(MODULE, `avg: ${avgScore.toFixed(1)} → ${approved ? 'APPROVED' : 'REVISE'}`, {
    scores: results.map(r => `${r.persona}:${r.score}`).join(' '),
  });

  return {
    approved,
    avgScore: Math.round(avgScore * 10) / 10,
    results,
    improvementHint: approved ? '' : buildImprovementPrompt(results),
  };
}

/**
 * @param {Function} generateFn - (hint?: string) => Promise<string>
 * @param {string} platform
 * @param {string} personaSet - PERSONA_SETS のキー
 * @param {number} maxRetries
 */
export async function generateWithReview(generateFn, platform = 'X', personaSet = 'x-general', maxRetries = 2) {
  // 過去レビューから繰り返し指摘された問題点を初期ヒントとして注入
  const persistentHint = loadFeedbackHint(personaSet);
  if (persistentHint) {
    logger.info(MODULE, `loading persistent feedback for [${personaSet}]`);
  }

  let hint = persistentHint;
  let lastReview = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const content = await generateFn(hint);
    const review = await reviewContent(content, platform, personaSet);
    lastReview = review;

    // フィードバック保存（承認・却下どちらも記録して学習を積む）
    saveFeedback(personaSet, review.results, review.avgScore);

    if (review.approved) {
      logger.info(MODULE, `approved on attempt ${attempt + 1}`);
      return { content, review };
    }

    if (attempt < maxRetries) {
      hint = (persistentHint ? persistentHint + '\n\n' : '') + review.improvementHint;
      logger.info(MODULE, `retry ${attempt + 1}/${maxRetries} — hint: ${review.improvementHint.slice(0, 80)}`);
    }
  }

  logger.warn(MODULE, `max retries reached, posting anyway (score: ${lastReview.avgScore})`);
  const finalContent = await generateFn(persistentHint);
  return { content: finalContent, review: lastReview };
}
