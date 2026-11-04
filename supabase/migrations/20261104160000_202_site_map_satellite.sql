-- ============================================================================
-- 202 — Mặt bằng khách hàng: VẼ TRỰC TIẾP TRÊN BẢN ĐỒ VỆ TINH
-- Chạy tay trong Supabase → SQL Editor. Chạy lại nhiều lần vẫn an toàn (idempotent).
--
-- Tab "Mặt bằng" của hồ sơ Khách hàng trước chỉ có ảnh tải lên (migration 199). Nay thêm loại thứ 2:
-- bản đồ vệ tinh mở ở đúng vị trí nhà máy đã ghim, tự khoanh từng khối nhà xưởng + ghi tên / công năng, xoay hướng cho thẳng.
--
-- Thêm 2 cột vào client_site_maps:
--   kind  'image' (ảnh tải lên — mặc định, mọi dòng cũ) | 'map' (bản đồ vệ tinh)
--   geo   jsonb, chỉ dùng khi kind = 'map':
--           { v: 1, center: {lat,lng}, zoom, bearing (độ xoay, 0 = Bắc ở trên), origin?: {lat,lng} (ghim nhà máy lúc tạo),
--             zones: [{ id, label, note, color, size?, pts: [{lat,lng}, …] }] }   pts: ≥ 3 điểm = khối nhà, 1 điểm = nhãn rời
--
-- Dòng bản đồ vệ tinh để image_url = '' (cột cũ NOT NULL nên điền chuỗi rỗng) — không có file ảnh nào cần lưu.
--
-- Chưa chạy migration này: tab Mặt bằng vẫn mở bình thường với ảnh tải lên; chỉ nút "Bản đồ vệ tinh" báo cần chạy 202.
--
-- Có mất / đổi dữ liệu hiện có không? KHÔNG — chỉ THÊM 2 cột có giá trị mặc định. Không sửa / xoá dòng nào.
-- ============================================================================

ALTER TABLE client_site_maps ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'image';
ALTER TABLE client_site_maps ADD COLUMN IF NOT EXISTS geo  jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'client_site_maps_kind_chk') THEN
    ALTER TABLE client_site_maps ADD CONSTRAINT client_site_maps_kind_chk CHECK (kind IN ('image', 'map'));
  END IF;
END $$;

COMMENT ON COLUMN client_site_maps.kind IS 'image = ảnh tải lên (zones toạ độ 0..1) · map = bản đồ vệ tinh (geo).';
COMMENT ON COLUMN client_site_maps.geo  IS 'Bản đồ vệ tinh: tâm, mức phóng, góc xoay, ghim gốc + khối nhà / nhãn theo toạ độ lat,lng.';

-- PostgREST nạp lại danh sách cột ngay (khỏi đợi)
NOTIFY pgrst, 'reload schema';

-- ── Kiểm tra sau khi chạy (mong đợi: 2 dòng kind + geo) ────────────────────
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name = 'client_site_maps' AND column_name IN ('kind', 'geo');

-- ── Rollback (chạy tay nếu cần bỏ — MẤT các bản đồ vệ tinh đã vẽ; ảnh tải lên không ảnh hưởng) ──
-- DELETE FROM client_site_maps WHERE kind = 'map';   -- (hoặc giữ lại, chỉ bỏ cột)
-- ALTER TABLE client_site_maps DROP CONSTRAINT IF EXISTS client_site_maps_kind_chk;
-- ALTER TABLE client_site_maps DROP COLUMN IF EXISTS geo;
-- ALTER TABLE client_site_maps DROP COLUMN IF EXISTS kind;
