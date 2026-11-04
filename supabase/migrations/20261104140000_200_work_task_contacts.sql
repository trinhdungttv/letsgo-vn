-- ============================================================================
-- 200 — Việc của tôi (work_tasks): GẮN NGƯỜI LIÊN HỆ vào công việc
-- Chạy tay trong Supabase → SQL Editor. Chạy lại nhiều lần vẫn an toàn (idempotent).
--
--   work_tasks.contact_ids   uuid[] — các người liên hệ (contacts.id) bên khách liên quan tới việc
--                            (VD việc "Hoàn tất thủ tục HSNL" nhận từ chị HR của Coherent). Chọn nhiều người.
--                            Hồ sơ người liên hệ ở CSKH đọc ngược lại: work_tasks có contact_ids chứa id người đó.
--
-- Có mất / đổi dữ liệu hiện có không? KHÔNG.
--   • Chỉ THÊM 1 cột, mặc định mảng rỗng '{}' cho mọi việc cũ (Postgres ghi mặc định hằng số không phải
--     viết lại bảng). Không sửa, không xoá dòng nào.
--   • Cột task_type GIỮ NGUYÊN mọi giá trị cũ (Tái ký HĐ, Thăm quan, Văn phòng…): app tự gộp lúc hiển thị
--     thành 5 nhóm (Hợp đồng / Báo giá / Gặp khách / Xử lý phát sinh / Nội bộ / Khác) — xem
--     src/lib/workTaskTypes.ts. Migration này KHÔNG đổi giá trị task_type nào.
--   • Không có khoá ngoại sang contacts (bài học PGRST201: mọi embed contacts(...) đang có sẽ không bị mập mờ;
--     xoá / gộp người liên hệ cũng không kéo theo xoá việc).
--
-- Chưa chạy migration này: Workspace vẫn thêm việc bình thường, chỉ phần người liên hệ không lưu được
-- (app báo "cần migration 200"); khối "Công việc đã trao đổi" trong hồ sơ người liên hệ báo cần chạy.
-- Không tạo bảng mới nên không cần gắn thêm trigger dh_track; trigger lịch sử nào đang gắn trên work_tasks
-- vẫn chạy như cũ (nó lưu cả dòng, tự có cột mới).
-- ============================================================================

ALTER TABLE work_tasks ADD COLUMN IF NOT EXISTS contact_ids uuid[] NOT NULL DEFAULT '{}';

-- Tìm nhanh "các việc có người X" (contact_ids @> ARRAY[X])
CREATE INDEX IF NOT EXISTS work_tasks_contact_ids_gin ON work_tasks USING gin (contact_ids);

COMMENT ON COLUMN work_tasks.contact_ids IS
  'Người liên hệ (contacts.id) bên khách liên quan tới việc — chọn nhiều người ở form Thêm công việc (Workspace). Không khoá ngoại. Hồ sơ người liên hệ CSKH đọc ngược bằng contact_ids @> ARRAY[id]. Migration 200.';

COMMENT ON COLUMN work_tasks.task_type IS
  'Loại việc. Từ 04/11/2026 form chỉ còn 5 nhóm: Hợp đồng (lưu đúng loại con ''Hợp đồng'' / ''Tái ký HĐ'' / ''Phụ lục'' vì các luồng riêng đọc thẳng giá trị này), Báo giá, Gặp khách, Xử lý phát sinh, Nội bộ / Khác. Giá trị cũ (Thăm quan, Hỏi thăm CN, Văn phòng, Khác) KHÔNG đổi — app gộp lúc đọc (src/lib/workTaskTypes.ts). CSKH / Sale = việc tự tạo từ nhật ký CSKH.';

-- Cho PostgREST thấy cột mới ngay (không phải đợi tự nạp lại)
NOTIFY pgrst, 'reload schema';
