import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const RETRY_STATUS = new Set([429, 529]); // rate limit / overloaded
const MAX_RETRIES = 4;
const BASE_DELAY_MS = 2000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * テキスト生成の薄いラッパー（指数バックオフ付きリトライ）
 * @param {string} system - システムプロンプト
 * @param {string} user - ユーザープロンプト
 * @param {object} opts - { model, maxTokens }
 * @returns {Promise<string>}
 */
export async function generate(system, user, opts = {}) {
  const model = opts.model ?? 'claude-haiku-4-5-20251001';
  const maxTokens = opts.maxTokens ?? 1024;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const message = await client.messages.create({
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
      });
      return message.content[0].text;
    } catch (err) {
      const status = err.status ?? err.statusCode;
      const retryable = RETRY_STATUS.has(status) || err.message?.includes('overloaded');

      if (!retryable || attempt === MAX_RETRIES) throw err;

      const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1); // 2s, 4s, 8s
      await sleep(delay);
    }
  }
}
