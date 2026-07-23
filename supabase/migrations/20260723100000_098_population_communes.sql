-- 098: Dữ liệu mật độ dân số theo Xã/Phường (mô hình chính quyền 2 cấp từ 01/07/2025).
-- Nhập thủ công hoặc import file (AI tổng hợp) — không có ranh giới polygon thật cho
-- toàn quốc nên lưu kèm lat/lng tâm xã (tuỳ chọn) để vẽ marker/circle trên bản đồ;
-- geometry (polygon GeoJSON) để trống, bổ sung sau khi có nguồn ranh giới chính thức.
-- Chỉ TẠO bảng mới, không đụng dữ liệu khác.

CREATE TABLE IF NOT EXISTS population_communes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  province_new text NOT NULL,        -- Tên tỉnh/thành sau sáp nhập, vd "TP. Hồ Chí Minh"
  province_old text,                 -- Tên tỉnh cũ trước sáp nhập, vd "Bình Dương (cũ)" — để đối chiếu
  commune_name text NOT NULL,        -- Tên xã/phường/đặc khu
  population integer NOT NULL CHECK (population >= 0),
  area_km2 double precision NOT NULL CHECK (area_km2 > 0),
  lat double precision,
  lng double precision,
  geometry jsonb,                    -- GeoJSON Polygon/MultiPolygon nếu có, để dành cho sau
  source_note text,                  -- vd "Nhập tay 23/07/2026" hoặc "AI tổng hợp 23/07/2026"
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_population_communes_province ON population_communes(province_new);

ALTER TABLE population_communes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "population_communes_all_anon" ON population_communes FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "population_communes_all_auth" ON population_communes FOR ALL TO authenticated USING (true) WITH CHECK (true);
