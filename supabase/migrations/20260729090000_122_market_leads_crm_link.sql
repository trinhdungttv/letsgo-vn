-- Liên kết market_leads <-> crm_pipeline: 1 công ty tạo ở đâu (Workspace, CRM Pipeline, hay
-- Thị trường > Công ty/Dự án) cũng chỉ là 1 dữ liệu gốc, không phải 3 bản copy rời rạc.
-- Cùng mẫu với crm_pipeline.client_id (liên kết optional, không ràng buộc cứng 2 chiều).
alter table market_leads add column if not exists crm_id uuid references crm_pipeline(id) on delete set null;
create index if not exists idx_market_leads_crm_id on market_leads(crm_id);
