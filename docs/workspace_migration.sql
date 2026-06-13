-- Extra columns for Admin > Quản lý tài khoản (email + lock/unlock)
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;


CREATE TABLE IF NOT EXISTS notifications (
  id uuid default gen_random_uuid() primary key,
  user_id uuid,
  title text not null,
  body text,
  type text,
  is_read boolean default false,
  action_url text,
  created_at timestamptz default now()
);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY notifications_all_anon ON notifications FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY notifications_all_auth ON notifications FOR ALL TO authenticated USING (true) WITH CHECK (true);


CREATE TABLE IF NOT EXISTS permission_requests (
  id uuid default gen_random_uuid() primary key,
  requester_email text not null,
  requester_name text,
  requester_role text,
  module text not null,
  action_requested text not null,
  reason text,
  status text default 'pending',
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz default now()
);

ALTER TABLE permission_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY permission_requests_all_anon ON permission_requests FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY permission_requests_all_auth ON permission_requests FOR ALL TO authenticated USING (true) WITH CHECK (true);


CREATE TABLE IF NOT EXISTS sales_tasks (
  id uuid default gen_random_uuid() primary key,
  title text not null,
  sub_label text,
  client_name text,
  deadline date,
  assigned_to uuid,
  assigned_name text,
  status text default 'todo',
  created_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

ALTER TABLE sales_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY sales_tasks_all_anon ON sales_tasks FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY sales_tasks_all_auth ON sales_tasks FOR ALL TO authenticated USING (true) WITH CHECK (true);


CREATE TABLE IF NOT EXISTS user_permissions (
  id uuid default gen_random_uuid() primary key,
  user_email text not null,
  module text not null,
  can_view boolean default false,
  can_edit boolean default false,
  can_delete boolean default false,
  can_export boolean default false,
  granted_by text,
  created_at timestamptz default now(),
  unique (user_email, module)
);

ALTER TABLE user_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_permissions_all_anon ON user_permissions FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY user_permissions_all_auth ON user_permissions FOR ALL TO authenticated USING (true) WITH CHECK (true);
