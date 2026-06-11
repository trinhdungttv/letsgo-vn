-- Each manager (Quản lý) belongs to one Chi Nhánh (region/branch)
ALTER TABLE managers ADD COLUMN IF NOT EXISTS region TEXT;
