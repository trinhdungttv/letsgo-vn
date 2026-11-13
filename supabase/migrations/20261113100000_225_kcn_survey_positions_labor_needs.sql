-- ============================================================================
-- 225 — Khảo sát KCN: DANH MỤC NGÀNH NGHỀ (sửa được) + NHU CẦU CUNG ỨNG / GIỚI THIỆU trên ảnh chỉ tiêu
-- Chạy tay trong Supabase → SQL Editor. Chạy lại nhiều lần vẫn an toàn (idempotent).
--
-- (1) kcn_survey_positions — danh mục ngành nghề / vị trí tuyển dùng chung cho ô "Ngành nghề" khi chụp & xem lại ảnh.
--     Trước đây danh sách này viết cứng trong app; nay đổi tên / thêm / bỏ được ngay trong trình xem ảnh.
--     Ảnh vẫn lưu ngành dạng CHỮ (cột positions cũ, cách nhau dấu phẩy) → đổi tên 1 ngành thì app sửa luôn chữ
--     trên các ảnh đang chọn ngành đó (người dùng chọn lại được cho từng công ty trước khi lưu).
--     Lần chạy đầu: nạp sẵn 22 ngành app đang dùng (chỉ nạp khi bảng còn trống — chạy lại không nạp lại ngành đã đổi tên/bỏ).
-- (2) kcn_survey_photos.labor_needs text[] — công ty cần gì: 'cung_ung' | 'gioi_thieu' (nhu cầu) và
--     'thoi_vu' | 'chinh_thuc' (hình thức); chọn cả 2 trong 1 nhóm = cần cả hai. Dùng để lọc nhanh ở tab Khảo sát KCN.
--
-- Có mất / đổi dữ liệu hiện có không? KHÔNG — chỉ TẠO 1 bảng mới + THÊM 1 cột (mặc định rỗng). Không sửa dòng ảnh nào.
-- Bỏ ngành khỏi danh mục trong app = xoá MỀM (deleted_at), dòng vẫn còn.
-- Không khoá ngoại (bài học PGRST201). Lịch sử dữ liệu: gắn dh_track RIÊNG bảng mới (không gọi dh_attach_triggers()).
-- ============================================================================

-- ── (1) Danh mục ngành nghề ──
CREATE TABLE IF NOT EXISTS kcn_survey_positions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  sort        integer NOT NULL DEFAULT 0,
  created_by  text NOT NULL DEFAULT '',
  updated_by  text NOT NULL DEFAULT '',
  deleted_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
-- Không trùng tên trong các ngành đang dùng (ngành đã bỏ thì thêm lại cùng tên được)
CREATE UNIQUE INDEX IF NOT EXISTS kcn_survey_positions_name_uniq ON kcn_survey_positions (lower(btrim(name))) WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION kcn_survey_positions_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_kcn_survey_positions_touch ON kcn_survey_positions;
CREATE TRIGGER trg_kcn_survey_positions_touch BEFORE UPDATE ON kcn_survey_positions
  FOR EACH ROW EXECUTE FUNCTION kcn_survey_positions_touch_updated_at();

-- Quyền: giống các bảng khảo sát khác (app chạy anon)
ALTER TABLE kcn_survey_positions ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'kcn_survey_positions' AND policyname = 'kcn_survey_positions_all_' || r) THEN
      EXECUTE format('CREATE POLICY %I ON kcn_survey_positions FOR ALL TO %I USING (true) WITH CHECK (true)', 'kcn_survey_positions_all_' || r, r);
    END IF;
  END LOOP;
END $$;

-- Nạp sẵn danh sách app đang dùng — CHỈ khi bảng còn trống
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM kcn_survey_positions) THEN
    INSERT INTO kcn_survey_positions (name, sort, created_by)
    SELECT v.name, v.ord * 10, 'migration 225'
    FROM unnest(ARRAY[
      'Công nhân may', 'Điện tử', 'Gỗ / nội thất', 'Giày da', 'Nhựa / bao bì', 'Thực phẩm', 'Cơ khí', 'Thợ may', 'Thợ hàn',
      'Thợ cơ khí / tiện / phay', 'Thợ điện', 'Công nhân sản xuất', 'Công nhân đóng gói', 'Kỹ thuật / bảo trì', 'QC / kiểm hàng',
      'Kho / xuất nhập', 'Lái xe nâng', 'Bảo vệ', 'Tạp vụ / nấu ăn', 'Phiên dịch', 'Văn phòng / kế toán', 'Tuyển nhiều vị trí'
    ]) WITH ORDINALITY AS v(name, ord);
  END IF;
END $$;

-- Lịch sử dữ liệu (cỗ máy thời gian + chặn ghi của vai trò chỉ xem) — gắn riêng bảng này
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'dh_log_change') THEN
    EXECUTE 'DROP TRIGGER IF EXISTS dh_track ON kcn_survey_positions';
    EXECUTE 'CREATE TRIGGER dh_track AFTER INSERT OR UPDATE OR DELETE ON kcn_survey_positions FOR EACH ROW EXECUTE FUNCTION dh_log_change()';
  END IF;
END $$;

COMMENT ON TABLE kcn_survey_positions IS 'Danh mục ngành nghề / vị trí tuyển cho ảnh chỉ tiêu khảo sát KCN (ảnh lưu ngành dạng chữ ở kcn_survey_photos.positions). Xoá mềm bằng deleted_at.';

-- ── (2) Nhu cầu cung ứng / giới thiệu trên ảnh chỉ tiêu ──
ALTER TABLE kcn_survey_photos ADD COLUMN IF NOT EXISTS labor_needs text[] NOT NULL DEFAULT '{}';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kcn_survey_photos_labor_needs_check') THEN
    ALTER TABLE kcn_survey_photos ADD CONSTRAINT kcn_survey_photos_labor_needs_check
      CHECK (labor_needs <@ ARRAY['cung_ung', 'gioi_thieu', 'thoi_vu', 'chinh_thuc']::text[]);
  END IF;
END $$;

COMMENT ON COLUMN kcn_survey_photos.labor_needs IS 'Công ty cần: cung_ung / gioi_thieu (nhu cầu), thoi_vu / chinh_thuc (hình thức). Rỗng = chưa ghi.';

-- Báo PostgREST nạp lại cấu trúc bảng ngay (không phải chờ)
NOTIFY pgrst, 'reload schema';
