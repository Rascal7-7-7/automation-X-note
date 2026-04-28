CREATE TABLE IF NOT EXISTS posts (
  id           SERIAL PRIMARY KEY,
  platform     TEXT NOT NULL,
  account      TEXT,
  content      TEXT,
  media_url    TEXT,
  status       TEXT DEFAULT 'pending',
  scheduled_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  metadata     JSONB,
  error_msg    TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS metrics (
  id          SERIAL PRIMARY KEY,
  key         TEXT NOT NULL,
  value       NUMERIC,
  meta        JSONB,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alerts (
  id         SERIAL PRIMARY KEY,
  severity   TEXT NOT NULL,
  source     TEXT,
  message    TEXT NOT NULL,
  resolved   BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workflow_runs (
  id            SERIAL PRIMARY KEY,
  workflow_name TEXT NOT NULL,
  status        TEXT NOT NULL,
  duration_ms   INT,
  error         TEXT,
  ran_at        TIMESTAMPTZ DEFAULT NOW()
);

-- SNSアカウント指標（日次スナップショット）
-- NOTE: recorded_date DATE column used for dedup (date_trunc on TIMESTAMPTZ is STABLE not IMMUTABLE)
CREATE TABLE IF NOT EXISTS sns_metrics (
  id            SERIAL PRIMARY KEY,
  platform      TEXT NOT NULL,
  account       TEXT NOT NULL,
  metric_key    TEXT NOT NULL,
  value         BIGINT NOT NULL,
  recorded_at   TIMESTAMP DEFAULT NOW(),
  recorded_date DATE NOT NULL DEFAULT CURRENT_DATE,
  UNIQUE (platform, account, metric_key, recorded_date)
);

-- 投稿別エンゲージメント
CREATE TABLE IF NOT EXISTS post_metrics (
  id          SERIAL PRIMARY KEY,
  platform    TEXT NOT NULL,
  post_id     TEXT NOT NULL,
  account     TEXT,
  metric_key  TEXT NOT NULL,
  value       NUMERIC NOT NULL,
  snapshot_at TEXT DEFAULT 'total',
  recorded_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (platform, post_id, metric_key, snapshot_at)
);

CREATE INDEX IF NOT EXISTS idx_posts_platform_status   ON posts(platform, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_pending           ON posts(status, created_at DESC) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_metrics_key_recorded    ON metrics(key, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_severity_created ON alerts(severity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_resolved         ON alerts(resolved, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sns_metrics_lookup      ON sns_metrics(platform, account, metric_key, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_post_metrics_lookup     ON post_metrics(platform, account, recorded_at DESC);
