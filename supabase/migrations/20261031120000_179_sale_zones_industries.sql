-- ============================================================================
-- 179 — Mạng lưới Sale: "Khu vực / KCN mạnh" và "Ngành quen" CHỌN TỪ DANH MỤC có sẵn
-- ----------------------------------------------------------------------------
-- Trước (178) là ô gõ chữ tự do → cùng 1 KCN viết nhiều kiểu, không lọc được. Nay lưu MÃ:
--   contacts.sale_zone_ids      uuid[] → market_zones.id   (Thị trường → Khu vực / KCN)
--   contacts.sale_industry_ids  uuid[] → industries.id     (Thị trường → Ngành nghề)
-- Lưu mã (không lưu tên) nên đổi tên KCN / ngành ở Thị trường không làm lệch bộ lọc Sale.
-- KCN / ngành bị xoá khỏi danh mục → mã cũ tự bị bỏ qua khi hiển thị.
--
-- 2 cột chữ cũ sale_area / sale_industries (migration 178) KHÔNG còn dùng — chưa có Sale nào
-- nên đang trống; giữ nguyên, không xoá.
--
-- Có mất dữ liệu hiện có không? KHÔNG — chỉ ADD COLUMN (mặc định mảng rỗng). Chạy lại vẫn an toàn.
-- Phải chạy SAU 178.
-- ============================================================================
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS sale_zone_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS sale_industry_ids uuid[] NOT NULL DEFAULT '{}';

-- Lọc "Sale mạnh ở KCN X" / "quen ngành Y" nhanh
CREATE INDEX IF NOT EXISTS contacts_sale_zone_ids_idx ON contacts USING gin (sale_zone_ids);
CREATE INDEX IF NOT EXISTS contacts_sale_industry_ids_idx ON contacts USING gin (sale_industry_ids);

NOTIFY pgrst, 'reload schema';

-- ── ROLLBACK (mất lựa chọn KCN / ngành đã chọn cho Sale) ──
-- DROP INDEX IF EXISTS contacts_sale_zone_ids_idx;
-- DROP INDEX IF EXISTS contacts_sale_industry_ids_idx;
-- ALTER TABLE contacts DROP COLUMN IF EXISTS sale_zone_ids, DROP COLUMN IF EXISTS sale_industry_ids;
