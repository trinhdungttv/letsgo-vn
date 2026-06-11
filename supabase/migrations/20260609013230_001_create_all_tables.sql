-- CLIENTS
CREATE TABLE IF NOT EXISTS clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  region TEXT,
  manager TEXT,
  cutoff_day INTEGER DEFAULT 25,
  payment_start INTEGER DEFAULT 1,
  payment_end INTEGER DEFAULT 5,
  next_month_pay BOOLEAN DEFAULT false,
  contract_start DATE,
  contract_end DATE,
  notes TEXT,
  status TEXT DEFAULT 'ok',
  paid_this_month BOOLEAN DEFAULT false,
  prog_cutoff BOOLEAN DEFAULT false,
  prog_calc BOOLEAN DEFAULT false,
  prog_paid BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "clients_all_anon" ON clients FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "clients_all_auth" ON clients FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- CLIENT_LABOR_HISTORY
CREATE TABLE IF NOT EXISTS client_labor_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  week_label TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE client_labor_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "labor_all_anon" ON client_labor_history FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "labor_all_auth" ON client_labor_history FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- FINANCE_RECORDS
CREATE TABLE IF NOT EXISTS finance_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  revenue NUMERIC DEFAULT 0,
  cost_labor NUMERIC DEFAULT 0,
  cost_mgmt NUMERIC DEFAULT 0,
  cost_other NUMERIC DEFAULT 0,
  commission_rate NUMERIC DEFAULT 0.05,
  paid_status BOOLEAN DEFAULT false,
  paid_date DATE,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE finance_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "finance_all_anon" ON finance_records FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "finance_all_auth" ON finance_records FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- CSKH_LOGS
CREATE TABLE IF NOT EXISTS cskh_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  client_name TEXT,
  contact_person TEXT,
  contact_type TEXT DEFAULT 'call',
  content TEXT,
  followup TEXT,
  followup_done BOOLEAN DEFAULT false,
  log_date DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE cskh_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cskh_all_anon" ON cskh_logs FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "cskh_all_auth" ON cskh_logs FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- CRM_PIPELINE
CREATE TABLE IF NOT EXISTS crm_pipeline (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name TEXT NOT NULL,
  region TEXT,
  worker_estimate INTEGER,
  stage TEXT DEFAULT 'tiem-nang',
  sub_status TEXT,
  rating TEXT DEFAULT 'normal',
  preferences TEXT,
  last_contact DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE crm_pipeline ENABLE ROW LEVEL SECURITY;
CREATE POLICY "crm_all_anon" ON crm_pipeline FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "crm_all_auth" ON crm_pipeline FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- CRM_INTERACTIONS
CREATE TABLE IF NOT EXISTS crm_interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  crm_id UUID REFERENCES crm_pipeline(id) ON DELETE CASCADE,
  interaction_date DATE DEFAULT CURRENT_DATE,
  interaction_type TEXT DEFAULT 'call',
  content TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE crm_interactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "crm_int_all_anon" ON crm_interactions FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "crm_int_all_auth" ON crm_interactions FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- CRM_GIFTS
CREATE TABLE IF NOT EXISTS crm_gifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  crm_id UUID REFERENCES crm_pipeline(id) ON DELETE CASCADE,
  gift_date DATE DEFAULT CURRENT_DATE,
  item_name TEXT,
  value TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE crm_gifts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "crm_gifts_all_anon" ON crm_gifts FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "crm_gifts_all_auth" ON crm_gifts FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- MARKET_SURVEYS
CREATE TABLE IF NOT EXISTS market_surveys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_name TEXT NOT NULL,
  survey_date DATE DEFAULT CURRENT_DATE,
  wage_unskilled_min NUMERIC,
  wage_unskilled_max NUMERIC,
  wage_skilled_min NUMERIC,
  wage_skilled_max NUMERIC,
  wage_tech NUMERIC,
  labor_availability TEXT DEFAULT 'Trung bình',
  surveyed_by TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE market_surveys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "market_all_anon" ON market_surveys FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "market_all_auth" ON market_surveys FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- COMPETITORS
CREATE TABLE IF NOT EXISTS competitors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_name TEXT NOT NULL,
  company_name TEXT NOT NULL,
  survey_date DATE DEFAULT CURRENT_DATE,
  fee_unskilled NUMERIC,
  fee_skilled NUMERIC,
  fee_tech NUMERIC,
  trend TEXT DEFAULT 'stable',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE competitors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "comp_all_anon" ON competitors FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "comp_all_auth" ON competitors FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- QUOTES
CREATE TABLE IF NOT EXISTS quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_name TEXT,
  tax_code TEXT,
  address TEXT,
  contact_person TEXT,
  labor_demand TEXT,
  zone TEXT,
  price_unskilled NUMERIC,
  price_skilled NUMERIC,
  price_tech NUMERIC,
  status TEXT DEFAULT 'draft',
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "quotes_all_anon" ON quotes FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "quotes_all_auth" ON quotes FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- APP_USERS (for role-based auth)
CREATE TABLE IF NOT EXISTS app_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'kinhdoanh',
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "appusers_all_anon" ON app_users FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "appusers_all_auth" ON app_users FOR ALL TO authenticated USING (true) WITH CHECK (true);
