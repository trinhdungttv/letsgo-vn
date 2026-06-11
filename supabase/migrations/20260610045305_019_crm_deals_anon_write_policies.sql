
CREATE POLICY "crm_deals_anon_insert" ON crm_deals FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "crm_deals_anon_update" ON crm_deals FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "crm_deals_anon_delete" ON crm_deals FOR DELETE TO anon USING (true);

CREATE POLICY "crm_activities_anon_insert" ON crm_activities FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "crm_activities_anon_update" ON crm_activities FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "crm_activities_anon_delete" ON crm_activities FOR DELETE TO anon USING (true);
