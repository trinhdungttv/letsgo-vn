-- Per-client default profit-split ratio (lg_pct/cn_pct) used when creating new monthly
-- projects_pnl rows, plus an optional temporary override that auto-expires after N months.
CREATE TABLE IF NOT EXISTS pnl_split_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL UNIQUE REFERENCES clients(id) ON DELETE CASCADE,
  lg_pct NUMERIC NOT NULL DEFAULT 40,
  cn_pct NUMERIC NOT NULL DEFAULT 60,
  pending_lg_pct NUMERIC,
  pending_cn_pct NUMERIC,
  pending_until_month TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE pnl_split_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY pnl_split_settings_all_anon ON pnl_split_settings FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY pnl_split_settings_all_auth ON pnl_split_settings FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Marks whether a project's split for this month came from a temporary override,
-- and whether it just reverted back to the normal default this month.
ALTER TABLE projects_pnl ADD COLUMN IF NOT EXISTS split_temp_until TEXT;
ALTER TABLE projects_pnl ADD COLUMN IF NOT EXISTS split_reverted BOOLEAN NOT NULL DEFAULT false;
