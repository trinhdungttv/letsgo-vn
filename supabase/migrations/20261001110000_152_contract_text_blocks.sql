-- Khối văn bản (rich text) cạnh bảng so sánh Hợp đồng / Phụ lục: dùng chung bảng client_contract_tables.
-- kind='table' → dùng columns/rows như cũ; kind='text' → nội dung HTML (đã lọc) ở cột html.
ALTER TABLE client_contract_tables ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'table';
ALTER TABLE client_contract_tables ADD COLUMN IF NOT EXISTS html TEXT NOT NULL DEFAULT '';
