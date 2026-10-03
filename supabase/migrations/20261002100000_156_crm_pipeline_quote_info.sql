-- Thông tin báo giá điền sẵn cho từng công ty trong CRM Pipeline (hồ sơ công ty → "Thông tin báo giá").
-- Lưu 1 JSON: { tax_code, address, contact_person, contact_phone, zone, industry, valid_until,
-- payment_terms, note, lines: [{ id, label, workers, wage, fee, unit, note }], updated_at }
-- để sau này đẩy thẳng sang file Báo giá tự động mà không phải nhập lại.
ALTER TABLE crm_pipeline ADD COLUMN IF NOT EXISTS quote_info jsonb;
