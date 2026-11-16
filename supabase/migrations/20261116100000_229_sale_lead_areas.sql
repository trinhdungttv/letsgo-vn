-- ============================================================================
-- 229 — DANH MỤC KHU VỰC CỦA BẢNG NHÁP ĐẦU MỐI (CRM → CSKH → tệp Sale / CTV → tab "Đầu mối")
-- Chạy tay trong Supabase → SQL Editor. Chạy lại nhiều lần vẫn an toàn (idempotent).
--
-- Trước đây cột "Khu vực" của đầu mối chỉ ghép được với danh mục KCN (market_zones); chữ nào không khớp
-- (Thủ Đức, Dĩ An, Bình Dương…) chỉ là chữ xám, KHÔNG lọc được. Migration này thêm:
--   • bảng sale_lead_areas      danh sách khu vực tạo sẵn ngoài KCN (tỉnh, quận / huyện, cụm…) — mỗi mục 1 dòng
--   • sale_leads.area_ids       khu vực đã chọn của từng đầu mối (sale_lead_areas.id) — để LỌC
--   • sale_leads.area_reviewed  true = đã chọn lại khu vực bằng tay → không hiện chữ gốc xám nữa
-- KCN vẫn ở sale_leads.zone_ids (market_zones) như cũ — quản lý ở Thị trường → Khu vực.
--
-- Có mất / đổi dữ liệu hiện có không? KHÔNG — chỉ TẠO 1 bảng mới + THÊM 2 cột có DEFAULT vào sale_leads.
--   Không xoá / sửa dòng nào, area_text (chữ gốc) giữ nguyên. Rollback được (cuối file).
-- Không có khoá ngoại (giống 226 — bài học PGRST201).
-- ============================================================================

-- ── 1. Danh mục khu vực ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sale_lead_areas (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  created_by  text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Không trùng tên (không phân biệt hoa / thường)
CREATE UNIQUE INDEX IF NOT EXISTS sale_lead_areas_name_key ON sale_lead_areas (lower(btrim(name)));

-- ── 2. Cột mới của sale_leads ──────────────────────────────────────────────
ALTER TABLE sale_leads ADD COLUMN IF NOT EXISTS area_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE sale_leads ADD COLUMN IF NOT EXISTS area_reviewed boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS sale_leads_area_ids_idx ON sale_leads USING gin (area_ids);

-- ── 3. Danh sách tạo sẵn (chỉ thêm tên chưa có) ────────────────────────────
INSERT INTO sale_lead_areas (name, created_by)
SELECT v.name, 'migration 229'
  FROM (VALUES
    ('Bình Dương'), ('Đồng Nai'), ('TP. Hồ Chí Minh'), ('Long An'),
    ('Thủ Đức'), ('Dĩ An'), ('Thuận An'), ('Bến Cát')
  ) AS v(name)
 WHERE NOT EXISTS (SELECT 1 FROM sale_lead_areas a WHERE lower(btrim(a.name)) = lower(btrim(v.name)));

-- ── 4. Quyền bảng: giống các bảng khác của app (app chạy anon) ─────────────
ALTER TABLE sale_lead_areas ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sale_lead_areas' AND policyname = 'sale_lead_areas_all_' || r) THEN
      EXECUTE format('CREATE POLICY %I ON sale_lead_areas FOR ALL TO %I USING (true) WITH CHECK (true)', 'sale_lead_areas_all_' || r, r);
    END IF;
  END LOOP;
END $$;

-- ── 5. Lịch sử dữ liệu (cỗ máy thời gian + chặn Ban Điều Hành ghi) ─────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'dh_log_change') THEN
    EXECUTE 'DROP TRIGGER IF EXISTS dh_track ON sale_lead_areas';
    EXECUTE 'CREATE TRIGGER dh_track AFTER INSERT OR UPDATE OR DELETE ON sale_lead_areas FOR EACH ROW EXECUTE FUNCTION dh_log_change()';
  END IF;
END $$;

COMMENT ON TABLE sale_lead_areas IS 'Danh mục khu vực (ngoài KCN) cho Bảng nháp đầu mối — sale_leads.area_ids trỏ vào đây để lọc.';
COMMENT ON COLUMN sale_leads.area_ids IS 'Khu vực ngoài KCN đã chọn (sale_lead_areas.id).';
COMMENT ON COLUMN sale_leads.area_reviewed IS 'true = đã chọn lại khu vực bằng tay, không hiện chữ gốc chưa ghép nữa.';

NOTIFY pgrst, 'reload schema';

-- ── Kiểm tra sau khi chạy (mong đợi: 8 khu vực + 2 cột mới) ────────────────
-- SELECT name FROM sale_lead_areas ORDER BY name;
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'sale_leads' AND column_name IN ('area_ids', 'area_reviewed');

-- ── Rollback (chạy tay nếu cần bỏ — mất các khu vực đã chọn thêm, KCN + chữ gốc vẫn còn) ──
-- ALTER TABLE sale_leads DROP COLUMN IF EXISTS area_reviewed;
-- ALTER TABLE sale_leads DROP COLUMN IF EXISTS area_ids;
-- DROP TABLE IF EXISTS sale_lead_areas;
