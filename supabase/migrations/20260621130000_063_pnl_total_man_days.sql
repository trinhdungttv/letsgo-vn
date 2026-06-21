-- Them truong "Tong so cong" vao bang P&L du an, the hien so cong lao dong hang thang.
-- Chay thu cong trong Supabase SQL Editor.

ALTER TABLE projects_pnl ADD COLUMN IF NOT EXISTS total_man_days INT DEFAULT 0;
