CREATE TABLE IF NOT EXISTS pnl_revenue_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pnl_id UUID NOT NULL REFERENCES projects_pnl(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT 'Hoa don',
  amount NUMERIC DEFAULT 0,
  invoice_date DATE,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);
