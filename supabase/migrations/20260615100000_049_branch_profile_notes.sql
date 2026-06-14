-- Hồ sơ chi nhánh: thêm 3 trường ghi nhanh "Tình trạng / Khó khăn / Cơ hội"
-- dùng trong tab "Hồ sơ chi nhánh" (Branches.tsx) và panel cập nhật nhanh
-- từ Workspace -> Morning Priority -> "Cập nhật thông tin CN".

ALTER TABLE branches ADD COLUMN IF NOT EXISTS status_note TEXT;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS difficulties TEXT;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS opportunities TEXT;
