-- ============================================================================
-- 190 — Khảo sát KCN bằng GPS (Thị trường → Bản đồ → nút "Khảo sát KCN")
-- ----------------------------------------------------------------------------
-- Đi 1 vòng KCN: app ghi vết GPS, vẽ đường đã đi (cả các lần trước) để biết đường nào chưa đi,
-- báo công ty đang đi ngang, chụp ảnh bảng chỉ tiêu tuyển dụng ngoài cổng kèm toạ độ chỗ chụp.
--
--   kcn_survey_trips          1 chuyến khảo sát: KCN, người đi, giờ bắt đầu / kết thúc, quãng đường,
--                             khung toạ độ (để tìm chuyến cũ quanh 1 khu), danh sách công ty đã đi ngang.
--   kcn_survey_track_chunks   vết GPS, ghi NỐI THÊM từng đoạn ~30 giây (không sửa dòng cũ) → mất sóng / tắt app
--                             giữa chừng vẫn giữ phần đã ghi. points = [[lat, lng, giây kể từ lúc bắt đầu, sai số m], …]
--   kcn_survey_photos         ảnh chỉ tiêu tuyển dụng: toạ độ chỗ chụp, công ty (gắn khách hàng / pipeline /
--                             Thị trường hoặc tên gõ tay), vị trí tuyển, số lượng, mức lương ghi trên bảng.
--   Bucket Storage 'kcn-survey' (công khai, chỉ cho XEM + TẢI LÊN; không cho sửa / xoá file bằng anon key).
--
-- Có mất dữ liệu hiện có không? KHÔNG — chỉ TẠO bảng / bucket mới, không đụng bảng cũ.
-- Nút "Xoá" trong app là xoá mềm (đặt deleted_at), file ảnh vẫn nằm trong Storage.
--
-- Lịch sử dữ liệu: gắn trigger dh_track RIÊNG cho 2 bảng chuyến + ảnh. KHÔNG gọi dh_attach_triggers() —
-- trước bản sửa 185 (02/11) hàm đó gắn cho MỌI bảng, kể cả bảng riêng tư (Tuyển dụng 180–183, Ghi chú nhanh 188).
-- Bảng vết GPS cũng không gắn (dữ liệu thô, chỉ ghi thêm, đã gắn theo chuyến).
-- Không thêm khoá ngoại sang clients / market_leads / crm_pipeline → không ảnh hưởng các chỗ embed cũ (bài học PGRST201).
-- Chạy lại nhiều lần vẫn an toàn (idempotent). Rollback: xem cuối file.
-- ============================================================================

-- ── 1. Chuyến khảo sát ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kcn_survey_trips (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id       uuid,                                   -- market_zones.id (không FK: xoá KCN vẫn giữ chuyến)
  zone_name     text NOT NULL DEFAULT '',               -- tên KCN lúc đi
  user_id       uuid,                                   -- app_users.id người đi
  user_name     text NOT NULL DEFAULT '',
  started_at    timestamptz NOT NULL DEFAULT now(),
  ended_at      timestamptz,                            -- NULL = đang đi / bị ngắt giữa chừng
  distance_m    numeric(10,1) NOT NULL DEFAULT 0 CHECK (distance_m >= 0),
  min_lat       double precision,
  min_lng       double precision,
  max_lat       double precision,
  max_lng       double precision,
  -- [{ key, name, status, first_at, min_dist_m }] — công ty đã đi ngang trong chuyến
  passed        jsonb NOT NULL DEFAULT '[]'::jsonb,
  road_coverage numeric(5,2) CHECK (road_coverage IS NULL OR road_coverage BETWEEN 0 AND 100),
  note          text NOT NULL DEFAULT '',
  deleted_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kcn_survey_trips_zone_idx ON kcn_survey_trips (zone_id, started_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS kcn_survey_trips_started_idx ON kcn_survey_trips (started_at DESC) WHERE deleted_at IS NULL;

-- ── 2. Vết GPS (ghi nối thêm) ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kcn_survey_track_chunks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id     uuid NOT NULL REFERENCES kcn_survey_trips(id) ON DELETE CASCADE,
  seq         integer NOT NULL CHECK (seq >= 0),        -- thứ tự đoạn do app đánh, gửi lại không bị trùng
  segment     integer NOT NULL DEFAULT 0 CHECK (segment >= 0), -- tạm dừng rồi đi tiếp = đoạn mới (không nối 2 đầu)
  points      jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (trip_id, seq)
);
CREATE INDEX IF NOT EXISTS kcn_survey_track_chunks_trip_idx ON kcn_survey_track_chunks (trip_id, seq);

-- ── 3. Ảnh chỉ tiêu tuyển dụng ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kcn_survey_photos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id         uuid REFERENCES kcn_survey_trips(id) ON DELETE SET NULL,
  zone_id         uuid,
  zone_name       text NOT NULL DEFAULT '',
  lat             double precision NOT NULL,
  lng             double precision NOT NULL,
  accuracy_m      real,
  -- gps = vị trí điện thoại lúc bấm chụp · exif = đọc từ ảnh có sẵn · manual = chấm tay trên bản đồ
  position_source text NOT NULL DEFAULT 'gps' CHECK (position_source IN ('gps', 'exif', 'manual')),
  taken_at        timestamptz NOT NULL DEFAULT now(),
  storage_path    text NOT NULL,
  url             text NOT NULL,
  thumb_url       text,
  width           integer,
  height          integer,
  size_bytes      integer,
  company_name    text NOT NULL DEFAULT '',
  client_id       uuid,                                 -- clients.id (không FK)
  lead_id         uuid,                                 -- market_leads.id (không FK)
  crm_id          uuid,                                 -- crm_pipeline.id (không FK)
  positions       text NOT NULL DEFAULT '',             -- vị trí đang tuyển: "CN may, QC, kho"
  headcount       integer CHECK (headcount IS NULL OR headcount >= 0),
  wage_text       text NOT NULL DEFAULT '',             -- mức lương ghi trên bảng: "8–10 triệu"
  note            text NOT NULL DEFAULT '',
  user_id         uuid,
  user_name       text NOT NULL DEFAULT '',
  deleted_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kcn_survey_photos_zone_idx ON kcn_survey_photos (zone_id, taken_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS kcn_survey_photos_trip_idx ON kcn_survey_photos (trip_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS kcn_survey_photos_taken_idx ON kcn_survey_photos (taken_at DESC) WHERE deleted_at IS NULL;

-- ── 4. updated_at tự cập nhật (hàm có từ migration 168; tạo lại phòng DB chưa có) ──
CREATE OR REPLACE FUNCTION cskh_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_kcn_survey_trips_touch ON kcn_survey_trips;
CREATE TRIGGER trg_kcn_survey_trips_touch
  BEFORE UPDATE ON kcn_survey_trips
  FOR EACH ROW EXECUTE FUNCTION cskh_touch_updated_at();

DROP TRIGGER IF EXISTS trg_kcn_survey_photos_touch ON kcn_survey_photos;
CREATE TRIGGER trg_kcn_survey_photos_touch
  BEFORE UPDATE ON kcn_survey_photos
  FOR EACH ROW EXECUTE FUNCTION cskh_touch_updated_at();

-- ── 5. Quyền: app chạy role anon (phiên đăng nhập riêng) → mở cho anon + authenticated ──
ALTER TABLE kcn_survey_trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE kcn_survey_track_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE kcn_survey_photos ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE
  t text;
  r text;
BEGIN
  FOREACH t IN ARRAY ARRAY['kcn_survey_trips', 'kcn_survey_track_chunks', 'kcn_survey_photos'] LOOP
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = t || '_all_' || r) THEN
        EXECUTE format('CREATE POLICY %I ON %I FOR ALL TO %I USING (true) WITH CHECK (true)', t || '_all_' || r, t, r);
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- ── 6. Bucket ảnh (công khai: XEM + TẢI LÊN; không sửa / xoá file) ──────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('kcn-survey', 'kcn-survey', true)
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'kcn_survey_select_' || r) THEN
      EXECUTE format('CREATE POLICY %I ON storage.objects FOR SELECT TO %I USING (bucket_id = %L)', 'kcn_survey_select_' || r, r, 'kcn-survey');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'kcn_survey_insert_' || r) THEN
      EXECUTE format('CREATE POLICY %I ON storage.objects FOR INSERT TO %I WITH CHECK (bucket_id = %L)', 'kcn_survey_insert_' || r, r, 'kcn-survey');
    END IF;
  END LOOP;
END $$;

-- ── 7. Lịch sử dữ liệu: chỉ 2 bảng chuyến + ảnh (xem ghi chú đầu file) ──────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'dh_log_change') THEN
    EXECUTE 'DROP TRIGGER IF EXISTS dh_track ON kcn_survey_trips';
    EXECUTE 'CREATE TRIGGER dh_track AFTER INSERT OR UPDATE OR DELETE ON kcn_survey_trips FOR EACH ROW EXECUTE FUNCTION dh_log_change()';
    EXECUTE 'DROP TRIGGER IF EXISTS dh_track ON kcn_survey_photos';
    EXECUTE 'CREATE TRIGGER dh_track AFTER INSERT OR UPDATE OR DELETE ON kcn_survey_photos FOR EACH ROW EXECUTE FUNCTION dh_log_change()';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

-- ── Kiểm tra sau khi chạy (mong đợi: 3 · true) ──────────────────────────────
-- SELECT
--   (SELECT count(*) FROM information_schema.tables WHERE table_name IN ('kcn_survey_trips', 'kcn_survey_track_chunks', 'kcn_survey_photos')) AS so_bang_moi,
--   EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'kcn-survey') AS co_bucket_anh;

-- ── ROLLBACK (chỉ chạy khi cần gỡ) ──────────────────────────────────────────
-- Mất: mọi chuyến khảo sát, vết GPS, thông tin ảnh chỉ tiêu (file ảnh vẫn còn trong bucket 'kcn-survey').
-- DROP TABLE IF EXISTS kcn_survey_photos;
-- DROP TABLE IF EXISTS kcn_survey_track_chunks;
-- DROP TABLE IF EXISTS kcn_survey_trips;
