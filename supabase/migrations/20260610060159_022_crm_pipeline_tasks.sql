
CREATE TABLE IF NOT EXISTS crm_pipeline_tasks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  crm_id      UUID NOT NULL REFERENCES crm_pipeline(id) ON DELETE CASCADE,
  company_name TEXT NOT NULL,
  title        TEXT NOT NULL,
  description  TEXT,
  due_date     DATE,
  status       TEXT NOT NULL DEFAULT 'pending',
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE crm_pipeline_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_pipeline_tasks" ON crm_pipeline_tasks FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_pipeline_tasks" ON crm_pipeline_tasks FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_pipeline_tasks" ON crm_pipeline_tasks FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_pipeline_tasks" ON crm_pipeline_tasks FOR DELETE TO anon, authenticated USING (true);
