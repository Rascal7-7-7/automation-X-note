/**
 * Anthropic API クレジット残高監視
 *
 * 動作:
 *   1. Admin API でクレジット残高を取得（対応している場合）
 *   2. 失敗時はカナリア呼び出し（max_tokens=1）で 402 を検出
 *   3. 残高が閾値以下 → notifyWarn / notifyError を発火
 *
 * 環境変数:
 *   ANTHROPIC_API_KEY         — 必須
 *   ANTHROPIC_CREDIT_WARN_USD — WARN 閾値 ドル（デフォルト 5）
 *   ANTHROPIC_CREDIT_CRIT_USD — CRIT 閾値 ドル（デフォルト 1）
 */
import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, writeFileSync } from 'fs';
import Anthropic from '@anthropic-ai/sdk';
import { notifyWarn, notifyError, notifyInfo } from './notify.js';
import { logger } from './logger.js';

const MODULE = 'check-anthropic-credits';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, '../analytics/reports/credit-state.json');

const WARN_USD = parseFloat(process.env.ANTHROPIC_CREDIT_WARN_USD ?? '5');
const CRIT_USD = parseFloat(process.env.ANTHROPIC_CREDIT_CRIT_USD ?? '1');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function saveState(state) {
  try {
    mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify({ ...state, checkedAt: new Date().toISOString() }, null, 2));
  } catch { /* 書き込み失敗は無視 */ }
}

/** Admin API でクレジット残高取得 — 取得できなければ null を返す */
async function fetchCreditBalance() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch('https://api.anthropic.com/v1/credits', {
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
    });
    if (!res.ok) return null;
    const json = await res.json();
    // credits は USD（ドル単位）またはマイクロドル単位の場合があるため正規化
    if (typeof json.credits === 'number') {
      // Anthropic は credits を USD で返す（ドル単位）
      return json.credits;
    }
    if (typeof json.remaining === 'number') return json.remaining;
    return null;
  } catch {
    return null;
  }
}

/** カナリア呼び出し: 1トークン生成して 402 を検出 */
async function canaryCheck() {
  try {
    await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'hi' }],
    });
    return { ok: true, status: 200 };
  } catch (err) {
    const status = err.status ?? err.statusCode ?? 0;
    return { ok: false, status, message: err.message ?? '' };
  }
}

export async function runCheckCredits() {
  logger.info(MODULE, 'START');

  // 1. Admin API で残高取得を試みる
  const balance = await fetchCreditBalance();

  if (balance !== null) {
    const balanceStr = `$${balance.toFixed(2)}`;
    logger.info(MODULE, `credit balance: ${balanceStr}`);
    saveState({ source: 'api', balanceUsd: balance });

    if (balance <= CRIT_USD) {
      await notifyError(
        'Anthropic クレジット残高 危機的',
        `残高 ${balanceStr} — 閾値 $${CRIT_USD} 以下。今すぐ補充してください。note/X パイプラインが停止します。`,
      );
    } else if (balance <= WARN_USD) {
      await notifyWarn(
        'Anthropic クレジット残高 警告',
        `残高 ${balanceStr} — 閾値 $${WARN_USD} 以下。補充を検討してください。`,
      );
    } else {
      await notifyInfo('Anthropic クレジット正常', `残高 ${balanceStr}`);
    }
    logger.info(MODULE, 'DONE');
    return;
  }

  // 2. Admin API 不可 → カナリア呼び出しで 402 を検出
  logger.info(MODULE, 'Admin API unavailable — running canary check');
  const canary = await canaryCheck();

  if (!canary.ok && canary.status === 402) {
    saveState({ source: 'canary', balanceUsd: 0, error: canary.message });
    await notifyError(
      'Anthropic クレジット枯渇 [402]',
      `API が 402 を返しました — クレジットが枯渇しています。今すぐ補充してください。note/X パイプラインが停止します。`,
    );
    logger.error(MODULE, 'credit exhausted (402)');
  } else if (!canary.ok) {
    // その他のエラー（529 過負荷等）は別途アラート不要
    saveState({ source: 'canary', balanceUsd: null, error: `status ${canary.status}` });
    logger.warn(MODULE, `canary failed (${canary.status}) — may not be credit issue`);
  } else {
    saveState({ source: 'canary', balanceUsd: null, canaryOk: true });
    logger.info(MODULE, 'canary OK — credits available');
  }

  logger.info(MODULE, 'DONE');
}
