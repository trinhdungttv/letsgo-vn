-- Nguồn của công ty trong CRM Pipeline: ai/đâu mang dự án về.
--   source_type      'sale' | 'partner' | 'company' | 'branch'
--   source_name      tên sale hoặc tên đối tác giới thiệu (gõ tự do, có gợi ý)
--   source_branch_id chi nhánh mang về (khi source_type = 'branch') — hiển thị branches.name
-- Không lấy từ danh sách Khách hàng. Dùng để hiển thị trên thẻ kanban và lọc theo người giới thiệu.
ALTER TABLE crm_pipeline ADD COLUMN IF NOT EXISTS source_type text;
ALTER TABLE crm_pipeline ADD COLUMN IF NOT EXISTS source_name text;
ALTER TABLE crm_pipeline ADD COLUMN IF NOT EXISTS source_branch_id uuid REFERENCES branches(id) ON DELETE SET NULL;

DO $$ BEGIN
  ALTER TABLE crm_pipeline ADD CONSTRAINT crm_pipeline_source_type_check
    CHECK (source_type IS NULL OR source_type IN ('sale', 'partner', 'company', 'branch'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS crm_pipeline_source_idx ON crm_pipeline (source_type, lower(source_name));
