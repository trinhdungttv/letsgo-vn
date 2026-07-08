-- 089 — Chuyen dong bo tu Google Tasks sang CHI Google Calendar event (09/07/2026): chay thu cong trong Supabase SQL Editor
-- Khong con tao Google Task nen google_task_id khong con bat buoc; google_event_id la khoa chinh de doi chieu.

SET search_path = public, extensions;

ALTER TABLE google_task_links ALTER COLUMN google_task_id DROP NOT NULL;

-- Cho phep nhieu row cung mot user co google_task_id = NULL (rang buoc UNIQUE cu chi ap dung khi khac NULL).
ALTER TABLE google_task_links DROP CONSTRAINT IF EXISTS google_task_links_user_id_google_task_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_google_task_links_user_event
  ON google_task_links(user_id, google_event_id) WHERE google_event_id IS NOT NULL;
