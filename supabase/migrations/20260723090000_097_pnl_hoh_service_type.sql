-- Migration 097: Loại hình "HOH" (xuất hộ khách hàng, lấy phí) trong P&L Dự án — song song
-- với "Cho thuê lao động" và GTLD (migration 096). Một số khách hàng đang làm việc về
-- GTLD/Cho thuê lao động thỉnh thoảng phát sinh thêm HOH. Khác với GTLD, phần lợi nhuận
-- HOH mặc định 100% về Let's Go VN (không chia theo lg_pct/cn_pct thông thường của dự án),
-- có thể tuỳ chỉnh tỷ lệ riêng theo từng dự án-tháng.
--
-- An toàn dữ liệu: chỉ THÊM cột mới có DEFAULT / nới CHECK constraint — không làm mất dữ
-- liệu hiện có. Rollback: DROP COLUMN hoh_lg_pct, hoh_cn_pct trên projects_pnl; thu hẹp lại
-- CHECK constraint về ('leasing', 'recruitment') sau khi không còn dòng service_type='hoh' nào.

ALTER TABLE pnl_revenue_lines DROP CONSTRAINT IF EXISTS pnl_revenue_lines_service_type_check;
ALTER TABLE pnl_revenue_lines
  ADD CONSTRAINT pnl_revenue_lines_service_type_check
  CHECK (service_type IN ('leasing', 'recruitment', 'hoh'));

ALTER TABLE projects_pnl_costs DROP CONSTRAINT IF EXISTS projects_pnl_costs_service_type_check;
ALTER TABLE projects_pnl_costs
  ADD CONSTRAINT projects_pnl_costs_service_type_check
  CHECK (service_type IN ('leasing', 'recruitment', 'hoh'));

-- Tỷ lệ phân chia riêng cho phần lợi nhuận HOH của dự án-tháng (mặc định 100/0 = Let's Go VN hưởng hết).
ALTER TABLE projects_pnl ADD COLUMN IF NOT EXISTS hoh_lg_pct NUMERIC NOT NULL DEFAULT 100;
ALTER TABLE projects_pnl ADD COLUMN IF NOT EXISTS hoh_cn_pct NUMERIC NOT NULL DEFAULT 0;
