-- Add avatar field for the branch manager ("Trưởng Chi Nhánh") + storage bucket for avatar uploads
ALTER TABLE branches ADD COLUMN IF NOT EXISTS manager_avatar_url TEXT;

INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "avatars_select_anon" ON storage.objects FOR SELECT TO anon USING (bucket_id = 'avatars');
CREATE POLICY "avatars_select_auth" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'avatars');
CREATE POLICY "avatars_insert_anon" ON storage.objects FOR INSERT TO anon WITH CHECK (bucket_id = 'avatars');
CREATE POLICY "avatars_insert_auth" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'avatars');
CREATE POLICY "avatars_update_anon" ON storage.objects FOR UPDATE TO anon USING (bucket_id = 'avatars');
CREATE POLICY "avatars_update_auth" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'avatars');
CREATE POLICY "avatars_delete_anon" ON storage.objects FOR DELETE TO anon USING (bucket_id = 'avatars');
CREATE POLICY "avatars_delete_auth" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'avatars');
