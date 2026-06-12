-- Quà tặng khách hàng (gifts log per client, shown in "Chi tiết thương vụ" tab)
CREATE TABLE IF NOT EXISTS client_gifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  item_name TEXT NOT NULL,
  value NUMERIC,
  gift_date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,
  recipient_name TEXT,
  recipient_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_gifts_client_id ON client_gifts(client_id);

ALTER TABLE client_gifts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "client_gifts_all_anon" ON client_gifts FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "client_gifts_all_auth" ON client_gifts FOR ALL TO authenticated USING (true) WITH CHECK (true);
