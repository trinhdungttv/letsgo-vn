-- Add industrial zones (Khu Công Nghiệp) selection to clients, sourced from market_zones
ALTER TABLE clients ADD COLUMN IF NOT EXISTS industrial_zones TEXT[] NOT NULL DEFAULT '{}';
