-- Lich su chuyen chi nhanh cua khach hang / du an.
-- Khi KH duoc chuyen sang chi nhanh moi, ghi 1 dong voi effective_from = thang bat dau.
-- P&L se tra bang nay de gan dung chi nhanh theo thoi diem.
-- Chay thu cong trong Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS client_branch_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  branch_name TEXT NOT NULL,
  effective_from TEXT NOT NULL,  -- 'YYYY-MM', thang bat dau hieu luc
  notes TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_branch_history_client ON client_branch_history(client_id);

ALTER TABLE client_branch_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cbh_select_anon" ON client_branch_history FOR SELECT TO anon USING (true);
CREATE POLICY "cbh_select_auth" ON client_branch_history FOR SELECT TO authenticated USING (true);
CREATE POLICY "cbh_insert_anon" ON client_branch_history FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "cbh_insert_auth" ON client_branch_history FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "cbh_delete_anon" ON client_branch_history FOR DELETE TO anon USING (true);
CREATE POLICY "cbh_delete_auth" ON client_branch_history FOR DELETE TO authenticated USING (true);
