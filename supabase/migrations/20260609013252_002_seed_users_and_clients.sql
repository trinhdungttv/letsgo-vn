-- Seed app_users
INSERT INTO app_users (username, password, full_name, role) VALUES
  ('admin', 'admin', 'Quản trị viên', 'admin'),
  ('ketoan', 'ketoan', 'Kế Toán', 'ketoan'),
  ('kinhdoanh', 'kd123', 'Kinh Doanh BD', 'kinhdoanh'),
  ('bdh', 'bdh123', 'Ban Điều Hành', 'bdh')
ON CONFLICT (username) DO NOTHING;

-- Seed clients
INSERT INTO clients (name, region, manager, cutoff_day, payment_start, payment_end, next_month_pay, contract_start, contract_end, status, paid_this_month, prog_cutoff, prog_calc, prog_paid) VALUES
  ('Changshin VN', 'Biên Hòa', 'Ms. Lan', 25, 1, 5, true, '2024-08-15', '2026-08-15', 'warn', false, true, true, false),
  ('TTP Vinawood', 'Biên Hòa', 'Ms. Trang', 20, 26, 30, false, '2024-01-01', '2027-01-01', 'ok', true, true, true, true),
  ('CP Việt Hưng', 'Bình Dương', 'Mr. Hùng', 25, 3, 6, true, '2023-06-15', '2026-06-15', 'danger', false, false, false, false),
  ('Hansae Vietnam', 'VSIP', 'Ms. Lan', 20, 24, 27, false, '2025-03-01', '2027-03-01', 'ok', true, true, true, true),
  ('Taekwang Vina', 'Biên Hòa', 'Anh Minh', 22, 28, 31, false, '2024-07-15', '2026-07-15', 'warn', false, true, false, false),
  ('Korea Electronic VN', 'VSIP', 'Ms. Trang', 15, 21, 24, false, '2024-06-09', '2026-06-09', 'danger', false, true, true, false),
  ('Pou Chen Vietnam', 'Bình Dương', 'Mr. Hùng', 20, 26, 29, false, '2024-06-01', '2027-06-01', 'ok', true, true, true, true),
  ('TNHH Minh Trang', 'Biên Hòa', 'Anh Minh', 28, 5, 8, true, '2025-04-01', '2027-04-01', 'ok', true, true, true, true)
ON CONFLICT DO NOTHING;
