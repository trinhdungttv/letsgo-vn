-- 231: Cờ "Quan trọng" cho việc ở Workspace (dùng cho Ma trận Eisenhower).
-- Thêm cột is_flagged vào 3 nguồn việc của "Việc của tôi". Không xoá / không đổi dữ liệu cũ
-- (mặc định false). Chạy lại nhiều lần vẫn an toàn.
ALTER TABLE work_tasks          ADD COLUMN IF NOT EXISTS is_flagged boolean NOT NULL DEFAULT false;
ALTER TABLE workspace_tasks     ADD COLUMN IF NOT EXISTS is_flagged boolean NOT NULL DEFAULT false;
ALTER TABLE crm_pipeline_tasks  ADD COLUMN IF NOT EXISTS is_flagged boolean NOT NULL DEFAULT false;
