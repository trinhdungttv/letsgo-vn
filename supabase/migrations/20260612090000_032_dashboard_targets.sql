-- Dashboard labor targets per scope ('total' or a region/branch name)
CREATE TABLE IF NOT EXISTS dashboard_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL UNIQUE,
  target_value NUMERIC NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE dashboard_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY dashboard_targets_all_anon ON dashboard_targets FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY dashboard_targets_all_auth ON dashboard_targets FOR ALL TO authenticated USING (true) WITH CHECK (true);
