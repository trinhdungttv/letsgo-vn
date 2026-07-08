-- 087 — Bo mirror Calendar rieng (08/07/2026): chay thu cong trong Supabase SQL Editor
-- Ly do: Google Calendar tu hien Google Tasks kem nut tick hoan thanh (bat "Tasks" trong sidebar Calendar),
-- nen viec tao event rieng o 086 la thua. Xoa cot khong con dung den.

SET search_path = public, extensions;

ALTER TABLE google_connections DROP COLUMN IF EXISTS calendar_id;
ALTER TABLE google_connections DROP COLUMN IF EXISTS calendar_summary;
ALTER TABLE google_task_links DROP COLUMN IF EXISTS google_event_id;
