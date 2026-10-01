-- Phụ lục trực thuộc Hợp đồng: work_tasks.parent_task_id trỏ tới việc Hợp đồng cha.
ALTER TABLE work_tasks ADD COLUMN IF NOT EXISTS parent_task_id UUID REFERENCES work_tasks(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_work_tasks_parent ON work_tasks(parent_task_id);
