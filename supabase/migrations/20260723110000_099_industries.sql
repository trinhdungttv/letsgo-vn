-- 099: Bảng ngành nghề tập trung — dùng chung cho khảo sát lương (và các module khác sau này).
-- Tự seed từ các ngành nghề đã nhập trong market_surveys. Chỉ TẠO bảng mới, không sửa/xoá dữ liệu.

CREATE TABLE IF NOT EXISTS industries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE industries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "industries_all_anon" ON industries FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "industries_all_auth" ON industries FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Seed từ dữ liệu ngành nghề đã có trong khảo sát lương
INSERT INTO industries (name)
SELECT DISTINCT trim(industry) FROM market_surveys
WHERE industry IS NOT NULL AND trim(industry) <> ''
ON CONFLICT (name) DO NOTHING;
