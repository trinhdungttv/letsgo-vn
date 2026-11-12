-- ============================================================================
-- 223 — Khảo sát KCN: KẾ HOẠCH GHÉ CÔNG TY + ảnh bổ sung theo vết GPS
-- Chạy tay trong Supabase → SQL Editor. Chạy lại nhiều lần vẫn an toàn (idempotent).
--
-- (1) kcn_survey_plan_stops — mỗi dòng = 1 công ty CẦN ĐI QUA ở 1 KCN, lên trước khi đi khảo sát
--     (tra Google được 10 công ty tiêu biểu → dán link Google Maps / gõ tên để app tự tìm).
--     Lúc đi thực tế, app tự sắp thứ tự ghé ngắn nhất (đường xe máy thật) và dẫn đường lần lượt từng công ty.
--       source      maps_link | coords | system | overture | google | osm | manual  (lấy vị trí từ đâu)
--       ref_key     khoá công ty trong hệ thống nếu khớp: c:<client> / p:<pipeline> / l:<lead> ('' = công ty ngoài)
--       visited_at / visited_trip_id   lần gần nhất tới nơi (GPS cách ≤ 50 m) — "đã ghé" tính theo TỪNG chuyến
-- (2) kcn_survey_photos.position_source thêm 'track' = ảnh bổ sung sau (ảnh không có GPS trong máy) được ghim theo
--     GIỜ CHỤP khớp với vết GPS của chuyến. Chưa chạy migration này thì app tự lưu 'manual' như cũ.
--
-- Có mất / đổi dữ liệu hiện có không? KHÔNG — chỉ TẠO 1 bảng mới + nới điều kiện 1 cột (giá trị cũ vẫn hợp lệ).
-- Xoá công ty khỏi kế hoạch trong app = xoá MỀM (deleted_at), dòng vẫn còn.
-- Không khoá ngoại (bài học PGRST201). Lịch sử dữ liệu: gắn dh_track RIÊNG bảng này (không gọi dh_attach_triggers()).
-- ============================================================================

CREATE TABLE IF NOT EXISTS kcn_survey_plan_stops (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id          uuid,                                          -- market_zones.id (không FK)
  zone_name        text NOT NULL DEFAULT '',
  name             text NOT NULL DEFAULT '',
  address          text NOT NULL DEFAULT '',
  lat              double precision NOT NULL,
  lng              double precision NOT NULL,
  source           text NOT NULL DEFAULT 'manual',
  ref_key          text NOT NULL DEFAULT '',
  map_link         text NOT NULL DEFAULT '',
  note             text NOT NULL DEFAULT '',
  visited_at       timestamptz,
  visited_trip_id  uuid,
  created_by       text NOT NULL DEFAULT '',
  updated_by       text NOT NULL DEFAULT '',
  deleted_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kcn_survey_plan_stops_zone_idx ON kcn_survey_plan_stops (zone_id) WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION kcn_survey_plan_stops_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_kcn_survey_plan_stops_touch ON kcn_survey_plan_stops;
CREATE TRIGGER trg_kcn_survey_plan_stops_touch BEFORE UPDATE ON kcn_survey_plan_stops
  FOR EACH ROW EXECUTE FUNCTION kcn_survey_plan_stops_touch_updated_at();

-- Quyền: giống các bảng khảo sát khác (app chạy anon)
ALTER TABLE kcn_survey_plan_stops ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'kcn_survey_plan_stops' AND policyname = 'kcn_survey_plan_stops_all_' || r) THEN
      EXECUTE format('CREATE POLICY %I ON kcn_survey_plan_stops FOR ALL TO %I USING (true) WITH CHECK (true)', 'kcn_survey_plan_stops_all_' || r, r);
    END IF;
  END LOOP;
END $$;

-- Lịch sử dữ liệu (cỗ máy thời gian + chặn ghi của vai trò chỉ xem) — gắn riêng bảng này
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'dh_log_change') THEN
    EXECUTE 'DROP TRIGGER IF EXISTS dh_track ON kcn_survey_plan_stops';
    EXECUTE 'CREATE TRIGGER dh_track AFTER INSERT OR UPDATE OR DELETE ON kcn_survey_plan_stops FOR EACH ROW EXECUTE FUNCTION dh_log_change()';
  END IF;
END $$;

COMMENT ON TABLE kcn_survey_plan_stops IS 'Công ty cần ghé khi khảo sát KCN (lên kế hoạch trước, app sắp thứ tự + dẫn đường). Xoá mềm bằng deleted_at.';

-- ── (2) Ảnh bổ sung ghim theo giờ chụp trên vết GPS: position_source thêm 'track' ──
DO $$
DECLARE c text;
BEGIN
  -- bỏ điều kiện cũ (gps | exif | manual) — tên do Postgres tự đặt nên tìm theo nội dung
  FOR c IN
    SELECT con.conname FROM pg_constraint con
    WHERE con.conrelid = 'kcn_survey_photos'::regclass AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%position_source%'
  LOOP
    EXECUTE format('ALTER TABLE kcn_survey_photos DROP CONSTRAINT %I', c);
  END LOOP;
  ALTER TABLE kcn_survey_photos ADD CONSTRAINT kcn_survey_photos_position_source_check
    CHECK (position_source IN ('gps', 'exif', 'manual', 'track'));
END $$;

NOTIFY pgrst, 'reload schema';

-- ── Kiểm tra sau khi chạy (mong đợi: so_cot = 18, dieu_kien có 'track') ──
-- SELECT count(*) AS so_cot FROM information_schema.columns WHERE table_name = 'kcn_survey_plan_stops';
-- SELECT pg_get_constraintdef(oid) AS dieu_kien FROM pg_constraint WHERE conname = 'kcn_survey_photos_position_source_check';

-- ── Rollback (chạy tay nếu cần bỏ — MẤT danh sách công ty cần ghé) ──
-- DROP TABLE IF EXISTS kcn_survey_plan_stops;
-- DROP FUNCTION IF EXISTS kcn_survey_plan_stops_touch_updated_at();
-- UPDATE kcn_survey_photos SET position_source = 'manual' WHERE position_source = 'track';
-- ALTER TABLE kcn_survey_photos DROP CONSTRAINT IF EXISTS kcn_survey_photos_position_source_check;
-- ALTER TABLE kcn_survey_photos ADD CONSTRAINT kcn_survey_photos_position_source_check CHECK (position_source IN ('gps', 'exif', 'manual'));
