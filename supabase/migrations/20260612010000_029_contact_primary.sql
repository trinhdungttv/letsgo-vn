-- Allow marking one contact per client as the primary contact
-- (the person the company is worked through).
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT false;
