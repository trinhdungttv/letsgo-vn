-- Add "Tính lương" and "Phát lương" milestones (each can span a date range)
-- and allow "Chốt công" to span a date range too.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS cutoff_day_end INT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS calc_day INT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS calc_day_end INT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS salary_day INT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS salary_day_end INT;

UPDATE clients SET calc_day = cutoff_day + 2 WHERE calc_day IS NULL;
UPDATE clients SET salary_day = payment_start WHERE salary_day IS NULL;
