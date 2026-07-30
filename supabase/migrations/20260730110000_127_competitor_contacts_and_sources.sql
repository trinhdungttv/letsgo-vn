-- 127: Đối thủ — (1) nhiều Nhân sự + SĐT thay vì chỉ 1 Giám đốc + tối đa 2 số; (2) danh sách
-- "Nguồn tuyển" dùng chung, cho phép tạo/sửa/xoá để lần sau chọn thay vì gõ tay mỗi lần.

-- Danh sách nhân sự liên hệ: [{ "name": "...", "phone": "..." }, ...]. Giữ nguyên các cột
-- director/director_phone/director_phone2 cũ (không xoá) — chỉ thêm cột mới rồi copy dữ liệu
-- cũ sang để không mất thông tin đã nhập.
ALTER TABLE competitors ADD COLUMN IF NOT EXISTS contacts jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE competitors
SET contacts = (
  SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) FROM (
    (SELECT jsonb_build_object('name', COALESCE(director, ''), 'phone', COALESCE(director_phone, '')) AS x
     WHERE director IS NOT NULL OR director_phone IS NOT NULL)
    UNION ALL
    (SELECT jsonb_build_object('name', '', 'phone', director_phone2) AS x
     WHERE director_phone2 IS NOT NULL AND director_phone2 <> '')
  ) t
)
WHERE contacts = '[]'::jsonb
  AND (director IS NOT NULL OR director_phone IS NOT NULL OR director_phone2 IS NOT NULL);

-- Danh sách "Nguồn tuyển" dùng chung toàn hệ thống — thêm/sửa/xoá ở đây áp dụng ngay cho
-- gợi ý chọn nhanh của mọi đối thủ.
CREATE TABLE IF NOT EXISTS competitor_recruitment_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE competitor_recruitment_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "competitor_recruitment_sources_all_anon" ON competitor_recruitment_sources FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "competitor_recruitment_sources_all_auth" ON competitor_recruitment_sources FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Gieo sẵn từ các giá trị "Nguồn tuyển" đã gõ tay trước đó, để không mất lựa chọn đang dùng.
INSERT INTO competitor_recruitment_sources (label, sort_order)
SELECT DISTINCT trim(recruitment_source), 0
FROM competitors
WHERE recruitment_source IS NOT NULL AND trim(recruitment_source) <> ''
ON CONFLICT DO NOTHING;

SELECT dh_attach_triggers();
