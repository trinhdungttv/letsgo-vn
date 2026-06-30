-- Số công riêng cho từng hoá đơn/kỳ trong "Doanh thu chi tiết".
-- Tổng số công của dự án (projects_pnl.total_man_days) sẽ là tổng các dòng này khi dự án có hoá đơn chi tiết.
alter table pnl_revenue_lines
  add column if not exists man_days numeric not null default 0;
