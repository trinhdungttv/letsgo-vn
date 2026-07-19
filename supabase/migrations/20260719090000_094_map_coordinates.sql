-- 094: Toạ độ bản đồ cho Chi nhánh, KCN (market_zones) và Khách hàng (clients)
-- Chỉ THÊM cột mới, không sửa/xoá dữ liệu hiện có.

-- Chi nhánh: đã có map_link, thêm lat/lng + mốc geocode
ALTER TABLE branches ADD COLUMN IF NOT EXISTS lat double precision;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS lng double precision;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS geocoded_at timestamptz;

-- Khu công nghiệp
ALTER TABLE market_zones ADD COLUMN IF NOT EXISTS map_link text;
ALTER TABLE market_zones ADD COLUMN IF NOT EXISTS lat double precision;
ALTER TABLE market_zones ADD COLUMN IF NOT EXISTS lng double precision;
ALTER TABLE market_zones ADD COLUMN IF NOT EXISTS geocoded_at timestamptz;

-- Khách hàng
ALTER TABLE clients ADD COLUMN IF NOT EXISTS map_link text;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS lat double precision;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS lng double precision;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS geocoded_at timestamptz;
