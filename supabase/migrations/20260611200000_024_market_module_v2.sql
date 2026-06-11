-- MARKET MODULE V2: zone profiles, leads/projects, extended wage & competitor fields

-- MARKET_ZONES
CREATE TABLE IF NOT EXISTS market_zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  full_name TEXT,
  location TEXT,
  operator TEXT,
  area TEXT,
  established_year TEXT,
  occupancy_pct INTEGER,
  total_companies INTEGER,
  fdi_companies INTEGER,
  total_workers INTEGER,
  industries TEXT[] DEFAULT '{}',
  countries TEXT[] DEFAULT '{}',
  characteristics TEXT,
  strengths TEXT,
  weaknesses TEXT,
  labor_availability TEXT DEFAULT 'Trung bình',
  lgv_clients INTEGER DEFAULT 0,
  lgv_workers INTEGER DEFAULT 0,
  potential INTEGER DEFAULT 3,
  notes TEXT,
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE market_zones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "market_zones_all_anon" ON market_zones FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "market_zones_all_auth" ON market_zones FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- MARKET_LEADS
CREATE TABLE IF NOT EXISTS market_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name TEXT NOT NULL,
  region TEXT,
  industry TEXT,
  workers_needed INTEGER DEFAULT 0,
  source TEXT,
  lead_date DATE DEFAULT CURRENT_DATE,
  status TEXT DEFAULT 'Chưa LH',
  suppliers JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE market_leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "market_leads_all_anon" ON market_leads FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "market_leads_all_auth" ON market_leads FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- MARKET_SURVEYS: per-industry wage breakdown (PT / Thời vụ / Chính thức)
ALTER TABLE market_surveys ADD COLUMN IF NOT EXISTS industry TEXT;
ALTER TABLE market_surveys ADD COLUMN IF NOT EXISTS wage_seasonal_min NUMERIC;
ALTER TABLE market_surveys ADD COLUMN IF NOT EXISTS wage_seasonal_max NUMERIC;
ALTER TABLE market_surveys ADD COLUMN IF NOT EXISTS occupancy TEXT;

-- COMPETITORS: extra fields for richer comparison
ALTER TABLE competitors ADD COLUMN IF NOT EXISTS wage_paid NUMERIC;
ALTER TABLE competitors ADD COLUMN IF NOT EXISTS fee_per_shift NUMERIC;
ALTER TABLE competitors ADD COLUMN IF NOT EXISTS supplying_for TEXT[] DEFAULT '{}';
