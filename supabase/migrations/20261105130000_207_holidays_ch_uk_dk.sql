-- 207: Thêm ngày lễ cố định cho Thụy Sĩ, Anh Quốc, Đan Mạch vào national_holidays (migration 185).
-- Chạy lại nhiều lần được (bỏ qua ngày đã có theo quốc gia + tên). Lễ đổi ngày theo thứ / Phục sinh chưa hỗ trợ.
INSERT INTO national_holidays (country, title, local_name, day, month, is_lunar, tip)
SELECT v.country, v.title, v.local_name, v.day, v.month, v.is_lunar, v.tip
FROM (VALUES
  ('Thụy Sĩ', 'Năm mới', 'Neujahr / Nouvel An', 1, 1, false, 'Gửi lời chúc năm mới. Thụy Sĩ nhiều ngôn ngữ (Đức/Pháp/Ý) — chúc bằng tiếng Anh là an toàn.'),
  ('Thụy Sĩ', 'Quốc khánh', 'Bundesfeier / Fête nationale', 1, 8, false, 'Ngày lễ lớn nhất của Thụy Sĩ, có pháo hoa. Chúc mừng trang trọng, ngắn gọn.'),
  ('Thụy Sĩ', 'Giáng sinh', 'Weihnachten / Noël', 25, 12, false, 'Gửi thiệp / quà cuối năm trước 20/12.'),
  ('Thụy Sĩ', 'Ngày Thánh Stephen', 'Stephanstag', 26, 12, false, 'Nghỉ theo từng bang, thường nối liền Giáng sinh — chốt việc trước 23/12.'),
  ('Anh Quốc', 'Năm mới', 'New Year''s Day', 1, 1, false, 'Gửi lời chúc năm mới.'),
  ('Anh Quốc', 'Giáng sinh', 'Christmas Day', 25, 12, false, 'Gửi thiệp / quà cuối năm trước 20/12.'),
  ('Anh Quốc', 'Boxing Day', 'Boxing Day', 26, 12, false, 'Nghỉ nối liền Giáng sinh — chốt việc trước 23/12.'),
  ('Đan Mạch', 'Năm mới', 'Nytårsdag', 1, 1, false, 'Gửi lời chúc năm mới.'),
  ('Đan Mạch', 'Ngày Hiến pháp', 'Grundlovsdag', 5, 6, false, 'Nhiều công ty cho nghỉ cả/nửa ngày. Chúc mừng ngắn gọn.'),
  ('Đan Mạch', 'Đêm Giáng sinh', 'Juleaften', 24, 12, false, 'Dịp quan trọng nhất năm với người Đan Mạch. Gửi thiệp / quà trước 20/12.'),
  ('Đan Mạch', 'Giáng sinh', 'Juledag', 25, 12, false, 'Nghỉ nối liền 24 – 26/12.'),
  ('Đan Mạch', 'Ngày Giáng sinh thứ hai', 'Anden juledag', 26, 12, false, 'Nghỉ nối liền Giáng sinh.')
) AS v(country, title, local_name, day, month, is_lunar, tip)
WHERE NOT EXISTS (
  SELECT 1 FROM national_holidays h
  WHERE lower(btrim(h.country)) = lower(v.country) AND lower(btrim(h.title)) = lower(v.title)
);
