-- 085 — Dong bo 2 chieu work_tasks <-> Google Tasks (08/07/2026): chay thu cong trong Supabase SQL Editor
-- 1) google_connections: moi user ket noi 1 tai khoan Google (luu refresh token DA MA HOA phia server)
-- 2) google_task_links: anh xa work_task <-> google task de reconcile 2 chieu (khong FK toi work_tasks
--    de link song sot sau khi task bi xoa tren web -> lan sync sau biet ma xoa ben Google)
-- Ca 2 bang CHI truy cap bang service role tu Vercel Function (/api/google/*) — chan het anon/authenticated.

SET search_path = public, extensions;

-- ── 1. google_connections ──
CREATE TABLE IF NOT EXISTS google_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES app_users(id) ON DELETE CASCADE,
  google_email TEXT,                              -- email Google da ket noi (hien thi tren UI)
  refresh_token_enc TEXT NOT NULL,                -- refresh token ma hoa AES-GCM (key trong env Vercel)
  tasklist_id TEXT,                               -- id danh sach "LetsGo" trong Google Tasks
  sync_enabled BOOLEAN NOT NULL DEFAULT true,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE google_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON google_connections FROM anon, authenticated;

-- ── 2. google_task_links ──
CREATE TABLE IF NOT EXISTS google_task_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  work_task_id UUID NOT NULL,                     -- khong FK: giu lai sau khi web xoa task
  google_task_id TEXT NOT NULL,
  web_updated_at TIMESTAMPTZ,                     -- work_tasks.updated_at tai lan sync cuoi
  google_updated_at TIMESTAMPTZ,                  -- google task .updated tai lan sync cuoi
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (work_task_id),
  UNIQUE (user_id, google_task_id)
);
CREATE INDEX IF NOT EXISTS idx_google_task_links_user ON google_task_links(user_id);

ALTER TABLE google_task_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON google_task_links FROM anon, authenticated;
