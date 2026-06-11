-- Regions table
CREATE TABLE IF NOT EXISTS regions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE regions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "select_regions" ON regions FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_regions" ON regions FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "update_regions" ON regions FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_regions" ON regions FOR DELETE TO authenticated USING (true);

-- Seed regions from existing clients data
INSERT INTO regions (name)
SELECT DISTINCT region FROM clients WHERE region IS NOT NULL AND region != ''
ON CONFLICT (name) DO NOTHING;

-- Managers table
CREATE TABLE IF NOT EXISTS managers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  phone TEXT,
  email TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE managers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "select_managers" ON managers FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_managers" ON managers FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "update_managers" ON managers FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_managers" ON managers FOR DELETE TO authenticated USING (true);

-- Seed managers from existing clients data
INSERT INTO managers (name)
SELECT DISTINCT manager FROM clients WHERE manager IS NOT NULL AND manager != ''
ON CONFLICT (name) DO NOTHING;

-- Add min_workers to clients
ALTER TABLE clients ADD COLUMN IF NOT EXISTS min_workers INT DEFAULT 0;

-- Add anon read access for regions/managers (for public forms)
CREATE POLICY "anon_select_regions" ON regions FOR SELECT TO anon USING (true);
CREATE POLICY "anon_select_managers" ON managers FOR SELECT TO anon USING (true);
