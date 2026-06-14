-- Lịch khảo sát KCN (Workspace -> KCN Grid) + báo cáo khảo sát dùng chung với
-- "Hồ sơ khu vực" (Market -> Zones), vì cùng tham chiếu market_zones.id

CREATE TABLE IF NOT EXISTS kcn_visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id UUID NOT NULL REFERENCES market_zones(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  visit_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status TEXT NOT NULL DEFAULT 'planned', -- 'planned' | 'done'
  report_summary TEXT,
  occupancy_note TEXT,
  labor_note TEXT,
  wage_note TEXT,
  competitor_note TEXT,
  notes TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kcn_visits_zone ON kcn_visits(zone_id, visit_date DESC);
CREATE INDEX IF NOT EXISTS idx_kcn_visits_user ON kcn_visits(user_id, visit_date DESC);

ALTER TABLE kcn_visits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "kcn_visits_all_anon" ON kcn_visits;
CREATE POLICY "kcn_visits_all_anon" ON kcn_visits FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "kcn_visits_all_auth" ON kcn_visits;
CREATE POLICY "kcn_visits_all_auth" ON kcn_visits FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Cập nhật kcn_summary: last_visit_date lấy từ lần khảo sát "đã hoàn thành" gần nhất
-- trong kcn_visits (fallback về market_zones.last_visit_date cho dữ liệu cũ),
-- thêm next_visit_date = lịch khảo sát sắp tới gần nhất chưa hoàn thành.
-- Dùng DROP + CREATE (không dùng CREATE OR REPLACE) vì thứ tự cột thay đổi
-- so với view cũ — Postgres không cho rename/reorder cột qua REPLACE.
DROP VIEW IF EXISTS kcn_summary;
CREATE VIEW kcn_summary AS
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
  COALESCE(
    (SELECT max(v.visit_date) FROM kcn_visits v WHERE v.zone_id = mz.id AND v.status = 'done'),
    mz.last_visit_date
  ) AS last_visit_date,
  (SELECT min(v.visit_date) FROM kcn_visits v WHERE v.zone_id = mz.id AND v.status = 'planned') AS next_visit_date,
  CASE WHEN COALESCE(
      (SELECT max(v.visit_date) FROM kcn_visits v WHERE v.zone_id = mz.id AND v.status = 'done'),
      mz.last_visit_date
    ) IS NULL THEN NULL
    ELSE (CURRENT_DATE - COALESCE(
      (SELECT max(v.visit_date) FROM kcn_visits v WHERE v.zone_id = mz.id AND v.status = 'done'),
      mz.last_visit_date
    ))
  END AS days_since_visit
FROM market_zones mz;

GRANT SELECT ON kcn_summary TO anon, authenticated;
