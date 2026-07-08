-- 086 — Nang cap: mirror work_tasks sang Google Calendar (08/07/2026): chay thu cong trong Supabase SQL Editor
-- User chon 1 lich co san trong Google Calendar; moi task hien thanh event ca ngay (all-day) theo due_date.
-- Chieu Calendar la MIRROR 1 chieu (web -> Calendar); sua 2 chieu van qua web hoac Google Tasks.

SET search_path = public, extensions;

-- Lich Google user da chon de do viec vao (NULL = chua bat mirror Calendar)
ALTER TABLE google_connections ADD COLUMN IF NOT EXISTS calendar_id TEXT;
ALTER TABLE google_connections ADD COLUMN IF NOT EXISTS calendar_summary TEXT;  -- ten lich (hien tren UI)

-- Event tuong ung cua task tren lich da chon
ALTER TABLE google_task_links ADD COLUMN IF NOT EXISTS google_event_id TEXT;
