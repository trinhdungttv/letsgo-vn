-- P&L module: per-project P&L, project cost breakdown, branch fixed overhead

-- Project P&L (one row per client per month)
CREATE TABLE IF NOT EXISTS projects_pnl (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id),
  month TEXT NOT NULL,
  branch_manager TEXT,
  project_type TEXT NOT NULL DEFAULT 'shared', -- 'shared' | 'managed'
  lg_pct NUMERIC NOT NULL DEFAULT 100,
  cn_pct NUMERIC NOT NULL DEFAULT 0,
  revenue NUMERIC NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (client_id, month)
);

-- Cost breakdown for each project P&L
CREATE TABLE IF NOT EXISTS projects_pnl_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pnl_id UUID NOT NULL REFERENCES projects_pnl(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  value NUMERIC NOT NULL DEFAULT 0,
  payer TEXT NOT NULL DEFAULT 'lg', -- 'lg' | 'cn' | 'ch'
  sort_order INT NOT NULL DEFAULT 0
);

-- Branch fixed/variable overhead per month
CREATE TABLE IF NOT EXISTS branch_overhead (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_manager TEXT NOT NULL,
  month TEXT NOT NULL,
  label TEXT NOT NULL,
  value NUMERIC NOT NULL DEFAULT 0,
  cost_type TEXT NOT NULL DEFAULT 'Cố định', -- 'Cố định' | 'Biến đổi'
  sort_order INT NOT NULL DEFAULT 0,
  UNIQUE (branch_manager, month, label)
);

ALTER TABLE projects_pnl ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects_pnl_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE branch_overhead ENABLE ROW LEVEL SECURITY;

CREATE POLICY projects_pnl_all_anon ON projects_pnl FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY projects_pnl_all_auth ON projects_pnl FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY projects_pnl_costs_all_anon ON projects_pnl_costs FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY projects_pnl_costs_all_auth ON projects_pnl_costs FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY branch_overhead_all_anon ON branch_overhead FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY branch_overhead_all_auth ON branch_overhead FOR ALL TO authenticated USING (true) WITH CHECK (true);
