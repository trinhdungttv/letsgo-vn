-- ============================================================================
-- 214 — NGUỒN LAO ĐỘNG: đối thủ đã làm với trường + nhãn đánh giá + hẹn liên hệ lại
-- Chạy tay trong Supabase → SQL Editor. Chạy lại nhiều lần vẫn an toàn (idempotent). Cần chạy SAU 213.
--
--   labor_sources.competitor_ids      đối thủ (Thị trường → Đối thủ, competitors.id) đã làm việc / đang lấy SV
--                                     của trường này → tránh mất thời gian kết nối.
--   labor_sources.competitor_note     ghi chú: đối thủ làm từ khi nào, độc quyền không, còn chen vào được không…
--   labor_sources.pursuit             nhãn đánh giá: 'uu_tien' (Ưu tiên triển khai) | 'lien_he_sau' (Để liên hệ sau) | '' (chưa đánh giá)
--   labor_sources.recontact_at        ngày hẹn liên hệ lại (với nhãn "Để liên hệ sau") — tới ngày app tự tạo việc trong Workspace
--   labor_sources.recontact_task_for  ngày hẹn đã tạo việc (chống tạo trùng)
--
-- Có mất / đổi dữ liệu hiện có không? KHÔNG — chỉ THÊM 5 cột (mặc định rỗng). Chưa chạy: tab Nguồn LĐ vẫn dùng được,
-- chỉ không lưu được đối thủ / nhãn / ngày hẹn (app báo cần chạy 214).
-- ============================================================================

ALTER TABLE labor_sources ADD COLUMN IF NOT EXISTS competitor_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE labor_sources ADD COLUMN IF NOT EXISTS competitor_note text NOT NULL DEFAULT '';
ALTER TABLE labor_sources ADD COLUMN IF NOT EXISTS pursuit text NOT NULL DEFAULT '';
ALTER TABLE labor_sources ADD COLUMN IF NOT EXISTS recontact_at date;
ALTER TABLE labor_sources ADD COLUMN IF NOT EXISTS recontact_task_for date;

CREATE INDEX IF NOT EXISTS labor_sources_competitors_idx ON labor_sources USING gin (competitor_ids) WHERE deleted_at IS NULL;

COMMENT ON COLUMN labor_sources.competitor_ids IS 'Đối thủ đã làm với trường (competitors.id, không FK).';
COMMENT ON COLUMN labor_sources.pursuit IS 'uu_tien = Ưu tiên triển khai · lien_he_sau = Để liên hệ sau · rỗng = chưa đánh giá.';

NOTIFY pgrst, 'reload schema';

-- ── Kiểm tra (mong đợi 5 dòng) ─────────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'labor_sources'
--   AND column_name IN ('competitor_ids', 'competitor_note', 'pursuit', 'recontact_at', 'recontact_task_for');
