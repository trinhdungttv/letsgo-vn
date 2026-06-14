-- Liên kết crm_pipeline với clients để dùng chung 1 "gốc" dữ liệu
-- (lịch sử trao đổi, quà tặng, task, sở thích...) cho cả CSKH Radar,
-- CRM Pipeline BD và trang Khách hàng.
ALTER TABLE crm_pipeline ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id);
CREATE INDEX IF NOT EXISTS idx_crm_pipeline_client_id ON crm_pipeline(client_id);
