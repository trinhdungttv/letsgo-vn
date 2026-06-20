-- Fix loi "Could not find the table 'public.app_settings'": tao bang app_settings + bucket avatars (idempotent)

-- 1. Bang app_settings (luu logo App theo key/value)
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_settings_all_anon" ON app_settings;
CREATE POLICY "app_settings_all_anon" ON app_settings FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "app_settings_all_auth" ON app_settings;
CREATE POLICY "app_settings_all_auth" ON app_settings FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 2. Storage bucket 'avatars' (luu file logo upload) + policies
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "avatars_select_anon" ON storage.objects;
CREATE POLICY "avatars_select_anon" ON storage.objects FOR SELECT TO anon USING (bucket_id = 'avatars');
DROP POLICY IF EXISTS "avatars_select_auth" ON storage.objects;
CREATE POLICY "avatars_select_auth" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'avatars');
DROP POLICY IF EXISTS "avatars_insert_anon" ON storage.objects;
CREATE POLICY "avatars_insert_anon" ON storage.objects FOR INSERT TO anon WITH CHECK (bucket_id = 'avatars');
DROP POLICY IF EXISTS "avatars_insert_auth" ON storage.objects;
CREATE POLICY "avatars_insert_auth" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'avatars');
DROP POLICY IF EXISTS "avatars_update_anon" ON storage.objects;
CREATE POLICY "avatars_update_anon" ON storage.objects FOR UPDATE TO anon USING (bucket_id = 'avatars');
DROP POLICY IF EXISTS "avatars_update_auth" ON storage.objects;
CREATE POLICY "avatars_update_auth" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'avatars');
DROP POLICY IF EXISTS "avatars_delete_anon" ON storage.objects;
CREATE POLICY "avatars_delete_anon" ON storage.objects FOR DELETE TO anon USING (bucket_id = 'avatars');
DROP POLICY IF EXISTS "avatars_delete_auth" ON storage.objects;
CREATE POLICY "avatars_delete_auth" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'avatars');
