-- Cài đặt mặc định cho dự án xuất hoá đơn nhiều kỳ trong tháng (vd SUNDUCK: 3 kỳ/tháng).
-- Lưu theo client_id (không theo tháng) để nhớ thiết lập cho các tháng sau, khỏi gõ lại.

create table if not exists pnl_invoice_settings (
  client_id uuid primary key references clients(id) on delete cascade,
  period_count int not null default 3,
  period_labels text[] not null default array['Kỳ 1', 'Kỳ 2', 'Kỳ 3', 'Kỳ 4'],
  invoice_label_template text not null default 'Hoa don',
  invoice_days int[] not null default array[10, 20, 30, 31],
  updated_at timestamptz not null default now()
);
