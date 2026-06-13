-- Editable permission matrix: per-role access level for each module
CREATE TABLE IF NOT EXISTS role_permissions (
  role TEXT NOT NULL,
  module TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'none' CHECK (level IN ('full', 'view', 'none')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (role, module)
);

ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "role_permissions_all_anon" ON role_permissions FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "role_permissions_all_auth" ON role_permissions FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Seed with the current hardcoded matrix (matches canAccess() in src/lib/auth.tsx)
INSERT INTO role_permissions (role, module, level) VALUES
  ('admin', 'Dashboard', 'full'),
  ('admin', 'Khách hàng', 'full'),
  ('admin', 'Chi nhánh', 'full'),
  ('admin', 'Tài chính', 'full'),
  ('admin', 'Thị trường', 'full'),
  ('admin', 'Báo giá', 'full'),
  ('admin', 'CRM', 'full'),
  ('admin', 'Báo cáo', 'view'),
  ('admin', 'Quản lý Users', 'full'),
  ('admin', 'Lịch sử', 'full'),
  ('admin', 'Bảng KD', 'full'),
  ('admin', 'Admin', 'full'),
  ('admin', 'Workspace', 'full'),

  ('ketoan', 'Dashboard', 'view'),
  ('ketoan', 'Khách hàng', 'full'),
  ('ketoan', 'Chi nhánh', 'none'),
  ('ketoan', 'Tài chính', 'full'),
  ('ketoan', 'Thị trường', 'none'),
  ('ketoan', 'Báo giá', 'none'),
  ('ketoan', 'CRM', 'none'),
  ('ketoan', 'Báo cáo', 'view'),
  ('ketoan', 'Quản lý Users', 'none'),
  ('ketoan', 'Lịch sử', 'none'),
  ('ketoan', 'Bảng KD', 'none'),
  ('ketoan', 'Admin', 'none'),
  ('ketoan', 'Workspace', 'full'),

  ('kinhdoanh', 'Dashboard', 'view'),
  ('kinhdoanh', 'Khách hàng', 'full'),
  ('kinhdoanh', 'Chi nhánh', 'none'),
  ('kinhdoanh', 'Tài chính', 'none'),
  ('kinhdoanh', 'Thị trường', 'full'),
  ('kinhdoanh', 'Báo giá', 'full'),
  ('kinhdoanh', 'CRM', 'full'),
  ('kinhdoanh', 'Báo cáo', 'view'),
  ('kinhdoanh', 'Quản lý Users', 'none'),
  ('kinhdoanh', 'Lịch sử', 'none'),
  ('kinhdoanh', 'Bảng KD', 'full'),
  ('kinhdoanh', 'Admin', 'none'),
  ('kinhdoanh', 'Workspace', 'full'),

  ('bdh', 'Dashboard', 'view'),
  ('bdh', 'Khách hàng', 'full'),
  ('bdh', 'Chi nhánh', 'full'),
  ('bdh', 'Tài chính', 'full'),
  ('bdh', 'Thị trường', 'none'),
  ('bdh', 'Báo giá', 'none'),
  ('bdh', 'CRM', 'full'),
  ('bdh', 'Báo cáo', 'view'),
  ('bdh', 'Quản lý Users', 'none'),
  ('bdh', 'Lịch sử', 'none'),
  ('bdh', 'Bảng KD', 'full'),
  ('bdh', 'Admin', 'none'),
  ('bdh', 'Workspace', 'full')
ON CONFLICT (role, module) DO NOTHING;
