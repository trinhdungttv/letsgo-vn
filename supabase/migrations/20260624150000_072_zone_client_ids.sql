ALTER TABLE branch_zones ADD COLUMN IF NOT EXISTS client_ids UUID[] DEFAULT '{}';
