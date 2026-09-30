-- Tháng nhân sự VP vào làm (YYYY-MM): lương chỉ tính vào chi phí chi nhánh từ tháng này trở đi.
-- NULL = không biết → vẫn tính mọi tháng như trước.
ALTER TABLE branch_staffs ADD COLUMN IF NOT EXISTS start_month TEXT;

-- Bỏ lương 1 nhân sự khỏi chi phí của MỘT tháng cụ thể (không xoá nhân sự, không ảnh hưởng tháng khác).
CREATE TABLE IF NOT EXISTS branch_staff_month_skips (
  staff_id UUID NOT NULL REFERENCES branch_staffs(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (staff_id, month)
);

-- Cho phép đọc/ghi giống các bảng khác (nếu không có policy, thao tác bỏ lương khỏi tháng sẽ bị chặn)
ALTER TABLE branch_staff_month_skips ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "bsms_all_anon" ON branch_staff_month_skips FOR ALL TO anon USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "bsms_all_auth" ON branch_staff_month_skips FOR ALL TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
