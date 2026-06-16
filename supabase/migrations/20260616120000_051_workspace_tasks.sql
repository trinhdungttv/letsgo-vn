-- Việc đang treo (Workspace > cột "Việc đang treo")
CREATE TABLE IF NOT EXISTS workspace_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  type text NOT NULL DEFAULT 'task',            -- 'doc' | 'task'
  status text NOT NULL DEFAULT 'not_started',   -- drafting | pending_approval | pending_sign | done | not_started | overdue
  assignee text,
  deadline date,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE workspace_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all" ON workspace_tasks USING (true) WITH CHECK (true);
