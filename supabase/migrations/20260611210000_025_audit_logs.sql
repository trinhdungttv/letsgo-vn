-- Audit log table: tracks insert/update/delete activity across the system for the History page + admin Undo
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  user_name TEXT,
  action TEXT NOT NULL,
  table_name TEXT NOT NULL,
  record_id TEXT NOT NULL,
  description TEXT,
  old_data JSONB,
  new_data JSONB,
  undone BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at DESC);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_all_anon ON audit_logs FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY audit_all_auth ON audit_logs FOR ALL TO authenticated USING (true) WITH CHECK (true);
