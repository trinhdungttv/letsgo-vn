
-- Fix crm_leads missing columns
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS owner TEXT;

-- Fix crm_products missing column
ALTER TABLE crm_products ADD COLUMN IF NOT EXISTS sku TEXT;

-- clients missing columns
ALTER TABLE clients ADD COLUMN IF NOT EXISTS crm_owner TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS prospect_status TEXT;

-- contacts missing columns
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS birthday DATE;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS hobbies TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS social_link TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS channel TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS rich_notes TEXT;
