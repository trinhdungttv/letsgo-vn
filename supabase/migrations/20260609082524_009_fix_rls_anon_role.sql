-- Drop all existing CRM policies that restrict to authenticated-only
-- and recreate without role restriction (applies to anon + authenticated)
-- Root cause: app uses custom auth via app_users table (anon key),
-- never calls supabase.auth.signIn, so requests always run as anon role.

-- crm_leads
DROP POLICY IF EXISTS "crm_leads_select" ON crm_leads;
DROP POLICY IF EXISTS "crm_leads_insert" ON crm_leads;
DROP POLICY IF EXISTS "crm_leads_update" ON crm_leads;
DROP POLICY IF EXISTS "crm_leads_delete" ON crm_leads;

CREATE POLICY "crm_leads_select" ON crm_leads FOR SELECT USING (true);
CREATE POLICY "crm_leads_insert" ON crm_leads FOR INSERT WITH CHECK (true);
CREATE POLICY "crm_leads_update" ON crm_leads FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "crm_leads_delete" ON crm_leads FOR DELETE USING (true);

-- crm_products
DROP POLICY IF EXISTS "crm_products_select" ON crm_products;
DROP POLICY IF EXISTS "crm_products_insert" ON crm_products;
DROP POLICY IF EXISTS "crm_products_update" ON crm_products;
DROP POLICY IF EXISTS "crm_products_delete" ON crm_products;

CREATE POLICY "crm_products_select" ON crm_products FOR SELECT USING (true);
CREATE POLICY "crm_products_insert" ON crm_products FOR INSERT WITH CHECK (true);
CREATE POLICY "crm_products_update" ON crm_products FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "crm_products_delete" ON crm_products FOR DELETE USING (true);

-- crm_deals
DROP POLICY IF EXISTS "crm_deals_select" ON crm_deals;
DROP POLICY IF EXISTS "crm_deals_insert" ON crm_deals;
DROP POLICY IF EXISTS "crm_deals_update" ON crm_deals;
DROP POLICY IF EXISTS "crm_deals_delete" ON crm_deals;

CREATE POLICY "crm_deals_select" ON crm_deals FOR SELECT USING (true);
CREATE POLICY "crm_deals_insert" ON crm_deals FOR INSERT WITH CHECK (true);
CREATE POLICY "crm_deals_update" ON crm_deals FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "crm_deals_delete" ON crm_deals FOR DELETE USING (true);

-- crm_activities
DROP POLICY IF EXISTS "crm_activities_select" ON crm_activities;
DROP POLICY IF EXISTS "crm_activities_insert" ON crm_activities;
DROP POLICY IF EXISTS "crm_activities_update" ON crm_activities;
DROP POLICY IF EXISTS "crm_activities_delete" ON crm_activities;

CREATE POLICY "crm_activities_select" ON crm_activities FOR SELECT USING (true);
CREATE POLICY "crm_activities_insert" ON crm_activities FOR INSERT WITH CHECK (true);
CREATE POLICY "crm_activities_update" ON crm_activities FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "crm_activities_delete" ON crm_activities FOR DELETE USING (true);

-- Also fix contacts table (same issue)
DROP POLICY IF EXISTS "select_contacts" ON contacts;
DROP POLICY IF EXISTS "insert_contacts" ON contacts;
DROP POLICY IF EXISTS "update_contacts" ON contacts;
DROP POLICY IF EXISTS "delete_contacts" ON contacts;

CREATE POLICY "select_contacts" ON contacts FOR SELECT USING (true);
CREATE POLICY "insert_contacts" ON contacts FOR INSERT WITH CHECK (true);
CREATE POLICY "update_contacts" ON contacts FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "delete_contacts" ON contacts FOR DELETE USING (true);
