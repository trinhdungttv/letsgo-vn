-- Đặt quỹ tết 500đ/công từ 01/2026 cho MỌI khách "Cho thuê lại lao động" (cần đã chạy migration 149 + 150).
-- Chạy BƯỚC 1 để xem trước, rồi BƯỚC 2 để ghi.

-- BƯỚC 1 — xem trước: bao nhiêu khách, bao nhiêu dòng P&L sẽ đổi, bao nhiêu dòng đang có đơn giá KHÁC 500 (sẽ bị ghi đè)
SELECT
  (SELECT count(*) FROM clients WHERE COALESCE(service_type, 'leasing') = 'leasing') AS so_khach,
  count(*) AS so_dong_pnl_tu_2026_01,
  count(*) FILTER (WHERE p.tet_rate IS NULL) AS dang_trong,
  count(*) FILTER (WHERE p.tet_rate IS NOT NULL AND p.tet_rate <> 500) AS dang_khac_500_se_bi_ghi_de
FROM projects_pnl p
JOIN clients c ON c.id = p.client_id
WHERE COALESCE(c.service_type, 'leasing') = 'leasing' AND p.month >= '2026-01';

-- BƯỚC 2 — ghi
BEGIN;

-- 2a. Mốc đơn giá ở hồ sơ khách hàng (để các tháng tạo mới về sau tự theo)
INSERT INTO client_branch_cost_rules (client_id, kind, rate, effective_from)
SELECT id, 'tet', 500, '2026-01' FROM clients WHERE COALESCE(service_type, 'leasing') = 'leasing'
ON CONFLICT (client_id, kind, effective_from) DO UPDATE SET rate = EXCLUDED.rate;

-- 2b. Các tháng P&L đã có từ 01/2026 (dự án "nhận lương/managed" không bị trừ vì công thức bỏ qua loại này)
UPDATE projects_pnl p
SET tet_rate = 500, updated_at = now()
FROM clients c
WHERE c.id = p.client_id
  AND COALESCE(c.service_type, 'leasing') = 'leasing'
  AND p.month >= '2026-01'
  AND p.tet_rate IS DISTINCT FROM 500;

COMMIT;
