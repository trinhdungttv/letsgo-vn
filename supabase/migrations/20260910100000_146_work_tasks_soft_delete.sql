-- ─────────────────────────────────────────────────────────────────────────────
-- 146 — Việc của tôi (work_tasks): xoá mềm + hiện sang hồ sơ Khách hàng / Chi nhánh
--
-- Bối cảnh:
--   Mỗi việc trong "Việc của tôi" đã gắn sẵn client_id + branch_id, nhưng chỉ hiện
--   trong Workspace. Hồ sơ Khách hàng và hồ sơ Chi nhánh không thấy việc nào — nên
--   lịch sử làm việc với một khách hàng bị đứt đoạn giữa 3 nơi. Từ nay hai hồ sơ đó
--   đọc THẲNG work_tasks (cùng một bản ghi, không nhân bản dữ liệu).
--
-- Thay đổi:
--   1. Thêm deleted_at — xoá việc chuyển thành xoá mềm. Trước đây xoá cứng: bản ghi
--      biến mất hoàn toàn, lịch sử của khách hàng/chi nhánh thủng một đoạn không tra
--      lại được. Giữ nguyên status lúc xoá để biết việc bị bỏ khi đang dở hay đã xong.
--   2. Cập nhật ghi chú cột branch_id — quyết định cũ ở migration 137 ("việc cá nhân
--      KHÔNG hiện sang trang Chi Nhánh") đã đổi.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE work_tasks ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

COMMENT ON COLUMN work_tasks.deleted_at IS
  'Thời điểm xoá mềm. NULL = việc còn hiệu lực. Việc đã xoá vẫn hiện trong lịch sử của Khách hàng / Chi nhánh (có nhãn "đã xoá") nhưng không còn ở Workspace và không đồng bộ Google Calendar.';

COMMENT ON COLUMN work_tasks.branch_id IS
  'Chi nhánh của việc này (thay cho cột kcn cũ). Dùng để lọc trong Workspace VÀ để hiện việc trong khối "Công việc & trao đổi" ở hồ sơ Chi nhánh (từ migration 146).';
