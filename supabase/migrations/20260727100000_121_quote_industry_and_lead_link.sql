-- Thêm Ngành nghề vào báo giá (đồng bộ với bộ lọc Ngành đã thêm ở form Báo giá) + liên kết
-- báo giá đã "Thắng" với Dự án được tạo ra từ nó, để nút "Chuyển thành Dự án" không tạo
-- trùng khi bấm lại lần 2 trên cùng 1 báo giá.
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS industry TEXT;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS converted_lead_id UUID REFERENCES market_leads(id) ON DELETE SET NULL;
