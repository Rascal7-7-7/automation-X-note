/**
 * youtube/capture.js — Playwright-based scene image capture
 *
 * Priority per scene:
 *   1. Real session capture (note.com / YouTube Studio — existing sessions)
 *   2. Mock HTML template rendered by Playwright (no auth needed)
 *   3. Returns null → caller falls back to Imagen / gradient
 *
 * Usage:
 *   import { captureSceneImage } from './capture.js';
 *   const imgPath = await captureSceneImage(narrationText, sceneIndex, outPath, type);
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../shared/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULE    = 'youtube:capture';

const NOTE_SESSION    = path.join(__dirname, '..', '.note-session.json');
const YOUTUBE_SESSION = path.join(__dirname, '..', '.youtube-session.json');

// ── Portrait viewport for YouTube Shorts ──────────────────────────────────────
const VIEWPORT_SHORT = { width: 1080, height: 1920 };
const VIEWPORT_LONG  = { width: 1920, height: 1080 };

// ── Keyword → scenario routing ────────────────────────────────────────────────
const CAPTURE_ROUTES = [
  {
    keys: ['収益', '稼いだ', '万円', '振込', '売上', '収入', '月.*万', '達成'],
    scenario: 'earnings-dashboard',
  },
  {
    keys: ['ChatGPT', 'GPT-4', 'OpenAI', 'GPT'],
    scenario: 'chatgpt-chat',
  },
  {
    keys: ['Claude Code', 'ClaudeCode', 'claude code'],
    scenario: 'claude-code-terminal',
  },
  {
    keys: ['Claude', 'claude', '生成AI', 'LLM', 'AI.*会話', 'AI.*チャット'],
    scenario: 'claude-chat',
  },
  {
    keys: ['note.*記事', '記事.*note', 'note.*書', '記事を書', 'ブログ'],
    scenario: 'note-editor',
  },
  {
    keys: ['ASP', 'アフィリ', 'A8', 'もしも', '案件', 'アフィリエイト'],
    scenario: 'asp-dashboard',
  },
  {
    keys: ['YouTube', 'ユーチューブ', '再生数', 'チャンネル', '登録者'],
    scenario: 'youtube-analytics',
  },
  {
    keys: ['自動化', 'ワークフロー', 'n8n', 'Make', 'Zapier', 'スクリプト'],
    scenario: 'automation-workflow',
  },
  {
    keys: ['X', 'ツイート', 'Twitter', '拡散', 'インプレ', 'フォロワー'],
    scenario: 'x-analytics',
  },
];

// ── Scenario → HTML template generator ───────────────────────────────────────

function buildEarningsDashboardHTML(text, proofNumber) {
  const amount = proofNumber ?? extractAmount(text) ?? '¥48,000';
  const now    = new Date();
  const month  = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`;
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body {
  width: 1080px; height: 1920px;
  background: #0d1117;
  font-family: -apple-system, "Hiragino Kaku Gothic ProN", sans-serif;
  color: #e6edf3;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  overflow: hidden;
}
.card {
  width: 900px;
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 16px;
  padding: 60px 80px;
  margin-bottom: 40px;
}
.badge {
  display: inline-block;
  background: #1f6feb;
  color: #fff;
  font-size: 28px;
  font-weight: 700;
  padding: 8px 24px;
  border-radius: 40px;
  margin-bottom: 32px;
}
.period { font-size: 30px; color: #8b949e; margin-bottom: 12px; }
.amount {
  font-size: 120px;
  font-weight: 900;
  color: #3fb950;
  letter-spacing: -2px;
  margin: 20px 0;
  line-height: 1;
}
.label { font-size: 32px; color: #8b949e; margin-bottom: 48px; }
.divider { height: 1px; background: #30363d; margin: 40px 0; }
.row {
  display: flex; justify-content: space-between; align-items: center;
  font-size: 30px; margin-bottom: 20px;
}
.row .val { font-weight: 700; color: #3fb950; }
.row .val.blue { color: #58a6ff; }
.chart {
  width: 100%; height: 160px;
  background: #0d1117;
  border-radius: 8px;
  margin-top: 40px;
  display: flex; align-items: flex-end;
  gap: 12px;
  padding: 20px;
}
.bar {
  flex: 1; border-radius: 4px 4px 0 0;
  background: linear-gradient(to top, #1f6feb, #3fb950);
}
.status {
  margin-top: 60px;
  font-size: 34px;
  color: #58a6ff;
  text-align: center;
}
.verified { color: #3fb950; font-weight: 700; }
</style>
</head>
<body>
<div class="card">
  <div class="badge">振込確認済み ✓</div>
  <div class="period">${month} 収益レポート</div>
  <div class="amount">${amount}</div>
  <div class="label">副業収益（ASP＋note販売）</div>
  <div class="divider"></div>
  <div class="row"><span>note販売</span><span class="val">¥28,400</span></div>
  <div class="row"><span>A8.net</span><span class="val">¥12,300</span></div>
  <div class="row"><span>もしもアフィリ</span><span class="val">¥7,200</span></div>
  <div class="row"><span>合計</span><span class="val">${amount}</span></div>
  <div class="chart">
    <div class="bar" style="height:30%"></div>
    <div class="bar" style="height:45%"></div>
    <div class="bar" style="height:38%"></div>
    <div class="bar" style="height:60%"></div>
    <div class="bar" style="height:52%"></div>
    <div class="bar" style="height:75%"></div>
    <div class="bar" style="height:68%"></div>
    <div class="bar" style="height:90%"></div>
    <div class="bar" style="height:100%"></div>
  </div>
</div>
<div class="status">
  ぬちょ【AI副業ハック】<br>
  <span class="verified">月次収益 自動化達成</span>
</div>
</body>
</html>`;
}

function buildChatGPTHTML(text) {
  const userMsg  = text.length > 30 ? text.slice(0, 30) + '…' : text;
  const response = generateAIResponse(text);
  // 固定の追加会話でスクリーン全体を埋める
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<style>
* { margin:0; padding:0; box-sizing:border-box; }
html, body { width:1080px; height:1920px; overflow:hidden; }
body {
  background: #212121;
  font-family: ui-sans-serif, system-ui, sans-serif;
  color: #ececec;
  display: flex;
}
.sidebar {
  width: 240px; min-height: 1920px;
  background: #171717;
  padding: 20px 16px;
  flex-shrink: 0;
}
.sidebar-logo { display:flex; align-items:center; gap:10px; font-size:24px; font-weight:600; padding:12px 8px; margin-bottom:16px; }
.new-chat { background:#2f2f2f; border-radius:8px; padding:12px 16px; font-size:20px; margin-bottom:12px; }
.history-item { padding:10px 16px; font-size:18px; color:#8e8ea0; border-radius:6px; margin-bottom:4px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.history-item.active { background:#2f2f2f; color:#ececec; }
.main { flex:1; display:flex; flex-direction:column; min-height:1920px; }
.header { padding:20px 30px; font-size:22px; font-weight:600; border-bottom:1px solid #2f2f2f; display:flex; align-items:center; gap:10px; flex-shrink:0; }
.model-badge { background:#2f2f2f; border-radius:20px; padding:6px 16px; font-size:18px; color:#10a37f; }
.messages { flex:1; padding:40px 50px 0; display:flex; flex-direction:column; gap:36px; }
.msg { display:flex; gap:16px; align-items:flex-start; }
.msg.user { justify-content:flex-end; }
.avatar { width:44px; height:44px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:20px; flex-shrink:0; }
.avatar.gpt { background:#10a37f; }
.avatar.user { background:#5436da; }
.bubble { max-width:660px; background:#2f2f2f; border-radius:16px; padding:20px 24px; font-size:26px; line-height:1.65; }
.msg.user .bubble { border-radius:22px; }
.step { display:flex; gap:12px; align-items:flex-start; margin-bottom:10px; font-size:25px; }
.step-num { background:#10a37f; color:#fff; width:32px; height:32px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:18px; font-weight:700; flex-shrink:0; }
.divider { height:1px; background:#3a3a3a; margin:10px 0; }
.tag { display:inline-block; background:#1a3a2a; color:#3fb950; border-radius:6px; padding:4px 12px; font-size:20px; margin:4px 4px 4px 0; }
.input-area { padding:24px 50px; border-top:1px solid #2f2f2f; flex-shrink:0; }
.input-box { background:#2f2f2f; border-radius:16px; padding:20px 24px; font-size:24px; color:#8e8ea0; display:flex; align-items:center; justify-content:space-between; }
</style>
</head>
<body>
<div class="sidebar">
  <div class="sidebar-logo">
    <svg width="28" height="28" viewBox="0 0 41 41" fill="none"><path d="M37.532 16.87a9.963 9.963 0 00-.856-8.184 10.078 10.078 0 00-10.855-4.835 9.964 9.964 0 00-7.505-3.348 10.079 10.079 0 00-9.612 6.977 9.967 9.967 0 00-6.664 4.834 10.08 10.08 0 001.24 11.817 9.965 9.965 0 00.856 8.185 10.079 10.079 0 0010.855 4.835 9.965 9.965 0 007.504 3.347 10.078 10.078 0 009.617-6.981 9.967 9.967 0 006.663-4.834 10.079 10.079 0 00-1.243-11.813z" fill="currentColor"/></svg>
    ChatGPT
  </div>
  <div class="new-chat">+ 新しいチャット</div>
  <div class="history-item active">note記事収益化の方法</div>
  <div class="history-item">AI副業スタートガイド</div>
  <div class="history-item">ASPアフィリ戦略</div>
  <div class="history-item">プロンプト作成術</div>
  <div class="history-item">X拡散テンプレ</div>
  <div class="history-item">月10万の仕組み</div>
  <div class="history-item">初心者向け手順書</div>
</div>
<div class="main">
  <div class="header">
    <span>ChatGPT</span>
    <div class="model-badge">GPT-4o</div>
  </div>
  <div class="messages">
    <div class="msg user">
      <div class="bubble">${userMsg}</div>
      <div class="avatar user">👤</div>
    </div>
    <div class="msg">
      <div class="avatar gpt">✦</div>
      <div class="bubble">
        <div class="step"><span class="step-num">1</span><span>${response.split('\n')[0] ?? '具体的な手順を説明します'}</span></div>
        <div class="step"><span class="step-num">2</span><span>${response.split('\n')[1] ?? 'note記事を毎日1本投稿する'}</span></div>
        <div class="step"><span class="step-num">3</span><span>${response.split('\n')[2] ?? 'ASPリンクで収益を最大化'}</span></div>
        <div class="divider"></div>
        <div style="font-size:22px;color:#8e8ea0;margin-top:8px">ポイント: 継続することで複利的に収益が増加します</div>
      </div>
    </div>
    <div class="msg user">
      <div class="bubble">具体的なプロンプトを教えてください</div>
      <div class="avatar user">👤</div>
    </div>
    <div class="msg">
      <div class="avatar gpt">✦</div>
      <div class="bubble">
        <div style="font-size:24px;margin-bottom:14px">おすすめプロンプトはこちらです：</div>
        <div style="background:#1a1a1a;border-radius:10px;padding:18px;font-size:22px;line-height:1.6;color:#a8e6a3;font-family:monospace">「[テーマ]について、初心者が3ヶ月で月5万円稼げる具体的な手順を、ステップ形式で教えてください」</div>
        <div class="divider"></div>
        <span class="tag">#副業</span><span class="tag">#note収益化</span><span class="tag">#AI活用</span>
      </div>
    </div>
    <div class="msg user">
      <div class="bubble">ありがとう！試してみます</div>
      <div class="avatar user">👤</div>
    </div>
    <div class="msg">
      <div class="avatar gpt">✦</div>
      <div class="bubble" style="font-size:26px;color:#10a37f;font-weight:600">ぜひ！結果が出たら教えてください 🎉<br><span style="font-size:22px;color:#8e8ea0;font-weight:400">継続が最大のコツです。応援しています。</span></div>
    </div>
  </div>
  <div class="input-area">
    <div class="input-box">
      <span>メッセージを入力…</span>
      <span style="color:#10a37f">⏎</span>
    </div>
  </div>
</div>
</body>
</html>`;
}

function buildClaudeCodeHTML(text) {
  const cmd = extractCommand(text);
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body {
  width: 1080px; height: 1920px;
  background: #1e1e2e;
  font-family: "JetBrains Mono", "Fira Code", "Courier New", monospace;
  color: #cdd6f4;
  overflow: hidden;
}
.titlebar {
  height: 50px; background: #181825;
  display: flex; align-items: center; padding: 0 20px;
  gap: 10px; border-bottom: 1px solid #313244;
}
.dot { width: 16px; height: 16px; border-radius: 50%; }
.d1 { background: #f38ba8; }
.d2 { background: #a6e3a1; }
.d3 { background: #f9e2af; }
.titlebar-text { color: #6c7086; font-size: 20px; margin-left: 20px; }
.terminal {
  padding: 40px 50px;
  font-size: 26px;
  line-height: 1.8;
}
.prompt { color: #cba6f7; }
.cmd { color: #89b4fa; }
.output { color: #a6e3a1; margin-bottom: 8px; }
.output.dim { color: #6c7086; }
.output.yellow { color: #f9e2af; }
.output.red { color: #f38ba8; }
.cursor-line { color: #cba6f7; }
.cursor {
  display: inline-block;
  width: 14px; height: 28px;
  background: #cba6f7;
  vertical-align: middle;
  animation: blink 1s step-end infinite;
}
@keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
.section { margin-bottom: 50px; }
.info-box {
  background: #313244;
  border-left: 4px solid #89b4fa;
  padding: 20px 24px;
  margin: 20px 0;
  border-radius: 0 8px 8px 0;
  font-size: 24px;
  line-height: 1.6;
}
</style>
</head>
<body>
<div class="titlebar">
  <div class="dot d1"></div>
  <div class="dot d2"></div>
  <div class="dot d3"></div>
  <span class="titlebar-text">claude — ~/automation — zsh</span>
</div>
<div class="terminal">
  <div class="section">
    <div class="prompt">❯ <span class="cmd">${cmd}</span></div>
    <div class="output dim">Initializing Claude Code...</div>
    <div class="output">✓ Connected to claude-sonnet-4-6</div>
    <div class="output">✓ Reading project context...</div>
  </div>
  <div class="info-box">
    <div style="color:#89b4fa;font-weight:700;margin-bottom:8px">● Claude Code</div>
    <div>${text.slice(0, 60)}</div>
  </div>
  <div class="section">
    <div class="output yellow">⚡ Generating output...</div>
    <div class="output">  ✓ note記事テンプレート生成完了</div>
    <div class="output">  ✓ ASPリンク最適化完了</div>
    <div class="output">  ✓ X投稿文 5件作成完了</div>
    <div class="output dim">  処理時間: 3.2s</div>
  </div>
  <div class="cursor-line">❯ <span class="cursor"></span></div>
</div>
</body>
</html>`;
}

function buildClaudeChatHTML(text) {
  const response = generateAIResponse(text);
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body {
  width: 1080px; height: 1920px;
  background: #1a1a2e;
  font-family: -apple-system, "Hiragino Kaku Gothic ProN", sans-serif;
  color: #e8e8f0;
  display: flex; flex-direction: column;
  overflow: hidden;
}
.header {
  padding: 30px 40px;
  background: #16213e;
  border-bottom: 1px solid #0f3460;
  display: flex; align-items: center; gap: 16px;
}
.logo {
  width: 52px; height: 52px;
  background: linear-gradient(135deg, #e07b54, #cc785c);
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 28px; color: white; font-weight: 700;
}
.header-text { font-size: 28px; font-weight: 600; }
.header-sub { font-size: 20px; color: #8888aa; }
.messages {
  flex: 1; padding: 50px 50px;
  overflow: hidden; display: flex; flex-direction: column; gap: 40px;
}
.msg { display: flex; gap: 20px; }
.msg.human { justify-content: flex-end; }
.avatar {
  width: 52px; height: 52px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 22px; flex-shrink: 0;
}
.avatar.claude { background: linear-gradient(135deg, #e07b54, #cc785c); color: white; }
.avatar.human { background: #533483; color: white; }
.bubble {
  max-width: 780px;
  background: #16213e;
  border-radius: 20px;
  padding: 24px 30px;
  font-size: 28px;
  line-height: 1.6;
  border: 1px solid #0f3460;
}
.msg.human .bubble { background: #533483; border-color: #6b4fa0; }
.response-item {
  display: flex; gap: 12px; align-items: flex-start;
  margin-bottom: 12px; font-size: 26px;
}
.bullet { color: #e07b54; font-size: 28px; flex-shrink: 0; }
.input-area {
  padding: 30px 50px;
  background: #16213e;
  border-top: 1px solid #0f3460;
}
.input-box {
  background: #0d1117;
  border: 1px solid #30363d;
  border-radius: 14px;
  padding: 22px 28px;
  font-size: 24px;
  color: #6c7086;
  display: flex; align-items: center; justify-content: space-between;
}
</style>
</head>
<body>
<div class="header">
  <div class="logo">C</div>
  <div>
    <div class="header-text">Claude</div>
    <div class="header-sub">claude-sonnet-4-6 · Anthropic</div>
  </div>
</div>
<div class="messages">
  <div class="msg human">
    <div class="bubble">${text.slice(0, 50)}</div>
    <div class="avatar human">👤</div>
  </div>
  <div class="msg">
    <div class="avatar claude">✦</div>
    <div class="bubble">
      ${response.split('\n').map(line =>
        `<div class="response-item"><span class="bullet">▸</span><span>${line}</span></div>`
      ).join('')}
    </div>
  </div>
</div>
<div class="input-area">
  <div class="input-box">
    <span>Claudeへメッセージを送る…</span>
    <span>⏎</span>
  </div>
</div>
</body>
</html>`;
}

function buildNoteEditorHTML(text) {
  const title = text.slice(0, 25) + (text.length > 25 ? '…' : '');
  const body  = generateArticleBody(text);
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body {
  width: 1080px; height: 1920px;
  background: #fff;
  font-family: -apple-system, "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif;
  color: #3d3d3d;
  overflow: hidden;
}
.header {
  height: 80px;
  background: #fff;
  border-bottom: 1px solid #e6e6e6;
  display: flex; align-items: center; padding: 0 40px;
  justify-content: space-between;
}
.header-logo { font-size: 36px; font-weight: 700; color: #000; }
.header-actions { display: flex; gap: 20px; align-items: center; }
.btn-draft {
  padding: 12px 28px;
  border: 1px solid #ccc;
  border-radius: 40px;
  font-size: 22px;
  color: #666;
}
.btn-publish {
  padding: 12px 40px;
  background: #41c9b4;
  border-radius: 40px;
  font-size: 22px;
  color: #fff;
  font-weight: 600;
}
.editor-area { padding: 60px 80px; }
.title-input {
  font-size: 52px;
  font-weight: 700;
  line-height: 1.4;
  color: #1a1a1a;
  border: none;
  outline: none;
  width: 100%;
  margin-bottom: 50px;
}
.toolbar {
  display: flex; gap: 8px; margin-bottom: 40px;
  padding: 12px 0; border-bottom: 1px solid #e6e6e6;
}
.tb-btn {
  width: 48px; height: 48px;
  border: 1px solid #e6e6e6;
  border-radius: 6px;
  display: flex; align-items: center; justify-content: center;
  font-size: 22px; color: #666;
}
.body-text {
  font-size: 30px;
  line-height: 1.9;
  color: #3d3d3d;
}
.body-text .highlight { color: #41c9b4; font-weight: 600; }
.cursor { display: inline-block; width: 3px; height: 32px; background: #41c9b4; vertical-align: middle; }
.word-count {
  position: fixed; bottom: 40px; right: 60px;
  color: #aaa; font-size: 22px;
}
</style>
</head>
<body>
<div class="header">
  <div class="header-logo">note</div>
  <div class="header-actions">
    <div class="btn-draft">下書き保存</div>
    <div class="btn-publish">公開設定</div>
  </div>
</div>
<div class="editor-area">
  <div class="title-input">${title}</div>
  <div class="toolbar">
    <div class="tb-btn"><b>B</b></div>
    <div class="tb-btn"><i>I</i></div>
    <div class="tb-btn">H₁</div>
    <div class="tb-btn">≡</div>
    <div class="tb-btn">🔗</div>
    <div class="tb-btn">🖼</div>
  </div>
  <div class="body-text">${body}<span class="cursor"></span></div>
</div>
<div class="word-count">約 2,400文字</div>
</body>
</html>`;
}

function buildASPDashboardHTML(text) {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body {
  width: 1080px; height: 1920px;
  background: #f5f5f5;
  font-family: -apple-system, "Hiragino Kaku Gothic ProN", sans-serif;
  color: #333;
  overflow: hidden;
}
.header {
  background: #e8380d;
  color: white;
  padding: 30px 40px;
  display: flex; align-items: center; gap: 20px;
}
.header-logo { font-size: 40px; font-weight: 700; }
.header-sub { font-size: 22px; opacity: 0.8; }
.content { padding: 50px 40px; }
.summary-grid {
  display: grid; grid-template-columns: 1fr 1fr;
  gap: 24px; margin-bottom: 50px;
}
.summary-card {
  background: white;
  border-radius: 12px;
  padding: 30px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
}
.card-label { font-size: 22px; color: #888; margin-bottom: 12px; }
.card-value { font-size: 48px; font-weight: 700; color: #e8380d; }
.card-value.green { color: #22b573; }
.card-value.blue { color: #0066cc; }
.table-card {
  background: white;
  border-radius: 12px;
  padding: 30px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
  margin-bottom: 30px;
}
.table-title { font-size: 28px; font-weight: 700; margin-bottom: 24px; }
.table-row {
  display: flex; justify-content: space-between;
  padding: 16px 0; border-bottom: 1px solid #f0f0f0;
  font-size: 26px;
}
.table-row:last-child { border-bottom: none; }
.row-val { font-weight: 600; color: #22b573; }
</style>
</head>
<body>
<div class="header">
  <div>
    <div class="header-logo">A8.net</div>
    <div class="header-sub">アフィリエイト管理画面</div>
  </div>
</div>
<div class="content">
  <div class="summary-grid">
    <div class="summary-card">
      <div class="card-label">今月の確定報酬</div>
      <div class="card-value">¥47,820</div>
    </div>
    <div class="summary-card">
      <div class="card-label">クリック数</div>
      <div class="card-value blue">3,241</div>
    </div>
    <div class="summary-card">
      <div class="card-label">成約件数</div>
      <div class="card-value green">28件</div>
    </div>
    <div class="summary-card">
      <div class="card-label">CV率</div>
      <div class="card-value green">0.86%</div>
    </div>
  </div>
  <div class="table-card">
    <div class="table-title">案件別レポート</div>
    <div class="table-row"><span>レンタルサーバー</span><span class="row-val">¥24,200</span></div>
    <div class="table-row"><span>ドメイン取得</span><span class="row-val">¥9,600</span></div>
    <div class="table-row"><span>VPN サービス</span><span class="row-val">¥7,400</span></div>
    <div class="table-row"><span>クレカ案件</span><span class="row-val">¥6,620</span></div>
  </div>
</div>
</body>
</html>`;
}

function buildYouTubeAnalyticsHTML(text) {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body {
  width: 1080px; height: 1920px;
  background: #0f0f0f;
  font-family: "YouTube Sans", "Roboto", sans-serif;
  color: #fff;
  overflow: hidden;
}
.header {
  padding: 24px 40px;
  background: #212121;
  display: flex; align-items: center; gap: 16px;
  border-bottom: 1px solid #383838;
}
.yt-logo { color: #ff0000; font-size: 40px; font-weight: 700; }
.header-title { font-size: 28px; color: #aaa; }
.content { padding: 50px 40px; }
.big-stat {
  text-align: center; margin-bottom: 60px;
  background: #212121; border-radius: 16px; padding: 50px;
}
.stat-label { font-size: 26px; color: #aaa; margin-bottom: 16px; }
.stat-value { font-size: 90px; font-weight: 700; color: #fff; }
.stat-change { font-size: 28px; color: #3ea6ff; margin-top: 12px; }
.chart-area {
  background: #212121; border-radius: 16px;
  padding: 40px; margin-bottom: 30px;
}
.chart-title { font-size: 28px; font-weight: 600; margin-bottom: 30px; }
.chart-bars {
  display: flex; align-items: flex-end; gap: 10px;
  height: 200px;
}
.bar-col { flex: 1; border-radius: 4px 4px 0 0; }
.stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
.stat-card {
  background: #212121; border-radius: 12px;
  padding: 30px;
}
.sc-label { font-size: 22px; color: #aaa; margin-bottom: 12px; }
.sc-val { font-size: 44px; font-weight: 700; }
.sc-val.blue { color: #3ea6ff; }
.sc-val.red { color: #ff4444; }
.sc-val.green { color: #2ba640; }
</style>
</head>
<body>
<div class="header">
  <span class="yt-logo">▶ YouTube</span>
  <span class="header-title">Studio Analytics</span>
</div>
<div class="content">
  <div class="big-stat">
    <div class="stat-label">過去28日間 視聴回数</div>
    <div class="stat-value">124.8K</div>
    <div class="stat-change">↑ +340% 先月比</div>
  </div>
  <div class="chart-area">
    <div class="chart-title">視聴回数の推移</div>
    <div class="chart-bars">
      ${[20,30,25,40,35,55,50,65,60,80,75,90,85,100].map((h,i) =>
        `<div class="bar-col" style="height:${h}%;background:${i===13?'#ff0000':'#3ea6ff'}"></div>`
      ).join('')}
    </div>
  </div>
  <div class="stats-grid">
    <div class="stat-card">
      <div class="sc-label">チャンネル登録者</div>
      <div class="sc-val blue">482人</div>
    </div>
    <div class="stat-card">
      <div class="sc-label">高評価率</div>
      <div class="sc-val green">94.2%</div>
    </div>
    <div class="stat-card">
      <div class="sc-label">平均視聴率</div>
      <div class="sc-val blue">68.4%</div>
    </div>
    <div class="stat-card">
      <div class="sc-label">収益(月)</div>
      <div class="sc-val green">¥8,240</div>
    </div>
  </div>
</div>
</body>
</html>`;
}

function buildAutomationHTML(text) {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body {
  width: 1080px; height: 1920px;
  background: #1a1a2e;
  font-family: -apple-system, "Hiragino Kaku Gothic ProN", sans-serif;
  color: #e8e8f0; overflow: hidden;
}
.header {
  padding: 30px 40px; background: #16213e;
  border-bottom: 1px solid #0f3460;
  font-size: 32px; font-weight: 700;
  display: flex; align-items: center; gap: 16px;
}
.n8n-logo {
  background: #ea4b71; color: white;
  padding: 8px 20px; border-radius: 8px;
  font-size: 30px; font-weight: 800;
}
.content { padding: 60px 50px; }
.flow {
  display: flex; flex-direction: column; gap: 0; align-items: center;
}
.node {
  background: #16213e;
  border: 2px solid #0f3460;
  border-radius: 14px;
  padding: 28px 40px;
  width: 820px;
  display: flex; align-items: center; gap: 24px;
  font-size: 28px;
}
.node.active { border-color: #ea4b71; background: #1a0a14; }
.node.done { border-color: #3fb950; background: #0a1f0a; }
.node-icon { font-size: 40px; }
.node-name { font-weight: 600; }
.node-desc { font-size: 22px; color: #8888aa; margin-top: 4px; }
.connector {
  width: 3px; height: 50px;
  background: linear-gradient(to bottom, #0f3460, #ea4b71);
  margin: 0 auto;
}
.status-bar {
  margin-top: 60px;
  background: #16213e;
  border-radius: 12px;
  padding: 30px 40px;
  font-size: 26px;
}
.status-row { display: flex; justify-content: space-between; margin-bottom: 16px; }
.ok { color: #3fb950; }
.running { color: #f9e2af; }
</style>
</head>
<body>
<div class="header">
  <div class="n8n-logo">n8n</div>
  <span>自動化ワークフロー実行中</span>
</div>
<div class="content">
  <div class="flow">
    <div class="node done">
      <div class="node-icon">⏰</div>
      <div><div class="node-name">Cron Trigger</div><div class="node-desc">毎日 07:00 JST</div></div>
      <div style="margin-left:auto;color:#3fb950">✓</div>
    </div>
    <div class="connector"></div>
    <div class="node done">
      <div class="node-icon">🤖</div>
      <div><div class="node-name">Claude API</div><div class="node-desc">note記事生成 (3000字)</div></div>
      <div style="margin-left:auto;color:#3fb950">✓</div>
    </div>
    <div class="connector"></div>
    <div class="node active">
      <div class="node-icon">📝</div>
      <div><div class="node-name">note.com 投稿</div><div class="node-desc">下書き保存→公開</div></div>
      <div style="margin-left:auto;color:#f9e2af">⟳</div>
    </div>
    <div class="connector"></div>
    <div class="node">
      <div class="node-icon">🐦</div>
      <div><div class="node-name">X (Twitter) 投稿</div><div class="node-desc">記事告知ツイート</div></div>
      <div style="margin-left:auto;color:#6c7086">…</div>
    </div>
    <div class="connector"></div>
    <div class="node">
      <div class="node-icon">📊</div>
      <div><div class="node-name">Analytics 収集</div><div class="node-desc">エンゲージメント記録</div></div>
      <div style="margin-left:auto;color:#6c7086">…</div>
    </div>
  </div>
  <div class="status-bar">
    <div class="status-row"><span>実行回数 (今月)</span><span class="ok">847回</span></div>
    <div class="status-row"><span>成功率</span><span class="ok">99.2%</span></div>
    <div class="status-row"><span>現在のステップ</span><span class="running">3/5 実行中…</span></div>
  </div>
</div>
</body>
</html>`;
}

function buildXAnalyticsHTML(text) {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body {
  width: 1080px; height: 1920px;
  background: #000;
  font-family: -apple-system, "Hiragino Kaku Gothic ProN", sans-serif;
  color: #e7e9ea; overflow: hidden;
}
.header {
  padding: 30px 40px; background: #000;
  border-bottom: 1px solid #2f3336;
  display: flex; align-items: center; gap: 20px;
}
.x-logo { font-size: 44px; font-weight: 900; }
.header-title { font-size: 30px; font-weight: 700; }
.tweet-card {
  background: #000; border-bottom: 1px solid #2f3336;
  padding: 40px 50px;
}
.tweet-header { display: flex; gap: 20px; margin-bottom: 20px; }
.avatar {
  width: 60px; height: 60px; border-radius: 50%;
  background: linear-gradient(135deg, #1d9bf0, #7856ff);
  display: flex; align-items: center; justify-content: center;
  font-size: 28px; flex-shrink: 0;
}
.user-info .name { font-size: 28px; font-weight: 700; }
.user-info .handle { font-size: 24px; color: #71767b; }
.tweet-text { font-size: 30px; line-height: 1.6; margin-bottom: 30px; }
.tweet-metrics {
  display: flex; gap: 50px; color: #71767b; font-size: 26px;
}
.metric { display: flex; align-items: center; gap: 12px; }
.metric.highlight { color: #1d9bf0; }
.metric.red { color: #f91880; }
.metric.green { color: #00ba7c; }
.analytics-card {
  background: #16181c; border-radius: 16px;
  padding: 40px 50px; margin: 40px;
}
.analytics-title { font-size: 28px; font-weight: 700; margin-bottom: 30px; }
.a-row {
  display: flex; justify-content: space-between;
  padding: 20px 0; border-bottom: 1px solid #2f3336;
  font-size: 26px;
}
.a-val { font-weight: 700; color: #1d9bf0; }
.a-val.green { color: #00ba7c; }
</style>
</head>
<body>
<div class="header">
  <div class="x-logo">𝕏</div>
  <div class="header-title">アナリティクス</div>
</div>
<div class="tweet-card">
  <div class="tweet-header">
    <div class="avatar">ぬ</div>
    <div class="user-info">
      <div class="name">ぬちょ【AI副業ハック】</div>
      <div class="handle">@nucho_ai_hack</div>
    </div>
  </div>
  <div class="tweet-text">Claude Codeだけで先月48,000円稼いだ方法を全部公開します。非エンジニアでも3ヶ月で再現できました→</div>
  <div class="tweet-metrics">
    <span class="metric red">♥ 2,847</span>
    <span class="metric highlight">↻ 891</span>
    <span class="metric">💬 234</span>
    <span class="metric green">👁 124.8K</span>
  </div>
</div>
<div class="analytics-card">
  <div class="analytics-title">投稿パフォーマンス (28日間)</div>
  <div class="a-row"><span>インプレッション</span><span class="a-val">1.24M</span></div>
  <div class="a-row"><span>エンゲージメント率</span><span class="a-val green">8.4%</span></div>
  <div class="a-row"><span>プロフィール訪問</span><span class="a-val">12,840</span></div>
  <div class="a-row"><span>フォロワー増加</span><span class="a-val green">+847</span></div>
  <div class="a-row"><span>リンククリック</span><span class="a-val">4,231</span></div>
</div>
</body>
</html>`;
}

// ── Helper: extract yen amount from narration ─────────────────────────────────
function extractAmount(text) {
  const m = text.match(/月?([\d,]+)円|(\d+)万円/);
  if (!m) return null;
  if (m[2]) return `¥${parseInt(m[2]) * 10000}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `¥${m[1]}`;
}

function extractCommand(text) {
  if (/note|記事/.test(text)) return 'claude "note記事のアウトライン作って"';
  if (/X|ツイート|投稿/.test(text)) return 'claude "X投稿文を5パターン生成して"';
  if (/自動化|ワークフロー/.test(text)) return 'claude "n8nワークフローの設定を最適化して"';
  return 'claude "副業の収益化ロードマップを作って"';
}

function generateAIResponse(text) {
  if (/収益|稼|万円/.test(text)) {
    return 'AIツールを使った副業収益化には\n3つのステップがあります\nnote記事→ASPリンク→X拡散\nで月5万円は再現可能です';
  }
  if (/note|記事/.test(text)) {
    return '売れるnote記事には\n①実績の数値証拠\n②具体的な手順\n③再現可能なテンプレ\nが必要です';
  }
  if (/自動化|ワークフロー/.test(text)) {
    return 'n8nで実現できる\n自動化ワークフロー\n①記事生成→②投稿→③分析\nを全自動で回せます';
  }
  return 'はい、その方法で\n月5万円の収益化は\n十分に再現可能です\n具体的な手順を説明します';
}

function generateArticleBody(text) {
  return `この記事では、AIツールを使って副業収益を\n上げる具体的な方法をお伝えします。<br><br>
<span class="highlight">結論から言います。</span>ChatGPTとClaude Codeを\n組み合わせれば、未経験でも3ヶ月で月5万円は\n十分に達成可能です。<br><br>
私自身が実践して得た収益は、最初の月は\n3,000円でしたが、3ヶ月後には48,000円まで\n増やすことができました。`;
}

// ── Scenario router ───────────────────────────────────────────────────────────
// 直前のシナリオを記録して連続同一背景を回避
let _lastScenario = null;

function resolveScenario(text, forceVariety = true) {
  // 全マッチを収集
  const matches = CAPTURE_ROUTES.filter(r => r.keys.some(k => new RegExp(k).test(text)));
  if (matches.length === 0) return null;

  if (!forceVariety || matches.length === 1) return matches[0].scenario;

  // 直前と異なるシナリオを優先
  const different = matches.find(r => r.scenario !== _lastScenario);
  return (different ?? matches[0]).scenario;
}

function buildHTML(scenario, text, opts = {}) {
  switch (scenario) {
    case 'earnings-dashboard':   return buildEarningsDashboardHTML(text, opts.proofNumber);
    case 'chatgpt-chat':         return buildChatGPTHTML(text);
    case 'claude-code-terminal': return buildClaudeCodeHTML(text);
    case 'claude-chat':          return buildClaudeChatHTML(text);
    case 'note-editor':          return buildNoteEditorHTML(text);
    case 'asp-dashboard':        return buildASPDashboardHTML(text);
    case 'youtube-analytics':    return buildYouTubeAnalyticsHTML(text);
    case 'automation-workflow':  return buildAutomationHTML(text);
    case 'x-analytics':          return buildXAnalyticsHTML(text);
    default:                     return null;
  }
}

// ── Real session capture: note.com ────────────────────────────────────────────
async function captureNoteEditor(outPath, viewport) {
  if (!fs.existsSync(NOTE_SESSION)) return null;
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const ctx  = await browser.newContext({ storageState: NOTE_SESSION, viewport });
    const page = await ctx.newPage();
    await page.goto('https://note.com/new', { waitUntil: 'networkidle', timeout: 30000 });
    if (page.url().includes('login') || page.url().includes('oauth')) return null;

    // エディタ本体が表示されるまで待つ（タイムアウト→モックにフォールバック）
    try {
      await page.waitForSelector('[contenteditable="true"], .note-editor, textarea', { timeout: 8000 });
    } catch {
      return null; // エディタ未表示 → モックHTMLを使う
    }
    await page.waitForTimeout(500);
    await page.screenshot({ path: outPath, fullPage: false });
    return outPath;
  } catch {
    return null;
  } finally {
    await browser.close();
  }
}

// ── Mock HTML capture ─────────────────────────────────────────────────────────
async function captureMockHTML(html, outPath, viewport) {
  const browser = await chromium.launch({ headless: true });
  try {
    const ctx  = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(300); // allow CSS animations to settle
    await page.screenshot({ path: outPath, fullPage: false });
    return outPath;
  } finally {
    await browser.close();
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Attempt to capture a scene image for the given narration text.
 * Returns the output path on success, or null to fall back to Imagen/gradient.
 *
 * @param {string} text        - Scene narration text
 * @param {number} sceneIndex  - 0-based scene index
 * @param {string} outPath     - Output file path (.png)
 * @param {string} type        - 'short' | 'long' | ...
 * @param {object} [opts]      - { proofNumber?: string }
 */
export async function captureSceneImage(text, sceneIndex, outPath, type = 'short', opts = {}) {
  const viewport = type === 'long' ? VIEWPORT_LONG : VIEWPORT_SHORT;
  if (sceneIndex === 0) _lastScenario = null; // reset variety tracker per video

  try {
    // ── Scene 0 with proofNumber: use earnings dashboard ──────────────────
    if (sceneIndex === 0 && opts.proofNumber) {
      const html = buildEarningsDashboardHTML(text, opts.proofNumber);
      return await captureMockHTML(html, outPath, viewport);
    }

    const scenario = resolveScenario(text);
    if (!scenario) return null;

    // ── Real session capture for note.com editor ──────────────────────────
    if (scenario === 'note-editor' && fs.existsSync(NOTE_SESSION)) {
      const result = await captureNoteEditor(outPath, viewport);
      if (result) {
        logger.info(MODULE, `real capture: note-editor → scene ${sceneIndex}`);
        _lastScenario = scenario;
        return result;
      }
      // fallthrough to mock if session expired
    }

    // ── Mock HTML capture ─────────────────────────────────────────────────
    const html = buildHTML(scenario, text, opts);
    if (!html) return null;

    const path_ = await captureMockHTML(html, outPath, viewport);
    _lastScenario = scenario;
    logger.info(MODULE, `mock capture: ${scenario} → scene ${sceneIndex}`);
    return path_;

  } catch (err) {
    logger.warn(MODULE, `capture failed for scene ${sceneIndex}: ${err.message}`);
    return null;
  }
}

/**
 * Capture all scenes in parallel (max 3 concurrent to avoid memory pressure).
 */
export async function captureAllScenes(scenes, outDir, type, draft = null) {
  const styleKey  = type === 'long' ? 'long' : 'short';
  const proofNum  = draft?.proofNumber ?? null;
  const results   = new Array(scenes.length).fill(null);
  const CONCURRENCY = 3;

  for (let start = 0; start < scenes.length; start += CONCURRENCY) {
    const batch = scenes.slice(start, start + CONCURRENCY);
    const paths = await Promise.all(batch.map((scene, j) => {
      const i       = start + j;
      const outPath = path.join(outDir, `${styleKey}_scene_${i}.png`);
      if (fs.existsSync(outPath)) return Promise.resolve(outPath); // cached
      return captureSceneImage(scene.text, i, outPath, type, { proofNumber: proofNum });
    }));
    paths.forEach((p, j) => { results[start + j] = p; });
  }

  return results; // null entries = fall back to Imagen
}
