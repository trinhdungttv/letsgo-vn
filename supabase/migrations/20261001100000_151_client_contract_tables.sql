-- Bảng so sánh Hợp đồng / Phụ lục theo khách hàng (hạng mục × các mốc HĐ-Phụ lục + cột chênh lệch).
-- columns: ["Năm 2025 (Phụ lục 01/...)", "Năm 2026 (Phụ lục ...)"]
-- rows:    [{ "label": "Lương cơ bản", "cells": ["5.307.200 VNĐ", "5.681.700 VNĐ"], "change": "Tăng 374.500 VNĐ" }]
CREATE TABLE IF NOT EXISTS client_contract_tables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Bảng thay đổi Hợp đồng / Phụ lục',
  columns JSONB NOT NULL DEFAULT '[]'::jsonb,
  rows JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_client_contract_tables_client ON client_contract_tables(client_id);

ALTER TABLE client_contract_tables ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "cct_all_anon" ON client_contract_tables FOR ALL TO anon USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "cct_all_auth" ON client_contract_tables FOR ALL TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
