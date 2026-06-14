-- Workspace modules: Morning Priority, Win/Loss Tracker, KCN Grid
-- (UI đã có sẵn ở src/components/workspace/*, nhưng bảng dữ liệu chưa tồn tại)

-- ============================================================
-- 1) MORNING PRIORITY: khai báo ưu tiên buổi sáng + kết quả cuối ngày
-- ============================================================
CREATE TABLE IF NOT EXISTS morning_priorities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  priority_date DATE NOT NULL DEFAULT CURRENT_DATE,
  target_client TEXT,
  target_kcn TEXT,
  goal_type TEXT,
  goal_note TEXT,
  outcome_note TEXT,
  outcome_status TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, priority_date)
);
CREATE INDEX IF NOT EXISTS idx_morning_priorities_user_date ON morning_priorities(user_id, priority_date DESC);

ALTER TABLE morning_priorities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "morning_priorities_all_anon" ON morning_priorities FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "morning_priorities_all_auth" ON morning_priorities FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================================
-- 2) WIN/LOSS TRACKER: ghi nhận deal thắng/thua/đang xử lý
-- ============================================================
CREATE TABLE IF NOT EXISTS win_loss_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  client_name TEXT NOT NULL,
  client_id UUID REFERENCES clients(id),
  deal_type TEXT NOT NULL DEFAULT 'new_client',
  result TEXT NOT NULL DEFAULT 'pending',
  labor_count INTEGER,
  monthly_value NUMERIC,
  loss_reason TEXT,
  competitor_name TEXT,
  competitor_price NUMERIC,
  decision_maker TEXT,
  first_contact_date DATE,
  deal_closed_date DATE,
  days_to_close INTEGER GENERATED ALWAYS AS (
    CASE WHEN first_contact_date IS NOT NULL AND deal_closed_date IS NOT NULL
      THEN (deal_closed_date - first_contact_date) END
  ) STORED,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_win_loss_records_created ON win_loss_records(created_at DESC);

ALTER TABLE win_loss_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "win_loss_records_all_anon" ON win_loss_records FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "win_loss_records_all_auth" ON win_loss_records FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================================
-- 3) KCN GRID: mở rộng bảng market_zones (dữ liệu cũ) thay vì tạo bảng mới
-- ============================================================
ALTER TABLE market_zones ADD COLUMN IF NOT EXISTS province TEXT;
ALTER TABLE market_zones ADD COLUMN IF NOT EXISTS last_visit_date DATE;
ALTER TABLE market_zones ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

-- View tổng hợp cho KCN Grid: client_count & days_since_visit tính động từ dữ liệu hiện có
CREATE OR REPLACE VIEW kcn_summary AS
SELECT
  mz.id,
  mz.name,
  COALESCE(mz.province, mz.location) AS province,
  COALESCE(mz.potential, 3) AS potential_score,
  mz.notes,
  mz.is_active,
  mz.created_at,
  COALESCE((
    SELECT count(*) FROM clients c
    WHERE c.client_type = 'active' AND c.industrial_zones @> ARRAY[mz.name]
  ), 0) AS client_count,
  mz.last_visit_date,
  CASE WHEN mz.last_visit_date IS NULL THEN NULL
       ELSE (CURRENT_DATE - mz.last_visit_date) END AS days_since_visit
FROM market_zones mz;

GRANT SELECT ON kcn_summary TO anon, authenticated;
