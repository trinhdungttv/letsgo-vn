-- 088 — Khoi phuc mirror Google Calendar (08/07/2026): chay thu cong trong Supabase SQL Editor
-- Dung IF NOT EXISTS nen an toan du da chay 087 (xoa cot) hay chua.

SET search_path = public, extensions;

ALTER TABLE google_connections ADD COLUMN IF NOT EXISTS calendar_id TEXT;
ALTER TABLE google_connections ADD COLUMN IF NOT EXISTS calendar_summary TEXT;
ALTER TABLE google_task_links ADD COLUMN IF NOT EXISTS google_event_id TEXT;
