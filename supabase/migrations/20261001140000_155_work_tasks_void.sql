-- Vô hiệu hoá Hợp đồng / Phụ lục (đã thanh lý, hết hiệu lực dù còn hạn). Không xoá — chỉ đánh dấu, khôi phục được.
ALTER TABLE work_tasks ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ;
ALTER TABLE work_tasks ADD COLUMN IF NOT EXISTS void_reason TEXT;
