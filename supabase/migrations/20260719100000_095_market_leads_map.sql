-- 095: Toạ độ bản đồ cho công ty/dự án (market_leads)
-- Chỉ THÊM cột mới, không sửa/xoá dữ liệu hiện có.

ALTER TABLE market_leads ADD COLUMN IF NOT EXISTS map_link text;
ALTER TABLE market_leads ADD COLUMN IF NOT EXISTS lat double precision;
ALTER TABLE market_leads ADD COLUMN IF NOT EXISTS lng double precision;
ALTER TABLE market_leads ADD COLUMN IF NOT EXISTS geocoded_at timestamptz;
