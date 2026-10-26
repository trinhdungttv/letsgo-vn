-- ============================================================================
-- 175 — CSKH: một dòng nhật ký có NHIỀU việc tiếp theo
-- ----------------------------------------------------------------------------
-- cskh_logs.followup_task_id vẫn là việc đầu tiên (giữ nguyên, đồng bộ Xong hai chiều).
-- Thêm cskh_logs.extra_task_ids: id các việc THÊM trong Workspace (work_tasks) tạo từ cùng
-- dòng nhật ký — để sửa / thêm / bỏ việc ngay trong "Sửa nhật ký".
--
-- Có mất dữ liệu hiện có không? KHÔNG — chỉ ADD COLUMN có DEFAULT '{}'.
-- Chạy lại nhiều lần vẫn an toàn. App chạy được khi chưa chạy migration này (việc thêm vẫn tạo
-- được trong Workspace, chỉ chưa sửa lại được từ nhật ký).
-- ============================================================================

ALTER TABLE cskh_logs
  ADD COLUMN IF NOT EXISTS extra_task_ids uuid[] NOT NULL DEFAULT '{}';

SELECT dh_attach_triggers();

-- ── ROLLBACK (mất liên kết việc thêm ↔ nhật ký; việc trong Workspace vẫn còn) ──
-- ALTER TABLE cskh_logs DROP COLUMN IF EXISTS extra_task_ids;
