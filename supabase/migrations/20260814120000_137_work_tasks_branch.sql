-- ─────────────────────────────────────────────────────────────────────────────
-- 137 — Việc của tôi: ô "KCN / Địa điểm" → "Chi Nhánh"
--
-- Bối cảnh:
--   Form "Việc của tôi" (work_tasks) có ô KCN / Địa điểm là text tự do, tự điền từ
--   clients.industrial_zones[0]. Ô này cần ánh xạ về CHI NHÁNH (bảng branches) —
--   một thực thể có thật trong hệ thống — thay vì tên KCN dạng chữ.
--
-- Thay đổi:
--   1. Thêm work_tasks.branch_id — khoá ngoại tới branches.
--   2. Backfill từ khách hàng của việc: clients.region khớp branches.region.
--      CHỈ backfill khi region đó ứng với ĐÚNG 1 chi nhánh — nhiều chi nhánh cùng
--      region thì bỏ qua, để trống còn hơn gán sai rồi phải đi dò lại.
--
--   KHÔNG xoá cột work_tasks.kcn: dữ liệu KCN của các việc cũ vẫn còn nguyên và
--   vẫn hiện trên giao diện, chỉ là không nhập KCN mới nữa. Xoá cột là thao tác
--   một chiều, mất dữ liệu lịch sử, nên không làm ở đây.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE work_tasks ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES branches(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_work_tasks_branch ON work_tasks(branch_id);

COMMENT ON COLUMN work_tasks.branch_id IS
  'Chi nhánh của việc này (thay cho cột kcn cũ). Chỉ dùng để lọc/hiển thị trong Workspace — việc cá nhân KHÔNG hiện sang trang Chi Nhánh.';

-- Backfill best-effort: chỉ nhận region ứng với đúng 1 chi nhánh.
UPDATE work_tasks wt
SET branch_id = sub.branch_id
FROM (
  SELECT c.id AS client_id, (array_agg(b.id))[1] AS branch_id
  FROM clients c
  JOIN branches b ON b.region = c.region
  WHERE c.region IS NOT NULL
  GROUP BY c.id
  HAVING COUNT(b.id) = 1
) AS sub
WHERE wt.client_id = sub.client_id
  AND wt.branch_id IS NULL;
