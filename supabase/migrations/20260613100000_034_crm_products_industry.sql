-- "Sản phẩm" trong CRM nay dùng để báo giá theo khu vực + ngành nghề cho từng loại dịch vụ.
-- Thêm cột industry để lưu ngành nghề báo giá riêng theo khu vực (cột `name` được dùng làm "Khu vực báo giá").
ALTER TABLE crm_products ADD COLUMN IF NOT EXISTS industry text;
