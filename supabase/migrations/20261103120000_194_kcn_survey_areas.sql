-- ============================================================================
-- 194 — Khảo sát KCN: vùng khảo sát đã khoanh (ranh giới KCN tra từ bản đồ hoặc tự vẽ)
-- ----------------------------------------------------------------------------
-- KCN / cụm công nghiệp chưa có trên hệ thống hoặc chưa có ranh giới: trong màn Khảo sát KCN bấm "Thêm / khoanh vùng"
-- → tra theo tên, link Google Maps hoặc chỗ đang đứng (dữ liệu OpenStreetMap), hoặc tự chấm vùng trên bản đồ.
-- Vùng lưu ở đây, gắn với 1 KCN (market_zones) → lần sau khảo sát KCN đó app tô đúng đường trong vùng.
--
--   rings   [[[lat, lng], …], …] — các vòng ngoài của vùng
--   source  osm = lấy ranh giới có sẵn trên OpenStreetMap · drawn = tự chấm trên bản đồ · view = lấy khung đang nhìn
--
-- Có mất dữ liệu hiện có không? KHÔNG — chỉ TẠO bảng mới. Khoanh lại vùng = sửa dòng cũ (lịch sử dữ liệu giữ bản trước).
-- Không có khoá ngoại sang market_zones (bài học PGRST201; xoá KCN vẫn giữ vùng). Gắn dh_track riêng bảng này,
-- KHÔNG gọi dh_attach_triggers(). Chạy lại nhiều lần vẫn an toàn.
-- ============================================================================

CREATE TABLE IF NOT EXISTS kcn_survey_areas (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id     uuid,                                   -- market_zones.id (không FK)
  name        text NOT NULL DEFAULT '',
  rings       jsonb NOT NULL DEFAULT '[]'::jsonb,
  source      text NOT NULL DEFAULT 'drawn' CHECK (source IN ('osm', 'drawn', 'view')),
  osm_ref     text,                                   -- 'w123' / 'r456' khi lấy từ OpenStreetMap
  center_lat  double precision,
  center_lng  double precision,
  area_m2     numeric(14, 1),
  user_id     uuid,
  user_name   text NOT NULL DEFAULT '',
  deleted_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
-- Mỗi KCN 1 vùng đang dùng
CREATE UNIQUE INDEX IF NOT EXISTS kcn_survey_areas_zone_uq ON kcn_survey_areas (zone_id) WHERE deleted_at IS NULL AND zone_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_kcn_survey_areas_touch ON kcn_survey_areas;
CREATE TRIGGER trg_kcn_survey_areas_touch
  BEFORE UPDATE ON kcn_survey_areas
  FOR EACH ROW EXECUTE FUNCTION cskh_touch_updated_at();

ALTER TABLE kcn_survey_areas ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'kcn_survey_areas' AND policyname = 'kcn_survey_areas_all_' || r) THEN
      EXECUTE format('CREATE POLICY %I ON kcn_survey_areas FOR ALL TO %I USING (true) WITH CHECK (true)', 'kcn_survey_areas_all_' || r, r);
    END IF;
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'dh_log_change') THEN
    EXECUTE 'DROP TRIGGER IF EXISTS dh_track ON kcn_survey_areas';
    EXECUTE 'CREATE TRIGGER dh_track AFTER INSERT OR UPDATE OR DELETE ON kcn_survey_areas FOR EACH ROW EXECUTE FUNCTION dh_log_change()';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

-- ── Kiểm tra (mong đợi: true) ───────────────────────────────────────────────
-- SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'kcn_survey_areas') AS co_bang_vung_khao_sat;

-- ── ROLLBACK (mất các vùng đã khoanh; KCN thêm nhanh vẫn còn trong market_zones) ──
-- DROP TABLE IF EXISTS kcn_survey_areas;
