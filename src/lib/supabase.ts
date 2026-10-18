import { createClient } from '@supabase/supabase-js';

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
}

// App không dùng phiên Supabase Auth: mọi request chạy bằng anon key + session token riêng (verify_login).
// Tắt hẳn phần Auth của client chính để phiên Google OAuth (lib/googleLogin.ts, client riêng) không bao giờ
// lọt vào đây — nếu lọt, request sẽ chạy role `authenticated` thay vì `anon` và RLS hiện có bị lệch.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
