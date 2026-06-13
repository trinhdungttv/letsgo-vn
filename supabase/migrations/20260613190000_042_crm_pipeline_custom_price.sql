-- BD Pipeline: cho phép nhập giá tuỳ chỉnh cho sản phẩm/dịch vụ quan tâm
-- (có thể cao hơn hoặc thấp hơn giá chuẩn đã cài sẵn trong Sản phẩm/Dịch vụ)
ALTER TABLE crm_pipeline ADD COLUMN IF NOT EXISTS custom_price NUMERIC;
