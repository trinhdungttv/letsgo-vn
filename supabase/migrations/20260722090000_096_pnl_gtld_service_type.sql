-- Migration 096: Loại hình "Giới thiệu Lao động" (GTLD) song song với "Cho thuê lao động"
-- trong P&L Dự án. Một số dự án vừa cho thuê lao động vừa làm thêm GTLD — cho phép gắn
-- nhãn dòng doanh thu / chi phí thuộc GTLD để tách riêng theo dõi, trong khi vẫn cộng
-- chung vào tổng doanh thu/chi phí của dự án như bình thường (calcPnl không đổi).
--
-- An toàn dữ liệu: chỉ THÊM cột mới có DEFAULT 'leasing' — không làm mất dữ liệu hiện có,
-- các dòng cũ tự động coi là 'leasing' (Cho thuê lao động).
-- Rollback: DROP COLUMN service_type trên 2 bảng (sau khi không còn dòng GTLD nào).

ALTER TABLE pnl_revenue_lines ADD COLUMN IF NOT EXISTS service_type TEXT NOT NULL DEFAULT 'leasing';
ALTER TABLE pnl_revenue_lines DROP CONSTRAINT IF EXISTS pnl_revenue_lines_service_type_check;
ALTER TABLE pnl_revenue_lines
  ADD CONSTRAINT pnl_revenue_lines_service_type_check
  CHECK (service_type IN ('leasing', 'recruitment'));

ALTER TABLE projects_pnl_costs ADD COLUMN IF NOT EXISTS service_type TEXT NOT NULL DEFAULT 'leasing';
ALTER TABLE projects_pnl_costs DROP CONSTRAINT IF EXISTS projects_pnl_costs_service_type_check;
ALTER TABLE projects_pnl_costs
  ADD CONSTRAINT projects_pnl_costs_service_type_check
  CHECK (service_type IN ('leasing', 'recruitment'));
