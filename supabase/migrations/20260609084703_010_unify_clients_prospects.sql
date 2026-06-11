-- Add columns to clients table for unified prospect + active tracking
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS client_type TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS pipeline_stage TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS won_date DATE DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS crm_owner TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS phone TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS email TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS prospect_status TEXT DEFAULT 'lead';

-- All existing rows are active clients
UPDATE clients SET client_type = 'active' WHERE client_type IS NULL OR client_type = 'active';

-- Drop any existing FK from crm_deals.lead_id → crm_leads
DO $$
DECLARE
  v_constraint TEXT;
BEGIN
  SELECT tc.constraint_name INTO v_constraint
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
  WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_schema = 'public'
    AND tc.table_name = 'crm_deals'
    AND kcu.column_name = 'lead_id'
  LIMIT 1;

  IF v_constraint IS NOT NULL THEN
    EXECUTE 'ALTER TABLE crm_deals DROP CONSTRAINT ' || quote_ident(v_constraint);
  END IF;
END $$;

-- Nullify lead_ids that point to crm_leads (not clients) — old seed data
UPDATE crm_deals
SET lead_id = NULL
WHERE lead_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM clients WHERE id = crm_deals.lead_id);

-- Add new FK: crm_deals.lead_id → clients.id
ALTER TABLE crm_deals
  ADD CONSTRAINT fk_crm_deals_client
  FOREIGN KEY (lead_id) REFERENCES clients(id) ON DELETE SET NULL;

-- Ensure clients table allows anon access (same fix as other tables)
DO $$
BEGIN
  -- Check if RLS is enabled on clients
  IF NOT EXISTS (
    SELECT 1 FROM pg_class pc
    JOIN pg_namespace pn ON pc.relnamespace = pn.oid
    WHERE pn.nspname = 'public' AND pc.relname = 'clients' AND pc.relrowsecurity = true
  ) THEN
    EXECUTE 'ALTER TABLE clients ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;

-- Drop existing restrictive policies if any
DROP POLICY IF EXISTS "clients_select" ON clients;
DROP POLICY IF EXISTS "clients_insert" ON clients;
DROP POLICY IF EXISTS "clients_update" ON clients;
DROP POLICY IF EXISTS "clients_delete" ON clients;
DROP POLICY IF EXISTS "allow_all_clients" ON clients;

-- Create open policies (app uses anon key with custom auth)
CREATE POLICY "clients_select" ON clients FOR SELECT USING (true);
CREATE POLICY "clients_insert" ON clients FOR INSERT WITH CHECK (true);
CREATE POLICY "clients_update" ON clients FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "clients_delete" ON clients FOR DELETE USING (true);
