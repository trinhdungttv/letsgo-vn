-- Mốc "Ứng lương" trên Timeline KH (Tài chính): 1 ngày hoặc khoảng ngày, thêm được nhiều đợt.
-- Tất cả đều tuỳ chọn (NULL / mảng rỗng) nên không ảnh hưởng khách đã cấu hình. Chạy lại an toàn.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS advance_day INT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS advance_day_end INT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS extra_advance_days JSONB DEFAULT '[]'::jsonb;
