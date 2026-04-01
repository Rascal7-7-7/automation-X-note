import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * テキスト生成の薄いラッパー
 * @param {string} system - システムプロンプト
 * @param {string} user - ユーザープロンプト
 * @param {object} opts - { model, maxTokens }
 * @returns {Promise<string>}
 */
export async function generate(system, user, opts = {}) {
  const model = opts.model ?? 'claude-haiku-4-5-20251001';
  const maxTokens = opts.maxTokens ?? 1024;

  const message = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
  });

  return message.content[0].text;
}
