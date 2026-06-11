-- DỮ LIỆU MẪU — 8 KHÁCH HÀNG
INSERT INTO clients (name, region, manager, cutoff_day, payment_start, payment_end, next_month_pay, contract_start, contract_end, notes, status, paid_this_month, prog_cutoff, prog_calc, prog_paid)
VALUES
  ('Changshin VN',       'Biên Hòa',   'Ms. Lan',   25, 5,  8,  TRUE,  '2024-08-15', '2026-08-15', 'KH lớn, ưu tiên cao',   'warn',   FALSE, TRUE,  TRUE,  FALSE),
  ('TTP Vinawood',       'Biên Hòa',   'Ms. Trang', 20, 26, 30, FALSE, '2025-01-01', '2027-01-01', '',                      'ok',     TRUE,  TRUE,  TRUE,  TRUE),
  ('CP Việt Hưng',       'Bình Dương', 'Mr. Hùng',  25, 3,  6,  TRUE,  '2024-06-15', '2026-06-15', 'Gia hạn gấp',           'danger', FALSE, TRUE,  FALSE, FALSE),
  ('Hansae Vietnam',     'VSIP',       'Ms. Lan',   20, 24, 27, FALSE, '2025-03-01', '2027-03-01', '',                      'ok',     FALSE, TRUE,  TRUE,  TRUE),
  ('Taekwang Vina',      'Biên Hòa',   'Anh Minh',  22, 28, 31, FALSE, '2025-07-15', '2026-07-15', 'Tỷ lệ nghỉ việc cao',   'warn',   FALSE, TRUE,  TRUE,  FALSE),
  ('Korea Electronic VN','VSIP',       'Ms. Trang', 15, 21, 24, FALSE, '2024-06-09', '2026-06-09', 'HĐ hết hạn khẩn',       'danger', FALSE, TRUE,  FALSE, FALSE),
  ('Pou Chen Vietnam',   'Bình Dương', 'Mr. Hùng',  20, 26, 29, FALSE, '2025-06-01', '2027-06-01', 'KH lớn nhất',           'ok',     FALSE, TRUE,  TRUE,  FALSE),
  ('TNHH Minh Trang',    'Biên Hòa',   'Anh Minh',  28, 5,  8,  TRUE,  '2025-04-01', '2027-04-01', '',                      'ok',     TRUE,  TRUE,  TRUE,  TRUE);
