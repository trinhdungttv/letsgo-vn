-- ─────────────────────────────────────────────────────────────────────────────
-- 135 — Task nội bộ (chung): bình luận + liên kết Chi nhánh
--
-- Bối cảnh:
--   "Task nội bộ (chung)" và "Hồ sơ · HĐ (chung)" đang dùng chung 1 bảng
--   workspace_tasks + 1 bộ trạng thái kiểu hồ sơ pháp lý (Đang soạn/Chờ duyệt/
--   Chờ ký/...). Bộ trạng thái đó hợp cho Hồ sơ · HĐ nhưng không hợp cho 1 task
--   nội bộ thông thường — task nội bộ chỉ cần Cần làm/Đang làm/Đã xong.
--
--   Ngoài ra workspace_tasks chưa có bình luận (chỉ work_tasks — việc cá nhân —
--   có, qua work_task_comments) và chưa có cách gắn 1 task với 1 Chi nhánh.
--
-- Thay đổi:
--   1. Thêm workspace_tasks.branch_id — gắn task với 1 Chi nhánh cụ thể.
--   2. Bảng workspace_task_comments — bình luận cập nhật tiến độ, giống
--      work_task_comments đang dùng cho việc cá nhân.
--   3. Backfill: các Task nội bộ (type='task') đang mang trạng thái kiểu hồ sơ
--      cũ → quy về 3 mức mới (todo/in_progress/done). Hồ sơ · HĐ (type='doc')
--      KHÔNG đụng tới, vẫn giữ nguyên 6 trạng thái cũ.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE workspace_tasks ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES branches(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_workspace_tasks_branch ON workspace_tasks(branch_id);

COMMENT ON COLUMN workspace_tasks.branch_id IS
  'Chi nhánh mà Task nội bộ (chung) này thuộc về — chỉ dùng cho type=''task''. Khi đặt, task hiện thêm trong khối "Việc nội bộ liên kết" ở trang Chi nhánh (cùng đọc/ghi 1 bảng, không nhân bản dữ liệu).';

CREATE TABLE IF NOT EXISTS workspace_task_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES workspace_tasks(id) ON DELETE CASCADE,
  user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  user_name text NOT NULL,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_workspace_task_comments_task ON workspace_task_comments(task_id);

ALTER TABLE workspace_task_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "workspace_task_comments_all_anon" ON workspace_task_comments FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "workspace_task_comments_all_auth" ON workspace_task_comments FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Backfill trạng thái cũ -> bộ 3 mức mới, chỉ cho Task nội bộ (type='task').
UPDATE workspace_tasks SET status = 'todo'
  WHERE type = 'task' AND status IN ('not_started', 'drafting');
UPDATE workspace_tasks SET status = 'in_progress'
  WHERE type = 'task' AND status IN ('pending_approval', 'pending_sign', 'overdue');
-- status = 'done' giữ nguyên (khớp cả 2 bộ trạng thái).
