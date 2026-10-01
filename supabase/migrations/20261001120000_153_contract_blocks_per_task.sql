-- Bảng / khối nội dung Hợp đồng-Phụ lục thuộc về TỪNG VIỆC (work_tasks) thay vì cả khách hàng,
-- để hiện gộp trong dòng việc và đóng/mở cùng dòng đó.
ALTER TABLE client_contract_tables ADD COLUMN IF NOT EXISTS task_id UUID REFERENCES work_tasks(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_client_contract_tables_task ON client_contract_tables(task_id);

-- Các khối đã tạo trước đó (chưa gắn việc): gắn vào việc Hợp đồng/Phụ lục mới nhất còn hiệu lực của cùng khách hàng.
UPDATE client_contract_tables b
SET task_id = t.id
FROM (
  SELECT DISTINCT ON (client_id) client_id, id
  FROM work_tasks
  WHERE task_type IN ('Hợp đồng', 'Phụ lục') AND deleted_at IS NULL AND client_id IS NOT NULL
  ORDER BY client_id, created_at DESC
) t
WHERE b.task_id IS NULL AND b.client_id = t.client_id;
