-- ============================================================
-- LET'S GO VN — SUPABASE SCHEMA v1.0
-- ============================================================

-- 1. BẢNG KHÁCH HÀNG (clients)
CREATE TABLE IF NOT EXISTS clients (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name            TEXT NOT NULL,
  region          TEXT DEFAULT 'Biên Hòa',
  manager         TEXT,
  cutoff_day      INTEGER DEFAULT 25,
  payment_start   INTEGER DEFAULT 5,
  payment_end     INTEGER DEFAULT 8,
  next_month_pay  BOOLEAN DEFAULT FALSE,
  contract_start  DATE,
  contract_end    DATE,
  notes           TEXT,
  status          TEXT DEFAULT 'ok',
  paid_this_month BOOLEAN DEFAULT FALSE,
  prog_cutoff     BOOLEAN DEFAULT FALSE,
  prog_calc       BOOLEAN DEFAULT FALSE,
  prog_paid       BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 2. LỊCH SỬ LAO ĐỘNG THEO TUẦN (client_labor_history)
CREATE TABLE IF NOT EXISTS client_labor_history (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id   UUID REFERENCES clients(id) ON DELETE CASCADE,
  week_label  TEXT NOT NULL,
  count       INTEGER NOT NULL,
  updated_by  TEXT DEFAULT 'system',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_labor_client ON client_labor_history(client_id, created_at DESC);

-- 3. TÀI CHÍNH THEO THÁNG (finance_records)
CREATE TABLE IF NOT EXISTS finance_records (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id         UUID REFERENCES clients(id) ON DELETE CASCADE,
  month             TEXT NOT NULL,
  revenue           NUMERIC DEFAULT 0,
  cost_labor        NUMERIC DEFAULT 0,
  cost_mgmt         NUMERIC DEFAULT 0,
  cost_other        NUMERIC DEFAULT 0,
  commission_rate   NUMERIC DEFAULT 0.05,
  commission_amount NUMERIC GENERATED ALWAYS AS (revenue * commission_rate) STORED,
  profit_gross      NUMERIC GENERATED ALWAYS AS (revenue - cost_labor - cost_mgmt - cost_other) STORED,
  paid_status       BOOLEAN DEFAULT FALSE,
  paid_date         DATE,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_client_month ON finance_records(client_id, month);

-- 4. CSKH LOG (cskh_logs)
CREATE TABLE IF NOT EXISTS cskh_logs (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id      UUID REFERENCES clients(id) ON DELETE SET NULL,
  client_name    TEXT,
  contact_person TEXT,
  contact_type   TEXT DEFAULT 'call',
  content        TEXT,
  followup       TEXT,
  followup_done  BOOLEAN DEFAULT FALSE,
  log_date       DATE DEFAULT CURRENT_DATE,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- 5. CRM PIPELINE (crm_pipeline)
CREATE TABLE IF NOT EXISTS crm_pipeline (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_name    TEXT NOT NULL,
  region          TEXT,
  worker_estimate INTEGER,
  stage           TEXT DEFAULT 'tiem-nang',
  sub_status      TEXT,
  last_contact    DATE,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 6. KHẢO SÁT THỊ TRƯỜNG (market_surveys)
CREATE TABLE IF NOT EXISTS market_surveys (
  id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  zone_name             TEXT NOT NULL,
  survey_date           DATE DEFAULT CURRENT_DATE,
  wage_unskilled_min    NUMERIC,
  wage_unskilled_max    NUMERIC,
  wage_skilled_min      NUMERIC,
  wage_skilled_max      NUMERIC,
  wage_tech_min         NUMERIC,
  wage_tech_max         NUMERIC,
  labor_availability    TEXT DEFAULT 'trung-binh',
  occupancy_rate        NUMERIC,
  notes                 TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- 7. ĐỐI THỦ CẠNH TRANH (competitors)
CREATE TABLE IF NOT EXISTS competitors (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  zone_name    TEXT NOT NULL,
  company_name TEXT NOT NULL,
  survey_date  DATE DEFAULT CURRENT_DATE,
  fee_unskilled NUMERIC,
  fee_skilled   NUMERIC,
  fee_tech      NUMERIC,
  trend         TEXT DEFAULT 'stable',
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 8. BÁO GIÁ (quotes)
CREATE TABLE IF NOT EXISTS quotes (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_name    TEXT NOT NULL,
  tax_code       TEXT,
  address        TEXT,
  contact_person TEXT,
  labor_demand   TEXT,
  zone           TEXT,
  status         TEXT DEFAULT 'draft',
  sent_via       TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS on all tables
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_labor_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE cskh_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_pipeline ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_surveys ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;

-- Permissive policies for authenticated users (internal ops system)
CREATE POLICY "clients_select" ON clients FOR SELECT TO authenticated USING (true);
CREATE POLICY "clients_insert" ON clients FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "clients_update" ON clients FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "clients_delete" ON clients FOR DELETE TO authenticated USING (true);

CREATE POLICY "labor_select" ON client_labor_history FOR SELECT TO authenticated USING (true);
CREATE POLICY "labor_insert" ON client_labor_history FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "labor_update" ON client_labor_history FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "labor_delete" ON client_labor_history FOR DELETE TO authenticated USING (true);

CREATE POLICY "finance_select" ON finance_records FOR SELECT TO authenticated USING (true);
CREATE POLICY "finance_insert" ON finance_records FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "finance_update" ON finance_records FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "finance_delete" ON finance_records FOR DELETE TO authenticated USING (true);

CREATE POLICY "cskh_select" ON cskh_logs FOR SELECT TO authenticated USING (true);
CREATE POLICY "cskh_insert" ON cskh_logs FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "cskh_update" ON cskh_logs FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "cskh_delete" ON cskh_logs FOR DELETE TO authenticated USING (true);

CREATE POLICY "crm_select" ON crm_pipeline FOR SELECT TO authenticated USING (true);
CREATE POLICY "crm_insert" ON crm_pipeline FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "crm_update" ON crm_pipeline FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "crm_delete" ON crm_pipeline FOR DELETE TO authenticated USING (true);

CREATE POLICY "market_select" ON market_surveys FOR SELECT TO authenticated USING (true);
CREATE POLICY "market_insert" ON market_surveys FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "market_update" ON market_surveys FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "market_delete" ON market_surveys FOR DELETE TO authenticated USING (true);

CREATE POLICY "competitors_select" ON competitors FOR SELECT TO authenticated USING (true);
CREATE POLICY "competitors_insert" ON competitors FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "competitors_update" ON competitors FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "competitors_delete" ON competitors FOR DELETE TO authenticated USING (true);

CREATE POLICY "quotes_select" ON quotes FOR SELECT TO authenticated USING (true);
CREATE POLICY "quotes_insert" ON quotes FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "quotes_update" ON quotes FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "quotes_delete" ON quotes FOR DELETE TO authenticated USING (true);

-- Also allow anon access for this internal system (no auth required yet)
CREATE POLICY "clients_select_anon" ON clients FOR SELECT TO anon USING (true);
CREATE POLICY "clients_insert_anon" ON clients FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "clients_update_anon" ON clients FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "clients_delete_anon" ON clients FOR DELETE TO anon USING (true);

CREATE POLICY "labor_select_anon" ON client_labor_history FOR SELECT TO anon USING (true);
CREATE POLICY "labor_insert_anon" ON client_labor_history FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "labor_update_anon" ON client_labor_history FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "labor_delete_anon" ON client_labor_history FOR DELETE TO anon USING (true);

CREATE POLICY "finance_select_anon" ON finance_records FOR SELECT TO anon USING (true);
CREATE POLICY "finance_insert_anon" ON finance_records FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "finance_update_anon" ON finance_records FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "finance_delete_anon" ON finance_records FOR DELETE TO anon USING (true);

CREATE POLICY "cskh_select_anon" ON cskh_logs FOR SELECT TO anon USING (true);
CREATE POLICY "cskh_insert_anon" ON cskh_logs FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "cskh_update_anon" ON cskh_logs FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "cskh_delete_anon" ON cskh_logs FOR DELETE TO anon USING (true);

CREATE POLICY "crm_select_anon" ON crm_pipeline FOR SELECT TO anon USING (true);
CREATE POLICY "crm_insert_anon" ON crm_pipeline FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "crm_update_anon" ON crm_pipeline FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "crm_delete_anon" ON crm_pipeline FOR DELETE TO anon USING (true);

CREATE POLICY "market_select_anon" ON market_surveys FOR SELECT TO anon USING (true);
CREATE POLICY "market_insert_anon" ON market_surveys FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "market_update_anon" ON market_surveys FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "market_delete_anon" ON market_surveys FOR DELETE TO anon USING (true);

CREATE POLICY "competitors_select_anon" ON competitors FOR SELECT TO anon USING (true);
CREATE POLICY "competitors_insert_anon" ON competitors FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "competitors_update_anon" ON competitors FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "competitors_delete_anon" ON competitors FOR DELETE TO anon USING (true);

CREATE POLICY "quotes_select_anon" ON quotes FOR SELECT TO anon USING (true);
CREATE POLICY "quotes_insert_anon" ON quotes FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "quotes_update_anon" ON quotes FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "quotes_delete_anon" ON quotes FOR DELETE TO anon USING (true);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE clients;
ALTER PUBLICATION supabase_realtime ADD TABLE client_labor_history;
ALTER PUBLICATION supabase_realtime ADD TABLE finance_records;
