-- 112: Mốc áp dụng cho lương tối thiểu vùng — khi tăng lương, cần nhớ ĐÚNG ngày mức mới
-- có hiệu lực (theo Nghị định), không phải ngày người dùng bấm Lưu trên app.
ALTER TABLE region_wages ADD COLUMN IF NOT EXISTS effective_date date NOT NULL DEFAULT current_date;
