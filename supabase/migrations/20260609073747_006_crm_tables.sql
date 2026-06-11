
CREATE TABLE IF NOT EXISTS crm_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  company TEXT,
  source TEXT DEFAULT 'website',
  status TEXT DEFAULT 'lead',
  owner TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE crm_leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "crm_leads_select" ON crm_leads FOR SELECT TO authenticated USING (true);
CREATE POLICY "crm_leads_insert" ON crm_leads FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "crm_leads_update" ON crm_leads FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "crm_leads_delete" ON crm_leads FOR DELETE TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS crm_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  price NUMERIC(14,2) DEFAULT 0,
  sku TEXT,
  description TEXT,
  category TEXT DEFAULT 'Service',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE crm_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "crm_products_select" ON crm_products FOR SELECT TO authenticated USING (true);
CREATE POLICY "crm_products_insert" ON crm_products FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "crm_products_update" ON crm_products FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "crm_products_delete" ON crm_products FOR DELETE TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS crm_deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  lead_id UUID REFERENCES crm_leads(id) ON DELETE SET NULL,
  product_id UUID REFERENCES crm_products(id) ON DELETE SET NULL,
  value NUMERIC(14,2) DEFAULT 0,
  stage TEXT DEFAULT 'new',
  owner TEXT,
  expected_closing_date DATE,
  probability INT DEFAULT 20,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE crm_deals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "crm_deals_select" ON crm_deals FOR SELECT TO authenticated USING (true);
CREATE POLICY "crm_deals_insert" ON crm_deals FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "crm_deals_update" ON crm_deals FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "crm_deals_delete" ON crm_deals FOR DELETE TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS crm_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID REFERENCES crm_deals(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'note',
  content TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE crm_activities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "crm_activities_select" ON crm_activities FOR SELECT TO authenticated USING (true);
CREATE POLICY "crm_activities_insert" ON crm_activities FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "crm_activities_update" ON crm_activities FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "crm_activities_delete" ON crm_activities FOR DELETE TO authenticated USING (true);
