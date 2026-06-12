CREATE TABLE IF NOT EXISTS branches (
  id uuid default gen_random_uuid() primary key,
  name text not null unique,
  short_name text,
  manager_id uuid references managers(id),
  manager_name text,
  address text,
  phone text,
  email text,
  region text,
  established_date date,
  status text default 'active',
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

ALTER TABLE branches ENABLE ROW LEVEL SECURITY;

CREATE POLICY branches_all_anon ON branches FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY branches_all_auth ON branches FOR ALL TO authenticated USING (true) WITH CHECK (true);
