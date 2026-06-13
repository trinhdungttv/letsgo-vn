-- BD Pipeline: liên kết người liên hệ (CSKH) và sản phẩm/dịch vụ quan tâm
ALTER TABLE crm_pipeline ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL;
ALTER TABLE crm_pipeline ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES crm_products(id) ON DELETE SET NULL;
