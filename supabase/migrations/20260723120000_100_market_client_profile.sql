-- 100: Hồ sơ thị trường cho Khách hàng đang hợp tác + dữ liệu lương khi khảo sát Công ty/Dự án.
-- Chỉ THÊM cột mới, không đụng dữ liệu khác.

-- Khách hàng đang hợp tác: cho phép gắn ngành nghề + theo dõi lấp đầy NCC (giống Công ty/Dự án)
-- + lương cơ bản/phụ cấp thu thập được khi khảo sát, để tổng hợp qua tab Lương TT.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS industry text;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS market_workers_needed integer;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS market_suppliers jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS wage_min numeric;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS wage_max numeric;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS allowance_notes text;

-- Công ty/Dự án đang tìm hiểu: lương cơ bản + phụ cấp thu thập được lúc khảo sát thực địa.
ALTER TABLE market_leads ADD COLUMN IF NOT EXISTS wage_min numeric;
ALTER TABLE market_leads ADD COLUMN IF NOT EXISTS wage_max numeric;
ALTER TABLE market_leads ADD COLUMN IF NOT EXISTS allowance_notes text;
