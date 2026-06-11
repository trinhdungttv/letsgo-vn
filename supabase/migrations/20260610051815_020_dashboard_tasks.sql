
CREATE TABLE IF NOT EXISTS dashboard_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  client_name TEXT NOT NULL,
  client_region TEXT,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  source_status TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE dashboard_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dashboard_tasks_anon_all" ON dashboard_tasks FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "dashboard_tasks_auth_all" ON dashboard_tasks FOR ALL TO authenticated USING (true) WITH CHECK (true);
