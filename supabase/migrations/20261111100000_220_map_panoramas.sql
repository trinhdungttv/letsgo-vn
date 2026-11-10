-- ============================================================================
-- 220 — Khảo sát KCN: ẢNH 360° (ảnh cầu từ Google Photos / Google Drive / tải từ máy)
-- Chạy tay trong Supabase → SQL Editor. Chạy lại nhiều lần vẫn an toàn (idempotent).
--
--   map_panoramas   mỗi dòng = 1 ảnh 360 đặt tại 1 điểm trên bản đồ (lat/lng = chỗ đứng chụp — khi đang khảo sát lấy
--                   luôn GPS của điện thoại). trip_id / zone_id = chuyến khảo sát + KCN lúc thêm ảnh.
--     source_url    link người dùng dán (Google Photos / Drive / link ảnh) — giữ để mở lại nguồn gốc
--     pano_url      ảnh để xem (đã chép về Cloudflare R2, cỡ tối đa 6144 px)
--     google_url    link ảnh trực tiếp của Google (dự phòng khi R2 chưa cho tên miền đó đọc ảnh)
--     heading       hướng la bàn của GIỮA ảnh (độ, Bắc = 0) — để đặt ghim các công ty gần đó đúng hướng;
--                   NULL = chưa căn hướng
--     camera_height độ cao chụp (m): đứng dưới đất ~2 m, flycam 80–120 m — ghim công ty hạ xuống đúng chân toà nhà
--     haov/vaov/voffset  góc phủ ngang / dọc và vĩ độ giữa ảnh (ảnh 360 trọn = 360 / 180 / 0)
--     annotations   nét vẽ giống "Mặt bằng": [{ id, kind: label|line|area, label, note, color, size?, pts:[{yaw,pitch}] }]
--                   toạ độ theo hướng TRONG ẢNH → căn lại hướng Bắc không làm lệch nét vẽ
--     view          góc nhìn mở đầu { yaw, pitch, hfov }
--
-- Chưa chạy migration này: Khảo sát KCN vẫn dùng bình thường; nút "Ảnh 360" báo cần chạy 220, không lưu được ảnh.
--
-- Có mất / đổi dữ liệu hiện có không? KHÔNG — chỉ TẠO 1 bảng mới, không sửa bảng nào khác.
-- Xoá ảnh 360 trong app = xoá MỀM (deleted_at), dòng + file ảnh vẫn còn.
-- Không khoá ngoại (bài học PGRST201). Lịch sử dữ liệu: gắn dh_track RIÊNG bảng này (không gọi dh_attach_triggers()).
-- ============================================================================

CREATE TABLE IF NOT EXISTS map_panoramas (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title          text NOT NULL DEFAULT '',
  note           text NOT NULL DEFAULT '',
  source_kind    text NOT NULL DEFAULT 'url',          -- gphotos | gdrive | gimage | url | upload
  source_url     text NOT NULL DEFAULT '',
  pano_url       text NOT NULL,
  google_url     text,
  storage_path   text NOT NULL DEFAULT '',
  width          integer,
  height         integer,
  haov           double precision,
  vaov           double precision,
  voffset        double precision,
  lat            double precision,
  lng            double precision,
  heading        double precision,
  camera_height  double precision NOT NULL DEFAULT 2,
  view           jsonb,
  annotations    jsonb NOT NULL DEFAULT '[]'::jsonb,
  taken_at       timestamptz,
  trip_id        uuid,                                 -- kcn_survey_trips.id (không FK)
  zone_id        uuid,                                 -- market_zones.id (không FK)
  zone_name      text NOT NULL DEFAULT '',
  created_by     text NOT NULL DEFAULT '',
  updated_by     text NOT NULL DEFAULT '',
  deleted_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS map_panoramas_alive_idx ON map_panoramas (created_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS map_panoramas_zone_idx ON map_panoramas (zone_id) WHERE deleted_at IS NULL;

-- updated_at tự cập nhật
CREATE OR REPLACE FUNCTION map_panoramas_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_map_panoramas_touch ON map_panoramas;
CREATE TRIGGER trg_map_panoramas_touch BEFORE UPDATE ON map_panoramas
  FOR EACH ROW EXECUTE FUNCTION map_panoramas_touch_updated_at();

-- Quyền: giống các bảng Thị trường khác (app chạy anon)
ALTER TABLE map_panoramas ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'map_panoramas' AND policyname = 'map_panoramas_all_' || r) THEN
      EXECUTE format('CREATE POLICY %I ON map_panoramas FOR ALL TO %I USING (true) WITH CHECK (true)', 'map_panoramas_all_' || r, r);
    END IF;
  END LOOP;
END $$;

-- Lịch sử dữ liệu (cỗ máy thời gian + chặn ghi của vai trò chỉ xem) — gắn riêng bảng này
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'dh_log_change') THEN
    EXECUTE 'DROP TRIGGER IF EXISTS dh_track ON map_panoramas';
    EXECUTE 'CREATE TRIGGER dh_track AFTER INSERT OR UPDATE OR DELETE ON map_panoramas FOR EACH ROW EXECUTE FUNCTION dh_log_change()';
  END IF;
END $$;

COMMENT ON TABLE map_panoramas IS 'Ảnh 360° của Khảo sát KCN: vị trí chụp, hướng Bắc, nét vẽ đánh dấu công ty / đường. Xoá mềm bằng deleted_at.';

NOTIFY pgrst, 'reload schema';

-- ── Kiểm tra sau khi chạy (mong đợi: so_cot = 28) ───────────────────────
-- SELECT count(*) AS so_cot FROM information_schema.columns WHERE table_name = 'map_panoramas';

-- ── Rollback (chạy tay nếu cần bỏ — MẤT danh sách ảnh 360 + nét vẽ; file ảnh vẫn còn trên R2) ──
-- DROP TABLE IF EXISTS map_panoramas;
-- DROP FUNCTION IF EXISTS map_panoramas_touch_updated_at();
