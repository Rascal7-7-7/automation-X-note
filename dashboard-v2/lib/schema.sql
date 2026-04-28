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
