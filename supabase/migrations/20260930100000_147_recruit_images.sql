-- Ảnh tuyển dụng (dán link) của công ty/dự án — hiện ở CRM và Thị trường
ALTER TABLE market_leads ADD COLUMN IF NOT EXISTS recruit_image_urls text[] NOT NULL DEFAULT '{}';
ALTER TABLE clients      ADD COLUMN IF NOT EXISTS recruit_image_urls text[] NOT NULL DEFAULT '{}';
