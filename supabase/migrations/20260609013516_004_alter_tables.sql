-- Add missing columns to crm_pipeline
ALTER TABLE crm_pipeline ADD COLUMN IF NOT EXISTS rating TEXT DEFAULT 'normal';
ALTER TABLE crm_pipeline ADD COLUMN IF NOT EXISTS preferences TEXT;

-- Add missing column to market_surveys (spec uses wage_tech, old schema used wage_tech_min/max)
ALTER TABLE market_surveys ADD COLUMN IF NOT EXISTS wage_tech NUMERIC;
ALTER TABLE market_surveys ADD COLUMN IF NOT EXISTS surveyed_by TEXT;
