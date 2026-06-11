INSERT INTO app_users (username, password, full_name, role)
VALUES ('admin', 'admin', 'Quản trị viên', 'admin')
ON CONFLICT (username)
DO UPDATE SET
  password = EXCLUDED.password,
  full_name = EXCLUDED.full_name,
  role = EXCLUDED.role;
