-- ─────────────────────────────────────────────────────────────────────────────
-- 138 — Chi nhánh: một nguồn dữ liệu duy nhất (branch_id), bỏ tên chi nhánh cũ
--
-- VẤN ĐỀ:
--   Toàn hệ thống đang nối Khách hàng ↔ Chi nhánh bằng CHUỖI TEXT:
--   clients.region  ==  branches.region. Mà branches.region chính là TÊN CŨ
--   ("BH - Ms Thương", "MR Hùng Black"...), khác với tên chuẩn branches.name
--   ("Biên Hoà - Ms Thương", "LGV - Bầu Bàng"...). Vì tên cũ đang làm khoá nối
--   nên không thể xoá nó khỏi giao diện — nó rò rỉ ra mọi dropdown, mọi báo cáo.
--
--   Hệ quả đo được trên dữ liệu thật trước migration này:
--     clients.region                    80 dòng — 16 dòng không khớp chi nhánh nào
--     crm_pipeline.region               25 dòng —  4 dòng không khớp
--     branch_overhead.branch_manager    35 dòng —  5 dòng mồ côi, KHÔNG hiện ở đâu
--     client_branch_history.branch_name  1 dòng
--   Thêm nữa, 2 chi nhánh (TTV Nhơn Trạch, Vũng Tàu) có region rỗng nên không
--   thể nối với khách hàng nào qua cơ chế cũ.
--
-- THAY ĐỔI:
--   Thêm cột branch_id (khoá ngoại thật tới branches.id) vào 4 bảng trên và
--   backfill từ chuỗi text đang có. Từ đây branch_id là nguồn dữ liệu duy nhất;
--   giao diện chỉ còn hiển thị branches.name.
--
-- KHÔNG XOÁ GÌ:
--   Các cột text cũ (clients.region, crm_pipeline.region,
--   branch_overhead.branch_manager, client_branch_history.branch_name) được GIỮ
--   NGUYÊN. Migration này chỉ thêm cột và ghi giá trị mới — không UPDATE đè lên
--   cột cũ, không DROP COLUMN, không xoá dòng nào. Nếu backfill sai, dữ liệu gốc
--   vẫn còn nguyên để đối chiếu và chạy lại.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Thêm cột ────────────────────────────────────────────────────────────────
ALTER TABLE clients               ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES branches(id) ON DELETE SET NULL;
ALTER TABLE crm_pipeline          ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES branches(id) ON DELETE SET NULL;
ALTER TABLE branch_overhead       ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES branches(id) ON DELETE SET NULL;
ALTER TABLE client_branch_history ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES branches(id) ON DELETE SET NULL;
ALTER TABLE projects_pnl          ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES branches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_clients_branch               ON clients(branch_id);
CREATE INDEX IF NOT EXISTS idx_crm_pipeline_branch          ON crm_pipeline(branch_id);
CREATE INDEX IF NOT EXISTS idx_branch_overhead_branch       ON branch_overhead(branch_id);
CREATE INDEX IF NOT EXISTS idx_client_branch_history_branch ON client_branch_history(branch_id);
CREATE INDEX IF NOT EXISTS idx_projects_pnl_branch          ON projects_pnl(branch_id);

COMMENT ON COLUMN clients.branch_id IS 'Chi nhánh phụ trách. Nguồn dữ liệu duy nhất — thay cho cột region (text, tên cũ) đã lỗi thời.';
COMMENT ON COLUMN clients.region    IS 'LỖI THỜI — giữ lại để đối chiếu lịch sử. Dùng branch_id. Không đọc cột này để hiển thị.';

-- 2. Bảng tra cứu: mọi chuỗi từng dùng để chỉ 1 chi nhánh → branch_id ────────
--    Ưu tiên 1=region (khoá cũ phổ biến nhất) → 2=name → 3=short_name → 4=alias
--    thủ công. So khớp không phân biệt hoa/thường và khoảng trắng thừa.
DROP TABLE IF EXISTS _branch_key;
CREATE TEMP TABLE _branch_key(key text PRIMARY KEY, branch_id uuid NOT NULL);

INSERT INTO _branch_key(key, branch_id)
SELECT DISTINCT ON (key) key, id FROM (
  SELECT lower(btrim(b.region)),     b.id, 1 AS pri FROM branches b WHERE btrim(coalesce(b.region, ''))     <> ''
  UNION ALL
  SELECT lower(btrim(b.name)),       b.id, 2        FROM branches b WHERE btrim(coalesce(b.name, ''))       <> ''
  UNION ALL
  SELECT lower(btrim(b.short_name)), b.id, 3        FROM branches b WHERE btrim(coalesce(b.short_name, '')) <> ''
  UNION ALL
  -- Alias thủ công: các giá trị viết tắt/thiếu tiền tố nhưng chỉ ứng với ĐÚNG 1
  -- chi nhánh nên map được chắc chắn. "Ms Thương" là tên quản lý, đang khoá 5
  -- dòng chi phí mồ côi trong branch_overhead.
  SELECT lower(btrim(a.txt)), b.id, 4 FROM (VALUES
      ('VSIP',          'LGV - VSIP'),
      ('Dầu Giây',      'LGV - Dầu Giây'),
      ('BD - Bầu Bàng', 'LGV - Bầu Bàng'),
      ('Ms Thương',     'Biên Hoà - Ms Thương')
    ) AS a(txt, bname)
    JOIN branches b ON btrim(b.name) = a.bname
) s(key, id, pri)
ORDER BY key, pri;

-- CỐ Ý KHÔNG map (mơ hồ — gán bừa sẽ làm sai quy kết doanh thu/chi phí):
--   'Biên Hòa' (6 KH), 'Bien Hoa' (3 KH), 'BIÊN HOÀ 2'  → có 3 chi nhánh Biên Hoà
--   'Bình Dương' (2 KH)                                 → có 4 chi nhánh Bình Dương
--   'Tràng Duệ' (1 KH)                                  → không có chi nhánh tương ứng
-- Các dòng này để branch_id = NULL và hiện cảnh báo "Chưa gán chi nhánh" trên
-- giao diện để người dùng tự chọn.

-- 3. Backfill ────────────────────────────────────────────────────────────────
UPDATE clients c SET branch_id = k.branch_id
FROM _branch_key k WHERE lower(btrim(c.region)) = k.key AND c.branch_id IS NULL;

UPDATE crm_pipeline p SET branch_id = k.branch_id
FROM _branch_key k WHERE lower(btrim(p.region)) = k.key AND p.branch_id IS NULL;

UPDATE branch_overhead o SET branch_id = k.branch_id
FROM _branch_key k WHERE lower(btrim(o.branch_manager)) = k.key AND o.branch_id IS NULL;

UPDATE client_branch_history h SET branch_id = k.branch_id
FROM _branch_key k WHERE lower(btrim(h.branch_name)) = k.key AND h.branch_id IS NULL;

UPDATE projects_pnl p SET branch_id = k.branch_id
FROM _branch_key k WHERE lower(btrim(p.branch_manager)) = k.key AND p.branch_id IS NULL;

DROP TABLE _branch_key;

-- 4. Đối chiếu — chạy xong xem kết quả ở đây ─────────────────────────────────
SELECT 'clients'               AS bang, count(*) FILTER (WHERE branch_id IS NOT NULL) AS da_gan,
       count(*) FILTER (WHERE branch_id IS NULL) AS chua_gan, count(*) AS tong FROM clients
UNION ALL SELECT 'crm_pipeline',          count(*) FILTER (WHERE branch_id IS NOT NULL),
       count(*) FILTER (WHERE branch_id IS NULL), count(*) FROM crm_pipeline
UNION ALL SELECT 'branch_overhead',       count(*) FILTER (WHERE branch_id IS NOT NULL),
       count(*) FILTER (WHERE branch_id IS NULL), count(*) FROM branch_overhead
UNION ALL SELECT 'client_branch_history', count(*) FILTER (WHERE branch_id IS NOT NULL),
       count(*) FILTER (WHERE branch_id IS NULL), count(*) FROM client_branch_history;
