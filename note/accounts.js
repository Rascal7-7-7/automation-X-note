/**
 * note マルチアカウント設定
 *
 * account 1: AI副業・自動化（現行）
 * account 2: 投資・FX・株（新規作成中）
 * account 3: A8.netアフィリエイト（新規作成中）
 */

export const NOTE_ACCOUNTS = {
  1: {
    id: 1,
    label: 'AI副業・自動化',
    noteUrl: 'https://note.com/rascal_ai_devops',
    personaSet: 'note-tech',
    queueDir: 'queue',                    // note/queue/ideas.jsonl
    draftsDir: 'drafts',                  // note/drafts/
    sessionFile: 'note-session.json',     // shared/sessions/
    brandTag: 'rascal_ai_devops',
    preferredTags: ['note', 'AI', 'AIとやってみた', '記事', 'GPT5', 'ChatGPT副業', 'GEO', 'フォロバ100', '相互フォロー'],
    tagPool: [
      { url: 'https://note.com/hashtag/AI副業',        tag: 'AI副業',        category: 'ai-income'    },
      { url: 'https://note.com/hashtag/生成AI',        tag: '生成AI',        category: 'ai-income'    },
      { url: 'https://note.com/hashtag/自動化ツール',  tag: '自動化ツール',  category: 'ai-income'    },
      { url: 'https://note.com/hashtag/AIエージェント', tag: 'AIエージェント', category: 'ai-income'   },
      { url: 'https://note.com/hashtag/AI活用',        tag: 'AI活用',        category: 'productivity' },
      { url: 'https://note.com/hashtag/業務効率化',    tag: '業務効率化',    category: 'productivity' },
      { url: 'https://note.com/hashtag/ChatGPT',      tag: 'ChatGPT',      category: 'ai-beginner'  },
      { url: 'https://note.com/hashtag/Claude',       tag: 'Claude',       category: 'ai-beginner'  },
      { url: 'https://note.com/hashtag/副業',          tag: '副業',          category: 'note-income'  },
      { url: 'https://note.com/hashtag/副業月収',      tag: '副業月収',      category: 'note-income'  },
      { url: 'https://note.com/hashtag/note収益化',   tag: 'note収益化',   category: 'note-income'  },
      { url: 'https://note.com/hashtag/フリーランス',  tag: 'フリーランス',  category: 'freelance'    },
      { url: 'https://note.com/hashtag/note',         tag: 'note',         category: 'discovery'    },
      { url: 'https://note.com/hashtag/AI',           tag: 'AI',           category: 'discovery'    },
      { url: 'https://note.com/hashtag/AIとやってみた', tag: 'AIとやってみた', category: 'discovery'  },
      { url: 'https://note.com/hashtag/記事',          tag: '記事',          category: 'discovery'    },
      { url: 'https://note.com/hashtag/GPT5',         tag: 'GPT5',         category: 'ai-beginner'  },
      { url: 'https://note.com/hashtag/ChatGPT副業',  tag: 'ChatGPT副業',  category: 'ai-income'    },
      { url: 'https://note.com/hashtag/GEO',          tag: 'GEO',          category: 'ai-beginner'  },
      { url: 'https://note.com/hashtag/フォロバ100',  tag: 'フォロバ100',  category: 'growth'       },
      { url: 'https://note.com/hashtag/相互フォロー',  tag: '相互フォロー',  category: 'growth'       },
    ],
    outlineExtra: `テーマ方向性: AI活用・Claude/n8n自動化・副業収益化。
固有名詞: Claude / n8n / ChatGPT / xurl を積極的に使う。`,
    freeExtra: `対象読者: AI副業に興味はあるが何から始めるか分からない会社員。`,
    paidExtra: `具体的なツール: Claude Code / n8n / GitHub Actions / Python等のコード・設定を提供する。`,
    price:      null,                                                // 無料（リーチ優先）
    ctaProfile: 'https://note.com/rascal_ai_devops',
    ctaLabel: 'AI活用・副業自動化の実践ノウハウを毎週公開',
  },

  2: {
    id: 2,
    label: '投資・FX・自動売買',
    noteUrl: 'https://note.com/rascal_invest',   // アカウント作成後に更新
    personaSet: 'note-finance',
    queueDir: 'queue/account2',
    draftsDir: 'drafts/account2',
    sessionFile: 'note-session-2.json',
    brandTag: 'rascal_invest',
    preferredTags: ['note', 'AI', '副業', 'お小遣い稼ぎ', '記事', 'フォロバ100', '相互フォロー'],
    tagPool: [
      { url: 'https://note.com/hashtag/投資初心者',       tag: '投資初心者',       category: 'beginner'  },
      { url: 'https://note.com/hashtag/NISA',             tag: 'NISA',             category: 'beginner'  },
      { url: 'https://note.com/hashtag/FX',               tag: 'FX',               category: 'fx'        },
      { url: 'https://note.com/hashtag/FX初心者',         tag: 'FX初心者',         category: 'fx'        },
      { url: 'https://note.com/hashtag/米国株',           tag: '米国株',           category: 'stocks'    },
      { url: 'https://note.com/hashtag/日本株',           tag: '日本株',           category: 'stocks'    },
      { url: 'https://note.com/hashtag/インデックス投資', tag: 'インデックス投資', category: 'index'     },
      { url: 'https://note.com/hashtag/資産運用',         tag: '資産運用',         category: 'index'     },
      { url: 'https://note.com/hashtag/自動売買',         tag: '自動売買',         category: 'autobot'   },
      { url: 'https://note.com/hashtag/FXボット',         tag: 'FXボット',         category: 'autobot'   },
      { url: 'https://note.com/hashtag/AI投資',           tag: 'AI投資',           category: 'ai-invest' },
      { url: 'https://note.com/hashtag/アルゴリズムトレード', tag: 'アルゴリズムトレード', category: 'ai-invest' },
      { url: 'https://note.com/hashtag/note',            tag: 'note',            category: 'discovery' },
      { url: 'https://note.com/hashtag/AI',              tag: 'AI',              category: 'discovery' },
      { url: 'https://note.com/hashtag/副業',             tag: '副業',             category: 'income'    },
      { url: 'https://note.com/hashtag/お小遣い稼ぎ',    tag: 'お小遣い稼ぎ',    category: 'income'    },
      { url: 'https://note.com/hashtag/記事',             tag: '記事',             category: 'discovery' },
      { url: 'https://note.com/hashtag/フォロバ100',     tag: 'フォロバ100',     category: 'growth'    },
      { url: 'https://note.com/hashtag/相互フォロー',     tag: '相互フォロー',     category: 'growth'    },
    ],
    outlineExtra: `テーマ方向性（2本柱）:
① 投資基礎: NISA/FX/米国株/インデックス投資 — 初心者が今日から始められる実践内容。
② AI×投資自動化: 自動売買BOT・トレーディングAPI（OANDA / Interactive Brokers / Alpaca）・AIエージェントによる相場分析・Claude/Python/n8nを使った売買ロジック構築。
数字: 実際の損益・積立額・バックテスト結果を具体的に示す。
トーン: リスクも正直に書く（信頼性重視）。ロマン的な「必ず儲かる」表現は禁止。`,
    freeExtra: `対象読者: 投資に興味はあるが怖くて始められない20〜40代 + 自動売買に興味があるエンジニア・AI副業志望者。`,
    paidExtra: `証拠: 取引履歴・証券口座スクリーンショット言及・バックテスト結果グラフ言及・実際のAPI設定コードをコードブロックで提供する。`,
    price:      null,                                                // 無料（リーチ優先）
    ctaProfile: 'https://note.com/rascal_invest',
    ctaLabel: '投資×AI自動化の実践レポートを毎週公開',
  },

  3: {
    id: 3,
    label: 'A8.netアフィリエイト',
    noteUrl: 'https://note.com/rascal_affiliate',  // アカウント作成後に更新
    personaSet: 'note-affiliate',
    queueDir: 'queue/account3',
    draftsDir: 'drafts/account3',
    sessionFile: 'note-session-3.json',
    brandTag: 'rascal_affiliate',
    preferredTags: ['note', 'AI', 'ChatGPT', '生成AI', 'AIとやってみた', 'お小遣い稼ぎ', '記事', 'AI副業', 'GPT5', 'ChatGPT副業', 'アトカ', 'フォロバ100', '相互フォロー'],
    tagPool: [
      { url: 'https://note.com/hashtag/アフィリエイト',   tag: 'アフィリエイト',   category: 'affiliate' },
      { url: 'https://note.com/hashtag/A8net',           tag: 'A8net',           category: 'affiliate' },
      { url: 'https://note.com/hashtag/ブログ収益化',    tag: 'ブログ収益化',    category: 'affiliate' },
      { url: 'https://note.com/hashtag/副業',            tag: '副業',            category: 'income'    },
      { url: 'https://note.com/hashtag/ネット副業',      tag: 'ネット副業',      category: 'income'    },
      { url: 'https://note.com/hashtag/在宅ワーク',      tag: '在宅ワーク',      category: 'income'    },
      { url: 'https://note.com/hashtag/SEO',             tag: 'SEO',             category: 'seo'       },
      { url: 'https://note.com/hashtag/WordPressブログ', tag: 'WordPressブログ', category: 'seo'       },
      { url: 'https://note.com/hashtag/初心者副業',      tag: '初心者副業',      category: 'beginner'  },
      { url: 'https://note.com/hashtag/ドメイン取得',    tag: 'ドメイン取得',    category: 'hosting'   },
      { url: 'https://note.com/hashtag/レンタルサーバー', tag: 'レンタルサーバー', category: 'hosting'  },
      { url: 'https://note.com/hashtag/note',            tag: 'note',            category: 'discovery' },
      { url: 'https://note.com/hashtag/AI',              tag: 'AI',              category: 'ai'        },
      { url: 'https://note.com/hashtag/ChatGPT',         tag: 'ChatGPT',         category: 'ai'        },
      { url: 'https://note.com/hashtag/生成AI',          tag: '生成AI',          category: 'ai'        },
      { url: 'https://note.com/hashtag/AIとやってみた',  tag: 'AIとやってみた',  category: 'ai'        },
      { url: 'https://note.com/hashtag/お小遣い稼ぎ',    tag: 'お小遣い稼ぎ',    category: 'income'    },
      { url: 'https://note.com/hashtag/記事',            tag: '記事',            category: 'discovery' },
      { url: 'https://note.com/hashtag/AI副業',          tag: 'AI副業',          category: 'ai-income' },
      { url: 'https://note.com/hashtag/GPT5',            tag: 'GPT5',            category: 'ai'        },
      { url: 'https://note.com/hashtag/ChatGPT副業',     tag: 'ChatGPT副業',     category: 'ai-income' },
      { url: 'https://note.com/hashtag/アトカ',          tag: 'アトカ',          category: 'influencer'},
      { url: 'https://note.com/hashtag/フォロバ100',     tag: 'フォロバ100',     category: 'growth'    },
      { url: 'https://note.com/hashtag/相互フォロー',     tag: '相互フォロー',     category: 'growth'    },
    ],
    // 承認済みA8.net案件（2026-04-21時点）
    approvedCampaigns: [
      { id: 'a8_dmm_ai_camp',    name: 'DMM 生成AI CAMP',       reward: '¥7,519（入会）/ ¥2,257（無料セミナー）', category: 'AI学習' },
      { id: 'a8_self_recruit',   name: 'A8.net（無料登録）',    reward: '¥300',                                  category: 'アフィリ登録' },
      { id: 'a8_onamae_server',  name: 'お名前.com サーバー',   reward: '¥3,100',                                category: 'ホスティング' },
      { id: 'a8_onamae_domain',  name: 'お名前.com ドメイン',   reward: '¥1,100',                                category: 'ホスティング' },
      { id: 'a8_onamae_transfer',name: 'お名前.com ドメイン移管', reward: '¥1,100',                              category: 'ホスティング' },
      { id: 'rakuten_market',    name: '楽天市場',               reward: '商品%（変動）',                         category: 'EC物販' },
      { id: 'rakuten_travel',    name: '楽天トラベル',           reward: '宿泊%（変動）',                         category: '旅行' },
    ],
    outlineExtra: `テーマ方向性（2本柱）:
① アフィリエイト入門: A8.netでの始め方・案件選び・ブログ集客の基本 — 完全初心者向け。
② 高単価案件の実践: 承認済みA8案件を活用した収益化レポート（DMM生成AI CAMP¥7,519 / お名前.comサーバー¥3,100 / お名前.comドメイン¥1,100 / A8.net登録¥300 / 楽天市場 / 楽天トラベル）。
デバイス・ネット契約カテゴリ: スマホ・Wi-Fi・格安SIM・プロバイダ乗り換えなど生活コストに関わるアフィリ案件も積極的に紹介。
トーン: 実際の収益レポート形式（月〇円・CV率・案件名を具体的に開示）。`,
    freeExtra: `対象読者: アフィリエイトを始めたいが何から手をつければいいか分からない副業初心者。A8.netに登録したばかりの人。`,
    paidExtra: `証拠: A8.net管理画面・成果レポートのスクリーンショット言及・具体的なCV数・承認率・実収益額を開示する。記事内で承認済み案件のアフィリリンクを自然に紹介する（CTAとして）。`,
    price:      500,                                                 // 有料500円（CVR優先・案件リンク込み）
    ctaProfile: 'https://note.com/rascal_affiliate',
    ctaLabel: 'アフィリエイト副業の実践収益レポートを毎週公開',
  },
};

export function getAccount(accountId = 1) {
  const id = Number(accountId);
  if (!NOTE_ACCOUNTS[id]) throw new Error(`unknown note account: ${accountId}`);
  return NOTE_ACCOUNTS[id];
}
