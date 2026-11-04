-- ============================================================================
-- 199 — Hồ sơ Khách hàng: SƠ ĐỒ TỔ CHỨC + MẶT BẰNG NHÀ XƯỞNG
-- Chạy tay trong Supabase → SQL Editor. Chạy lại nhiều lần vẫn an toàn (idempotent).
--
--   client_org_charts   1 sơ đồ tổ chức / khách hàng (tab "Sơ đồ tổ chức" trong hồ sơ khách).
--                       mindmap = cùng định dạng JSON với Sơ đồ tư duy của Ghi chú nhanh (quick_notes.mindmap).
--   client_site_maps    ảnh mặt bằng nhà xưởng của khách (tab "Mặt bằng"), mỗi khách nhiều ảnh
--                       (nhà máy 1, nhà máy 2, tầng 2…). File ảnh nằm trên Cloudflare R2 (storage_path "r2:…"),
--                       R2 chưa cài thì nằm ở bucket avatars/client-site/… của Supabase.
--                       zones = các khu vực vẽ lên ảnh: [{ id, label, note, color, x, y, w?, h?, size? }],
--                       toạ độ 0..1 theo khung ảnh (ảnh gốc KHÔNG bị sửa → sửa / xoá khu vực lúc nào cũng được).
--
-- Chưa chạy migration này: hồ sơ khách vẫn mở bình thường; 2 tab mới báo "cần chạy migration 199" và
-- KHÔNG lưu được gì.
--
-- Có mất / đổi dữ liệu hiện có không? KHÔNG — chỉ TẠO 2 bảng mới. Không sửa bảng clients.
-- Xoá ảnh mặt bằng trong app = xoá MỀM (deleted_at), dòng + file ảnh vẫn còn.
-- Không có khoá ngoại sang clients (bài học PGRST201; xoá khách không kéo theo mất sơ đồ).
-- Lịch sử dữ liệu: gắn dh_track RIÊNG 2 bảng này (KHÔNG gọi dh_attach_triggers()) → sửa sai vẫn tra lại được.
-- ============================================================================

-- ── 1. Sơ đồ tổ chức ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS client_org_charts (
  client_id   uuid PRIMARY KEY,                       -- clients.id (không FK)
  mindmap     jsonb NOT NULL,
  updated_by  text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ── 2. Mặt bằng nhà xưởng ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS client_site_maps (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid NOT NULL,                        -- clients.id (không FK)
  title         text NOT NULL DEFAULT '',
  image_url     text NOT NULL,
  storage_path  text NOT NULL DEFAULT '',
  width         integer,
  height        integer,
  zones         jsonb NOT NULL DEFAULT '[]'::jsonb,
  sort_order    integer NOT NULL DEFAULT 0,
  created_by    text NOT NULL DEFAULT '',
  updated_by    text NOT NULL DEFAULT '',
  deleted_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS client_site_maps_client_idx ON client_site_maps (client_id) WHERE deleted_at IS NULL;

-- updated_at tự cập nhật
CREATE OR REPLACE FUNCTION client_maps_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_client_org_charts_touch ON client_org_charts;
CREATE TRIGGER trg_client_org_charts_touch BEFORE UPDATE ON client_org_charts
  FOR EACH ROW EXECUTE FUNCTION client_maps_touch_updated_at();

DROP TRIGGER IF EXISTS trg_client_site_maps_touch ON client_site_maps;
CREATE TRIGGER trg_client_site_maps_touch BEFORE UPDATE ON client_site_maps
  FOR EACH ROW EXECUTE FUNCTION client_maps_touch_updated_at();

-- ── 3. Quyền: giống các bảng khách hàng khác (app chạy anon) ───────────────
ALTER TABLE client_org_charts ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_site_maps ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE
  t text;
  r text;
BEGIN
  FOREACH t IN ARRAY ARRAY['client_org_charts', 'client_site_maps'] LOOP
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = t || '_all_' || r) THEN
        EXECUTE format('CREATE POLICY %I ON %I FOR ALL TO %I USING (true) WITH CHECK (true)', t || '_all_' || r, t, r);
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- ── 4. Lịch sử dữ liệu (cỗ máy thời gian) — gắn riêng từng bảng ────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'dh_log_change') THEN
    EXECUTE 'DROP TRIGGER IF EXISTS dh_track ON client_org_charts';
    EXECUTE 'CREATE TRIGGER dh_track AFTER INSERT OR UPDATE OR DELETE ON client_org_charts FOR EACH ROW EXECUTE FUNCTION dh_log_change()';
    EXECUTE 'DROP TRIGGER IF EXISTS dh_track ON client_site_maps';
    EXECUTE 'CREATE TRIGGER dh_track AFTER INSERT OR UPDATE OR DELETE ON client_site_maps FOR EACH ROW EXECUTE FUNCTION dh_log_change()';
  END IF;
END $$;

COMMENT ON TABLE client_org_charts IS 'Sơ đồ tổ chức bên khách hàng (1 dòng / khách), JSON cùng định dạng Sơ đồ tư duy Ghi chú nhanh.';
COMMENT ON TABLE client_site_maps IS 'Ảnh mặt bằng nhà xưởng của khách + các khu vực vẽ lên ảnh (zones, toạ độ 0..1). Xoá mềm bằng deleted_at.';

-- PostgREST nạp lại danh sách bảng ngay (khỏi đợi)
NOTIFY pgrst, 'reload schema';

-- ── Kiểm tra sau khi chạy (mong đợi: 2 dòng) ───────────────────────────────
-- SELECT table_name FROM information_schema.tables
--  WHERE table_name IN ('client_org_charts', 'client_site_maps');

-- ── Rollback (chạy tay nếu cần bỏ — MẤT sơ đồ tổ chức + khu vực đã vẽ; file ảnh vẫn còn trên R2/Supabase) ──
-- DROP TABLE IF EXISTS client_org_charts;
-- DROP TABLE IF EXISTS client_site_maps;
-- DROP FUNCTION IF EXISTS client_maps_touch_updated_at();
