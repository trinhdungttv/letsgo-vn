-- ============================================================================
-- 186 — CRM Pipeline: 1 công ty chọn được NHIỀU KCN (công ty lớn có nhà máy ở nhiều KCN, tuyển ở từng nơi)
-- ----------------------------------------------------------------------------
-- Trước: KCN của thẻ Pipeline chỉ có 1, dạng CHỮ, nằm ở market_leads.region (dòng Thị trường gắn crm_id);
--        thẻ đã là khách thì đọc clients.industrial_zones.
-- Nay:   crm_pipeline.zone_ids uuid[] → market_zones.id (Thị trường → Khu vực / KCN), lưu MÃ không lưu tên
--        nên đổi tên KCN ở Thị trường không làm lệch bộ lọc. KCN đầu tiên = KCN chính.
--        App vẫn ghi KCN đầu tiên vào market_leads.region để các màn Thị trường cũ chạy nguyên.
--
-- Chuyển dữ liệu cũ: mỗi thẻ lấy KCN cũ (market_leads.region + clients.industrial_zones của khách đã gắn),
-- so khớp với danh mục bỏ dấu / bỏ chữ "KCN", "Khu công nghiệp"… (giống zoneKey trong app) → danh sách mã.
-- Chỉ điền thẻ đang có zone_ids rỗng → chạy lại vẫn an toàn, không đè KCN đã chọn trong app.
--
-- Có mất dữ liệu hiện có không? KHÔNG — chỉ ADD COLUMN + điền cột mới. Cột cũ market_leads.region và
-- clients.industrial_zones giữ nguyên. Tên cũ không khớp danh mục (thường là tên chi nhánh ghi tạm) được
-- liệt kê ở câu SELECT cuối để xem lại; app cũng báo ngay trong hồ sơ công ty để chọn lại.
-- Không thêm khoá ngoại (mảng uuid) → không ảnh hưởng các chỗ embed crm_pipeline (bài học PGRST201).
-- ============================================================================
ALTER TABLE crm_pipeline ADD COLUMN IF NOT EXISTS zone_ids uuid[] NOT NULL DEFAULT '{}';

-- Lọc "công ty ở KCN X" nhanh
CREATE INDEX IF NOT EXISTS crm_pipeline_zone_ids_idx ON crm_pipeline USING gin (zone_ids);

-- Chuẩn hoá tên KCN để so khớp (hàm tạm, tự mất khi đóng phiên)
CREATE OR REPLACE FUNCTION pg_temp.lgvn_zone_key(s text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT btrim(regexp_replace(regexp_replace(regexp_replace(
    translate(lower(normalize(coalesce(s, ''), NFC)),
      'àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ',
      'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd'),
    '[.,()–—-]', ' ', 'g'),
    '\m(khu cong nghiep|cum cong nghiep|khu che xuat|khu kinh te|kcn|ccn|kcx|kkt)\M', ' ', 'g'),
    '\s+', ' ', 'g'))
$$;

-- Chuyển KCN cũ sang danh sách mã (KCN cũ duy nhất → danh sách 1 phần tử)
WITH zone_keys AS (
  SELECT id, pg_temp.lgvn_zone_key(name) AS k FROM market_zones
),
old_names AS (
  -- Thẻ Pipeline: KCN ghi ở Thị trường → Công ty/Dự án (1 KCN dạng chữ)
  SELECT ml.crm_id AS pipeline_id, ml.region AS zone_name, 0::bigint AS ord
  FROM market_leads ml
  WHERE ml.crm_id IS NOT NULL AND btrim(coalesce(ml.region, '')) <> ''
  UNION ALL
  -- Thẻ đã là khách: KCN ở hồ sơ Khách hàng (nhiều KCN dạng chữ)
  SELECT p.id, zn.name, zn.ord
  FROM crm_pipeline p
  JOIN clients c ON c.id = p.client_id
  CROSS JOIN LATERAL unnest(c.industrial_zones) WITH ORDINALITY AS zn(name, ord)
),
matched AS (
  SELECT o.pipeline_id, z.id AS zone_id, min(o.ord) AS ord
  FROM old_names o
  JOIN zone_keys z ON z.k <> '' AND z.k = pg_temp.lgvn_zone_key(o.zone_name)
  GROUP BY o.pipeline_id, z.id
),
per_entry AS (
  SELECT pipeline_id, array_agg(zone_id ORDER BY ord, zone_id) AS ids
  FROM matched GROUP BY pipeline_id
)
UPDATE crm_pipeline p SET zone_ids = e.ids
FROM per_entry e
WHERE p.id = e.pipeline_id AND p.zone_ids = '{}';

NOTIFY pgrst, 'reload schema';

-- Xem lại: KCN cũ dạng chữ KHÔNG khớp danh mục (không mất — chữ cũ vẫn nằm nguyên ở cột cũ).
-- Thường là tên chi nhánh ghi tạm, hoặc KCN chưa có trong Thị trường → Khu vực (thêm vào rồi chọn lại).
SELECT p.company_name AS cong_ty, o.zone_name AS kcn_cu_chua_khop
FROM (
  SELECT ml.crm_id AS pipeline_id, ml.region AS zone_name
  FROM market_leads ml
  WHERE ml.crm_id IS NOT NULL AND btrim(coalesce(ml.region, '')) <> ''
  UNION
  SELECT p2.id, zn.name
  FROM crm_pipeline p2
  JOIN clients c ON c.id = p2.client_id
  CROSS JOIN LATERAL unnest(c.industrial_zones) AS zn(name)
) o
JOIN crm_pipeline p ON p.id = o.pipeline_id
WHERE NOT EXISTS (
  SELECT 1 FROM market_zones z
  WHERE pg_temp.lgvn_zone_key(z.name) <> '' AND pg_temp.lgvn_zone_key(z.name) = pg_temp.lgvn_zone_key(o.zone_name)
)
ORDER BY 1, 2;

-- ── ROLLBACK (mất danh sách nhiều KCN đã chọn; KCN đầu tiên vẫn còn ở market_leads.region) ──
-- DROP INDEX IF EXISTS crm_pipeline_zone_ids_idx;
-- ALTER TABLE crm_pipeline DROP COLUMN IF EXISTS zone_ids;
