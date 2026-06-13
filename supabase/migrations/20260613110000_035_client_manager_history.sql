-- Lịch sử bàn giao quản lý khách hàng theo tháng (dùng cho timeline + báo cáo hiệu suất theo Quản lý)
CREATE TABLE client_manager_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  manager_name TEXT NOT NULL,
  effective_from TEXT NOT NULL, -- "YYYY-MM", tháng bắt đầu quản lý
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_client_manager_history_client ON client_manager_history(client_id);

ALTER TABLE client_manager_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cmh_all_anon" ON client_manager_history FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "cmh_all_auth" ON client_manager_history FOR ALL TO authenticated USING (true) WITH CHECK (true);
