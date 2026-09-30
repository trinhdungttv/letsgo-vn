-- Hai khoản chi phí RIÊNG của chi nhánh ở dự án khoán, trừ thẳng vào phần lợi nhuận của Chi nhánh:
--   quỹ tết = số công × tet_rate (mặc định 500đ/công), hoa hồng KH = số công × commission_rate.
-- NULL = chưa áp dụng (các dòng P&L cũ giữ nguyên số liệu, không bị trừ ngược về quá khứ).
ALTER TABLE projects_pnl ADD COLUMN IF NOT EXISTS tet_rate NUMERIC;
ALTER TABLE projects_pnl ADD COLUMN IF NOT EXISTS commission_rate NUMERIC;
