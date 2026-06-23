ALTER TABLE clients ADD COLUMN IF NOT EXISTS extra_salary_days JSONB DEFAULT '[]'::jsonb;
