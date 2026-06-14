CREATE TABLE IF NOT EXISTS work_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  task_type TEXT,
  due_date DATE NOT NULL DEFAULT CURRENT_DATE,
  priority TEXT NOT NULL DEFAULT 'medium', -- 'high' | 'medium' | 'low'
  kcn TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'done'
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_work_tasks_user_due ON work_tasks(user_id, due_date);
CREATE INDEX IF NOT EXISTS idx_work_tasks_client ON work_tasks(client_id);

ALTER TABLE work_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "work_tasks_all_anon" ON work_tasks FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "work_tasks_all_auth" ON work_tasks FOR ALL TO authenticated USING (true) WITH CHECK (true);
