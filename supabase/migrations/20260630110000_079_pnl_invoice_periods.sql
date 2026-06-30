-- Cho phép dự án xuất hoá đơn nhiều lần trong tháng (vd: chốt công 10 ngày/lần).
-- invoice_mode mặc định 'single' để không ảnh hưởng các dự án hiện có (chỉ xuất 1 hoá đơn/tháng).
-- period_label gắn vào từng dòng doanh thu/chi phí để nhóm hiển thị theo kỳ khi invoice_mode = 'periodic'.
-- Tổng doanh thu/chi phí vẫn là SUM tất cả các dòng như cũ — không đổi cách các module khác đọc dữ liệu.

alter table projects_pnl
  add column if not exists invoice_mode text not null default 'single'
  check (invoice_mode in ('single', 'periodic'));

alter table pnl_revenue_lines
  add column if not exists period_label text;

alter table projects_pnl_costs
  add column if not exists period_label text;
