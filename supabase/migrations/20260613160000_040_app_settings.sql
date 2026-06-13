-- Cấu hình chung của hệ thống (key/value), dùng cho logo App hiển thị ở Sidebar + trang Đăng nhập
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "app_settings_all_anon" ON app_settings FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "app_settings_all_auth" ON app_settings FOR ALL TO authenticated USING (true) WITH CHECK (true);
