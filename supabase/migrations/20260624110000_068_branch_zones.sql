CREATE TABLE IF NOT EXISTS branch_zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  location TEXT,
  manager_name TEXT,
  manager_salary NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS branch_zone_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id UUID NOT NULL REFERENCES branch_zones(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  amount NUMERIC DEFAULT 0,
  sort_order INT DEFAULT 0
);
