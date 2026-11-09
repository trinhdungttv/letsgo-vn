-- ============================================================================
-- 215 — DANH MỤC NGÀNH ĐÀO TẠO CHUẨN (Nguồn LĐ). Chạy tay trong Supabase → SQL Editor. Chạy lại nhiều lần vẫn an toàn.
-- Cần migration 213 đã chạy trước (có bảng labor_source_programs + hàm labor_sources_touch_updated_at).
--
--   labor_source_programs.program_key   khoá ổn định của ngành (VD 'dien-cong-nghiep') — để LỌC trường theo ngành.
--   labor_program_catalog               ngành người dùng thêm vào danh mục chung (ngoài bộ ngành chuẩn dựng sẵn trong code).
--
-- Có mất / đổi dữ liệu hiện có không? KHÔNG — chỉ THÊM 1 cột (mặc định '') + TẠO 1 bảng mới. Không sửa / xoá dòng nào.
-- Không có khoá ngoại (bài học PGRST201). Bảng mới chưa bị embed ở đâu.
-- Chưa chạy migration này: form vẫn chọn được ngành từ bộ chuẩn (khoá suy từ tên chuẩn); chỉ không thêm được ngành mới vào danh mục chung.
-- ============================================================================

ALTER TABLE labor_source_programs ADD COLUMN IF NOT EXISTS program_key text NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS labor_source_programs_key_idx ON labor_source_programs (program_key) WHERE deleted_at IS NULL AND program_key <> '';

CREATE TABLE IF NOT EXISTS labor_program_catalog (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text NOT NULL,                        -- 'x-' + khoá rút gọn của tên (xem slugKey ở programCatalog.ts)
  name        text NOT NULL,                        -- tên chuẩn hiển thị
  group_key   text NOT NULL DEFAULT 'khac',         -- nhóm ngành (dien-dien-tu | co-khi | … | khac)
  created_by  text NOT NULL DEFAULT '',
  updated_by  text NOT NULL DEFAULT '',
  deleted_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS labor_program_catalog_key_uidx ON labor_program_catalog (key) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_labor_program_catalog_touch ON labor_program_catalog;
CREATE TRIGGER trg_labor_program_catalog_touch BEFORE UPDATE ON labor_program_catalog
  FOR EACH ROW EXECUTE FUNCTION labor_sources_touch_updated_at();

ALTER TABLE labor_program_catalog ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'labor_program_catalog' AND policyname = 'labor_program_catalog_all_' || r) THEN
      EXECUTE format('CREATE POLICY %I ON labor_program_catalog FOR ALL TO %I USING (true) WITH CHECK (true)', 'labor_program_catalog_all_' || r, r);
    END IF;
  END LOOP;
END $$;

-- Lịch sử dữ liệu — gắn riêng bảng này (KHÔNG gọi dh_attach_triggers())
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'dh_log_change') THEN
    DROP TRIGGER IF EXISTS dh_track ON labor_program_catalog;
    CREATE TRIGGER dh_track AFTER INSERT OR UPDATE OR DELETE ON labor_program_catalog FOR EACH ROW EXECUTE FUNCTION dh_log_change();
  END IF;
END $$;

COMMENT ON COLUMN labor_source_programs.program_key IS 'Khoá ổn định của ngành đào tạo (bộ chuẩn trong code hoặc labor_program_catalog.key); rỗng = suy từ tên.';
COMMENT ON TABLE labor_program_catalog IS 'Nguồn lao động — ngành đào tạo người dùng thêm vào danh mục chung (ngoài bộ chuẩn trong code). Xoá mềm bằng deleted_at.';

NOTIFY pgrst, 'reload schema';

-- Kiểm tra sau khi chạy (mong đợi: 1 cột + 1 bảng)
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'labor_source_programs' AND column_name = 'program_key';
-- SELECT count(*) FROM labor_program_catalog;

-- Rollback (chạy tay nếu cần bỏ):
-- DROP TABLE IF EXISTS labor_program_catalog;
-- ALTER TABLE labor_source_programs DROP COLUMN IF EXISTS program_key;
