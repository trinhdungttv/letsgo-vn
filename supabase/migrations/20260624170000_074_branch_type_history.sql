CREATE TABLE IF NOT EXISTS branch_type_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  branch_type TEXT NOT NULL DEFAULT 'contracted',
  effective_from TEXT NOT NULL,
  manager_name TEXT,
  lg_pct NUMERIC DEFAULT 60,
  cn_pct NUMERIC DEFAULT 40,
  notes TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
