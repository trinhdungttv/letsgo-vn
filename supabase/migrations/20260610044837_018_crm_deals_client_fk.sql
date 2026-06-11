
-- crm_deals.lead_id references crm_leads, not clients.
-- The code queries clients(name) via crm_deals — add a client_id FK column for direct client linking,
-- OR fix the query to use crm_leads. We add client_id as optional direct FK to clients.
ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id) ON DELETE SET NULL;
