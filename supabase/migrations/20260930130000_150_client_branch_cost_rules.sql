-- Mốc đơn giá chi phí riêng của chi nhánh theo từng khách hàng (quỹ tết / hoa hồng KH, đ/công):
-- đơn giá áp dụng cho tháng M = mốc mới nhất có effective_from <= M. Đặt ở hồ sơ Khách hàng.
CREATE TABLE IF NOT EXISTS client_branch_cost_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('tet', 'commission')),
  rate NUMERIC NOT NULL DEFAULT 0,
  effective_from TEXT NOT NULL, -- 'YYYY-MM'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, kind, effective_from)
);

ALTER TABLE client_branch_cost_rules ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "cbcr_all_anon" ON client_branch_cost_rules FOR ALL TO anon USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "cbcr_all_auth" ON client_branch_cost_rules FOR ALL TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
