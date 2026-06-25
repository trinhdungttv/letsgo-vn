-- Khoan settings on clients (per-client override)
ALTER TABLE clients ADD COLUMN IF NOT EXISTS khoan_type text NOT NULL DEFAULT 'pct';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS khoan_fixed_fee numeric NOT NULL DEFAULT 0;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS khoan_tiers jsonb;

-- Khoan settings on branches (branch-level default)
ALTER TABLE branches ADD COLUMN IF NOT EXISTS khoan_type text NOT NULL DEFAULT 'pct';
ALTER TABLE branches ADD COLUMN IF NOT EXISTS khoan_fixed_fee numeric NOT NULL DEFAULT 0;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS khoan_tiers jsonb;
