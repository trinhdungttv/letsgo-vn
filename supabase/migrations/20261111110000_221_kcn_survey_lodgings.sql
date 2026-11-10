-- ============================================================================
-- 221 — Khảo sát KCN: NHÀ TRỌ (ghi nhận khi đi khảo sát, giống ảnh chỉ tiêu)
-- Chạy tay trong Supabase → SQL Editor. Chạy lại nhiều lần vẫn an toàn (idempotent).
--
--   kcn_survey_lodgings   mỗi dòng = 1 nhà trọ: chủ nhà + SĐT, tổng số phòng / còn trống, giá, tiện ích,
--                         ảnh nhà trọ + ảnh cơ sở vật chất, vị trí (GPS điện thoại lúc ghi), KCN + chuyến khảo sát.
--     photos   [{ id, kind: house|facility, url, thumb_url, storage_path, caption, width, height }]
--              file ảnh nằm ở Cloudflare R2 (kcn-survey/lodging/…, storage_path "r2:…"), R2 lỗi → bucket kcn-survey của Supabase.
--     routes   khoảng cách thực tế tới các công ty gần nhất, tính lúc lưu:
--              [{ key, name, kind, lat, lng, straight_m, moto_km, moto_min, walk_km, walk_min, engine, at }]
--              (moto = đường xe máy, walk = đi bộ — Valhalla; lỗi thì ước theo đường ô tô OSRM)
--
-- Chưa chạy migration này: Khảo sát KCN vẫn dùng bình thường; nút "Nhà trọ" báo cần chạy 221, không lưu được.
--
-- Có mất / đổi dữ liệu hiện có không? KHÔNG — chỉ TẠO 1 bảng mới, không sửa bảng nào khác.
-- Xoá nhà trọ trong app = xoá MỀM (deleted_at), dòng + ảnh vẫn còn.
-- Không khoá ngoại (bài học PGRST201). Lịch sử dữ liệu: gắn dh_track RIÊNG bảng này (không gọi dh_attach_triggers()).
-- ============================================================================

CREATE TABLE IF NOT EXISTS kcn_survey_lodgings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),   -- app tự sinh id → mất mạng bấm lưu lại không tạo trùng
  name             text NOT NULL DEFAULT '',
  address          text NOT NULL DEFAULT '',
  landlord_name    text NOT NULL DEFAULT '',
  landlord_phone   text NOT NULL DEFAULT '',
  total_rooms      integer,
  vacant_rooms     integer,
  rent_min         integer,                                       -- đồng / tháng
  rent_max         integer,
  facilities       text[] NOT NULL DEFAULT '{}',
  note             text NOT NULL DEFAULT '',
  photos           jsonb NOT NULL DEFAULT '[]'::jsonb,
  lat              double precision,
  lng              double precision,
  position_source  text NOT NULL DEFAULT 'gps',                   -- gps | exif | manual
  zone_id          uuid,                                          -- market_zones.id (không FK)
  zone_name        text NOT NULL DEFAULT '',
  trip_id          uuid,                                          -- kcn_survey_trips.id (không FK)
  routes           jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by       text NOT NULL DEFAULT '',
  updated_by       text NOT NULL DEFAULT '',
  deleted_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kcn_survey_lodgings_zone_idx ON kcn_survey_lodgings (zone_id) WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION kcn_survey_lodgings_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_kcn_survey_lodgings_touch ON kcn_survey_lodgings;
CREATE TRIGGER trg_kcn_survey_lodgings_touch BEFORE UPDATE ON kcn_survey_lodgings
  FOR EACH ROW EXECUTE FUNCTION kcn_survey_lodgings_touch_updated_at();

-- Quyền: giống các bảng khảo sát khác (app chạy anon)
ALTER TABLE kcn_survey_lodgings ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'kcn_survey_lodgings' AND policyname = 'kcn_survey_lodgings_all_' || r) THEN
      EXECUTE format('CREATE POLICY %I ON kcn_survey_lodgings FOR ALL TO %I USING (true) WITH CHECK (true)', 'kcn_survey_lodgings_all_' || r, r);
    END IF;
  END LOOP;
END $$;

-- Lịch sử dữ liệu (cỗ máy thời gian + chặn ghi của vai trò chỉ xem) — gắn riêng bảng này
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'dh_log_change') THEN
    EXECUTE 'DROP TRIGGER IF EXISTS dh_track ON kcn_survey_lodgings';
    EXECUTE 'CREATE TRIGGER dh_track AFTER INSERT OR UPDATE OR DELETE ON kcn_survey_lodgings FOR EACH ROW EXECUTE FUNCTION dh_log_change()';
  END IF;
END $$;

COMMENT ON TABLE kcn_survey_lodgings IS 'Nhà trọ ghi nhận khi khảo sát KCN: chủ nhà / SĐT, số phòng, giá, tiện ích, ảnh, khoảng cách xe máy / đi bộ tới công ty. Xoá mềm bằng deleted_at.';

NOTIFY pgrst, 'reload schema';

-- ── Kiểm tra sau khi chạy (mong đợi: so_cot = 24) ───────────────────────
-- SELECT count(*) AS so_cot FROM information_schema.columns WHERE table_name = 'kcn_survey_lodgings';

-- ── Rollback (chạy tay nếu cần bỏ — MẤT danh sách nhà trọ; file ảnh vẫn còn trên R2 / Supabase) ──
-- DROP TABLE IF EXISTS kcn_survey_lodgings;
-- DROP FUNCTION IF EXISTS kcn_survey_lodgings_touch_updated_at();
