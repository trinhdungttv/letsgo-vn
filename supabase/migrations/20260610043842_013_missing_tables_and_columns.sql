
CREATE TABLE IF NOT EXISTS crm_deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  lead_id UUID REFERENCES crm_leads(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
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

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='crm_deals' AND policyname='crm_deals_select') THEN
    CREATE POLICY "crm_deals_select" ON crm_deals FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='crm_deals' AND policyname='crm_deals_insert') THEN
    CREATE POLICY "crm_deals_insert" ON crm_deals FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='crm_deals' AND policyname='crm_deals_update') THEN
    CREATE POLICY "crm_deals_update" ON crm_deals FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='crm_deals' AND policyname='crm_deals_delete') THEN
    CREATE POLICY "crm_deals_delete" ON crm_deals FOR DELETE TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='crm_deals' AND policyname='crm_deals_anon_select') THEN
    CREATE POLICY "crm_deals_anon_select" ON crm_deals FOR SELECT TO anon USING (true);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS crm_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID REFERENCES crm_deals(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'note',
  content TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE crm_activities ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='crm_activities' AND policyname='crm_activities_select') THEN
    CREATE POLICY "crm_activities_select" ON crm_activities FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='crm_activities' AND policyname='crm_activities_insert') THEN
    CREATE POLICY "crm_activities_insert" ON crm_activities FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='crm_activities' AND policyname='crm_activities_update') THEN
    CREATE POLICY "crm_activities_update" ON crm_activities FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='crm_activities' AND policyname='crm_activities_delete') THEN
    CREATE POLICY "crm_activities_delete" ON crm_activities FOR DELETE TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='crm_activities' AND policyname='crm_activities_anon_select') THEN
    CREATE POLICY "crm_activities_anon_select" ON crm_activities FOR SELECT TO anon USING (true);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS app_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'kinhdoanh',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='app_users' AND policyname='appusers_all_anon') THEN
    CREATE POLICY "appusers_all_anon" ON app_users FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='app_users' AND policyname='appusers_all_auth') THEN
    CREATE POLICY "appusers_all_auth" ON app_users FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

INSERT INTO app_users (username, password, full_name, role)
VALUES ('admin', 'admin123', 'Administrator', 'admin')
ON CONFLICT (username) DO NOTHING;

ALTER TABLE clients ADD COLUMN IF NOT EXISTS crm_owner TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS prospect_status TEXT;

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS birthday DATE;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS hobbies TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS social_link TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS channel TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS rich_notes TEXT;
