CREATE TABLE IF NOT EXISTS posts (
  id SERIAL PRIMARY KEY,
  platform TEXT NOT NULL,
  account TEXT,
  content TEXT,
  status TEXT DEFAULT 'success',
  error_msg TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS metrics (
  id SERIAL PRIMARY KEY,
  key TEXT NOT NULL,
  value NUMERIC,
  meta JSONB,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alerts (
  id SERIAL PRIMARY KEY,
  severity TEXT NOT NULL,
  source TEXT,
  message TEXT NOT NULL,
  resolved BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workflow_runs (
  id SERIAL PRIMARY KEY,
  workflow_name TEXT NOT NULL,
  status TEXT NOT NULL,
  duration_ms INT,
  error TEXT,
  ran_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_posts_platform_created ON posts(platform, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_key_recorded ON metrics(key, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_severity_created ON alerts(severity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_resolved ON alerts(resolved, created_at DESC);

-- SNSアカウント指標（日次スナップショット）
CREATE TABLE IF NOT EXISTS sns_metrics (
  id SERIAL PRIMARY KEY,
  platform TEXT NOT NULL,
  account TEXT NOT NULL,
  metric_key TEXT NOT NULL,
  value BIGINT NOT NULL,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sns_metrics_unique
  ON sns_metrics(platform, account, metric_key, date_trunc('day', recorded_at));
CREATE INDEX IF NOT EXISTS idx_sns_metrics_lookup
  ON sns_metrics(platform, account, metric_key, recorded_at DESC);

-- 投稿別エンゲージメント
CREATE TABLE IF NOT EXISTS post_metrics (
  id SERIAL PRIMARY KEY,
  platform TEXT NOT NULL,
  post_id TEXT NOT NULL,
  account TEXT,
  metric_key TEXT NOT NULL,
  value NUMERIC NOT NULL,
  snapshot_at TEXT DEFAULT 'total',
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_post_metrics_unique
  ON post_metrics(platform, post_id, metric_key, snapshot_at);
CREATE INDEX IF NOT EXISTS idx_post_metrics_lookup
  ON post_metrics(platform, account, recorded_at DESC);
