-- ============================================================================
-- 197 — Người liên hệ CHUYỂN CÔNG TY (khách nghỉ công ty 1 sang làm công ty 2)
-- Chạy tay trong Supabase → SQL Editor. Chạy lại nhiều lần vẫn an toàn (idempotent).
--
-- Nút "Chuyển công ty" (hồ sơ CSKH, form đầy đủ, khối Người liên hệ của công ty) gỡ công ty cũ,
-- gắn công ty mới và ghi MỘT dòng contact_client_history (from → to). Migration này thêm vào
-- dòng lịch sử đó những gì cần để dựng "Quá trình công tác":
--   from_role        chức vụ ở công ty cũ (contacts.role chỉ giữ chức vụ HIỆN TẠI)
--   to_role          chức vụ ở công ty mới
--   from_started_on  làm ở công ty cũ từ ngày (chốt lúc chuyển)
--   effective_on     ngày chuyển = ngày rời công ty cũ / bắt đầu công ty mới
-- + chỉ mục theo from_client_id để hồ sơ công ty cũ hiện nhanh "Người liên hệ cũ — đã chuyển sang …".
--
-- Chưa chạy migration này app VẪN chuyển công ty được: chức vụ cũ / ngày bắt đầu ghi vào cột note
-- ("Chức vụ cũ: …; làm từ dd/mm/yyyy") và app tự đọc ra từ đó.
--
-- Ngày sinh không rõ năm (cùng đợt 04/11/2026) KHÔNG cần migration: contacts.birthday lưu năm giữ
-- chỗ 1604 (năm nhuận, quy ước "bỏ năm" của Danh bạ Apple) — mục 3 chỉ ghi chú thích cho cột.
--
-- Có mất / đổi dữ liệu hiện có không? KHÔNG — chỉ THÊM 4 cột (để trống với dòng cũ), 1 chỉ mục và
-- 1 dòng chú thích cột. Không xoá, không sửa dòng nào; không đụng data_history (bảng đã có trigger từ 142).
-- Cần chạy SAU migration 142.
-- ============================================================================

-- ── 1. Cột mới của lịch sử gắn / chuyển công ty ────────────────────────────
ALTER TABLE contact_client_history
  ADD COLUMN IF NOT EXISTS from_role       text,
  ADD COLUMN IF NOT EXISTS to_role         text,
  ADD COLUMN IF NOT EXISTS from_started_on date,
  ADD COLUMN IF NOT EXISTS effective_on    date;

-- ── 2. Hồ sơ công ty cũ: ai đã chuyển đi ───────────────────────────────────
CREATE INDEX IF NOT EXISTS contact_client_history_from_client_idx
  ON contact_client_history (from_client_id, changed_at DESC)
  WHERE from_client_id IS NOT NULL;

-- ── 3. Chú thích: ngày sinh không rõ năm ───────────────────────────────────
COMMENT ON COLUMN contacts.birthday IS
  'Ngày sinh của chính người liên hệ. Năm 1604 = KHÔNG RÕ NĂM (chỉ biết ngày + tháng) — app không hiện năm, không tính tuổi.';

-- PostgREST nạp lại danh sách cột ngay (khỏi đợi)
NOTIFY pgrst, 'reload schema';

-- ── Kiểm tra sau khi chạy (tuỳ chọn) ───────────────────────────────────────
-- SELECT column_name, data_type FROM information_schema.columns
--  WHERE table_name = 'contact_client_history' AND column_name IN ('from_role','to_role','from_started_on','effective_on');
--  → phải ra đủ 4 dòng.
