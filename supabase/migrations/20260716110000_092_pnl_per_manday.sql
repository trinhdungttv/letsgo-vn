-- Migration 092: Loại dự án "Khoán Theo Công" (per_manday) cho P&L Dự án.
-- Chi nhánh nhận: đơn giá (vnd/công) × tổng số công của tháng, trừ từ LN sau thuế;
-- LGV nhận phần còn lại (có thể âm nếu dự án lỗ — CN vẫn nhận đủ).
--
-- An toàn dữ liệu: chỉ THÊM cột mới có DEFAULT — không làm mất dữ liệu hiện có.
-- Rollback: DROP COLUMN manday_rate trên 2 bảng (sau khi không còn dự án per_manday).

-- Đơn giá khoán của từng dự án-tháng (override được theo tháng).
ALTER TABLE projects_pnl ADD COLUMN IF NOT EXISTS manday_rate NUMERIC NOT NULL DEFAULT 0;

-- Đơn giá khoán mặc định theo khách hàng (dùng khi tạo dự án tháng mới).
ALTER TABLE pnl_split_settings ADD COLUMN IF NOT EXISTS manday_rate NUMERIC NOT NULL DEFAULT 0;

-- Nếu projects_pnl.project_type có CHECK constraint cũ (chỉ shared/managed) thì nới ra.
ALTER TABLE projects_pnl DROP CONSTRAINT IF EXISTS projects_pnl_project_type_check;
ALTER TABLE projects_pnl
  ADD CONSTRAINT projects_pnl_project_type_check
  CHECK (project_type IN ('shared', 'managed', 'per_manday'));
