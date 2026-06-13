-- Hợp đồng / phụ lục / tài liệu đính kèm của khách hàng
CREATE TABLE IF NOT EXISTS client_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_path TEXT NOT NULL,
  doc_type TEXT NOT NULL DEFAULT 'other' CHECK (doc_type IN ('contract', 'appendix', 'other')),
  uploaded_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_client_documents_client ON client_documents(client_id);

ALTER TABLE client_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "client_documents_all_anon" ON client_documents FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "client_documents_all_auth" ON client_documents FOR ALL TO authenticated USING (true) WITH CHECK (true);

INSERT INTO storage.buckets (id, name, public)
VALUES ('documents', 'documents', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "documents_select_anon" ON storage.objects FOR SELECT TO anon USING (bucket_id = 'documents');
CREATE POLICY "documents_select_auth" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'documents');
CREATE POLICY "documents_insert_anon" ON storage.objects FOR INSERT TO anon WITH CHECK (bucket_id = 'documents');
CREATE POLICY "documents_insert_auth" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'documents');
CREATE POLICY "documents_update_anon" ON storage.objects FOR UPDATE TO anon USING (bucket_id = 'documents');
CREATE POLICY "documents_update_auth" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'documents');
CREATE POLICY "documents_delete_anon" ON storage.objects FOR DELETE TO anon USING (bucket_id = 'documents');
CREATE POLICY "documents_delete_auth" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'documents');
