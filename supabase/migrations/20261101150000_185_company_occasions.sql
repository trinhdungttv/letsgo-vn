-- ============================================================================
-- 185 — Ngày lễ & kỷ niệm của CÔNG TY khách hàng + ngày lễ theo quốc gia người đứng đầu
-- ----------------------------------------------------------------------------
-- Nhập nhanh ở module Khách hàng (nút "Ngày lễ KH"), hiện + nhắc ở CSKH (Sự kiện & Quà,
-- Dashboard "Sắp tới", popup khi mở app: trước 2 ngày + đúng ngày).
--
--   clients.leader_country   quốc gia của người đứng đầu công ty ('Hàn Quốc', 'Nhật Bản'…)
--                            NULL = chưa rõ. Khớp national_holidays.country theo tên.
--   client_occasions         ngày riêng của từng công ty: thành lập, kỷ niệm, ngày lễ/nghỉ
--                            riêng của công ty… (dương hoặc âm lịch, năm nếu biết)
--   national_holidays        danh mục ngày lễ theo quốc gia — sửa 1 lần áp cho MỌI công ty
--                            có người đứng đầu nước đó. Chỉ ngày cố định (dương hoặc âm lịch);
--                            lễ đổi ngày theo thứ (Lễ Tạ ơn Mỹ…) chưa hỗ trợ.
--
-- Có mất dữ liệu hiện có không? KHÔNG.
--   • clients: chỉ ADD COLUMN leader_country (NULL) — không dòng nào bị sửa.
--   • 2 bảng mới, nạp sẵn ~40 ngày lễ cho 10 quốc gia (chạy lại không nạp trùng, ngày lễ
--     anh đã xoá (is_archived) cũng không bị nạp lại).
--   • client_occasions.client_id ON DELETE CASCADE: chỉ khi XOÁ VĨNH VIỄN công ty ở Lưu trữ
--     (đã có trong bảng "sẽ mất những gì" của clientPurge) — lưu trữ mềm thì không mất.
-- Rollback được: xem cuối file. Chạy lại nhiều lần vẫn an toàn.
-- ============================================================================

ALTER TABLE clients ADD COLUMN IF NOT EXISTS leader_country text;

-- ── Ngày riêng của công ty ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS client_occasions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  -- founding = ngày thành lập · anniversary = kỷ niệm (khánh thành nhà máy, hợp tác…)
  -- holiday = ngày lễ / nghỉ riêng của công ty · other = khác
  kind        text NOT NULL DEFAULT 'anniversary'
              CHECK (kind IN ('founding', 'anniversary', 'holiday', 'other')),
  title       text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  day         smallint NOT NULL CHECK (day BETWEEN 1 AND 31),
  month       smallint NOT NULL CHECK (month BETWEEN 1 AND 12),
  year        integer CHECK (year IS NULL OR year BETWEEN 1800 AND 2200),
  is_lunar    boolean NOT NULL DEFAULT false,
  note        text NOT NULL DEFAULT '',
  created_by  uuid,          -- app_users.id người nhập (không FK, giống cskh_groups)
  is_archived boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_occasions_client_idx ON client_occasions (client_id) WHERE NOT is_archived;
-- Mỗi công ty 1 ngày thành lập đang dùng (form nhập nhanh có 1 ô riêng cho ngày này)
CREATE UNIQUE INDEX IF NOT EXISTS client_occasions_founding_uq
  ON client_occasions (client_id) WHERE kind = 'founding' AND NOT is_archived;

-- ── Danh mục ngày lễ theo quốc gia ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS national_holidays (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country     text NOT NULL CHECK (length(btrim(country)) BETWEEN 1 AND 60),
  title       text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  local_name  text NOT NULL DEFAULT '',   -- tên tiếng bản địa (설날, お盆…) để chúc cho đúng
  day         smallint NOT NULL CHECK (day BETWEEN 1 AND 31),
  month       smallint NOT NULL CHECK (month BETWEEN 1 AND 12),
  is_lunar    boolean NOT NULL DEFAULT false,
  tip         text NOT NULL DEFAULT '',   -- gợi ý chăm sóc: nghỉ mấy ngày, nên tặng gì…
  is_archived boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS national_holidays_uq
  ON national_holidays (lower(btrim(country)), lower(btrim(title))) WHERE NOT is_archived;

-- updated_at tự cập nhật (hàm có từ migration 168; tạo lại phòng DB chưa có)
CREATE OR REPLACE FUNCTION cskh_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_client_occasions_touch ON client_occasions;
CREATE TRIGGER trg_client_occasions_touch
  BEFORE UPDATE ON client_occasions
  FOR EACH ROW EXECUTE FUNCTION cskh_touch_updated_at();

DROP TRIGGER IF EXISTS trg_national_holidays_touch ON national_holidays;
CREATE TRIGGER trg_national_holidays_touch
  BEFORE UPDATE ON national_holidays
  FOR EACH ROW EXECUTE FUNCTION cskh_touch_updated_at();

-- Quy ước LetsGo: app chạy role anon (session token riêng) → mở cho anon + authenticated
ALTER TABLE client_occasions ENABLE ROW LEVEL SECURITY;
ALTER TABLE national_holidays ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'client_occasions' AND policyname = 'client_occasions_all_anon') THEN
    CREATE POLICY "client_occasions_all_anon" ON client_occasions FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'client_occasions' AND policyname = 'client_occasions_all_auth') THEN
    CREATE POLICY "client_occasions_all_auth" ON client_occasions FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'national_holidays' AND policyname = 'national_holidays_all_anon') THEN
    CREATE POLICY "national_holidays_all_anon" ON national_holidays FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'national_holidays' AND policyname = 'national_holidays_all_auth') THEN
    CREATE POLICY "national_holidays_all_auth" ON national_holidays FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ── Nạp sẵn ngày lễ quan trọng (sửa / thêm / xoá được trong app) ────────────
-- Âm lịch tính theo lịch Việt Nam (GMT+7) — trùng lịch Trung/Hàn gần như mọi năm.
INSERT INTO national_holidays (country, title, local_name, day, month, is_lunar, tip)
SELECT v.country, v.title, v.local_name, v.day, v.month, v.is_lunar, v.tip
FROM (VALUES
  ('Hàn Quốc', 'Tết Seollal (Tết Âm lịch)', '설날', 1, 1, true, 'Nghỉ 3 ngày (trước, đúng, sau mùng 1). Gửi lời chúc + quà Tết trước kỳ nghỉ.'),
  ('Hàn Quốc', 'Tết Chuseok (Trung thu)', '추석', 15, 8, true, 'Lễ lớn nhất năm, nghỉ 3 ngày. Tặng hộp quà Chuseok trước kỳ nghỉ khoảng 1 tuần.'),
  ('Hàn Quốc', 'Ngày Giải phóng', '광복절', 15, 8, false, 'Chúc mừng ngắn gọn.'),
  ('Hàn Quốc', 'Ngày Lập quốc', '개천절', 3, 10, false, 'Chúc mừng ngắn gọn.'),
  ('Nhật Bản', 'Tết Shōgatsu (Năm mới)', '正月', 1, 1, false, 'Nghỉ khoảng 29/12 – 3/1. Gửi thiệp năm mới (nengajō) đến đúng 1/1.'),
  ('Nhật Bản', 'Ngày Quốc khánh', '建国記念の日', 11, 2, false, 'Chúc mừng ngắn gọn.'),
  ('Nhật Bản', 'Tuần lễ vàng (Golden Week)', 'ゴールデンウィーク', 29, 4, false, 'Nghỉ dài 29/4 – 5/5, tránh hẹn họp, chốt việc trước.'),
  ('Nhật Bản', 'Mùa quà Ochūgen (giữa năm)', 'お中元', 1, 7, false, 'Tặng quà cảm ơn khách đầu – giữa tháng 7.'),
  ('Nhật Bản', 'Lễ Obon', 'お盆', 13, 8, false, 'Nghỉ khoảng 13 – 16/8.'),
  ('Nhật Bản', 'Mùa quà Oseibo (cuối năm)', 'お歳暮', 1, 12, false, 'Tặng quà tri ân cuối năm, từ đầu tháng đến khoảng 20/12.'),
  ('Trung Quốc', 'Tết Xuân (Tết Âm lịch)', '春节', 1, 1, true, 'Nghỉ khoảng 7 ngày. Lì xì / quà Tết trước kỳ nghỉ.'),
  ('Trung Quốc', 'Tết Đoan Ngọ', '端午节', 5, 5, true, 'Có thể tặng bánh ú (zongzi).'),
  ('Trung Quốc', 'Tết Trung thu', '中秋节', 15, 8, true, 'Tặng bánh trung thu trước 1 – 2 tuần.'),
  ('Trung Quốc', 'Quốc khánh', '国庆节', 1, 10, false, 'Tuần lễ vàng 1 – 7/10, tránh hẹn họp.'),
  ('Đài Loan', 'Tết Xuân (Tết Âm lịch)', '春節', 1, 1, true, 'Nghỉ dài. Quà Tết trước kỳ nghỉ.'),
  ('Đài Loan', 'Tết Đoan Ngọ', '端午節', 5, 5, true, 'Có thể tặng bánh ú.'),
  ('Đài Loan', 'Tết Trung thu', '中秋節', 15, 8, true, 'Tặng bánh trung thu / hộp quà.'),
  ('Đài Loan', 'Quốc khánh Song Thập', '雙十節', 10, 10, false, 'Chúc mừng ngắn gọn.'),
  ('Hồng Kông', 'Tết Âm lịch', '農曆新年', 1, 1, true, 'Lì xì / quà Tết trước kỳ nghỉ.'),
  ('Hồng Kông', 'Tết Trung thu', '中秋節', 15, 8, true, 'Tặng bánh trung thu.'),
  ('Hồng Kông', 'Ngày thành lập Đặc khu', '香港特區成立紀念日', 1, 7, false, 'Chúc mừng ngắn gọn.'),
  ('Singapore', 'Tết Âm lịch', 'Chinese New Year', 1, 1, true, 'Quà Tết (cam / hộp quà) trước kỳ nghỉ.'),
  ('Singapore', 'Quốc khánh', 'National Day', 9, 8, false, 'Chúc mừng ngắn gọn.'),
  ('Thái Lan', 'Tết Songkran', 'สงกรานต์', 13, 4, false, 'Nghỉ 13 – 15/4. Gửi lời chúc năm mới Thái.'),
  ('Thái Lan', 'Sinh nhật Nhà vua', 'วันเฉลิมพระชนมพรรษา', 28, 7, false, 'Chúc mừng trang trọng.'),
  ('Thái Lan', 'Quốc khánh (Ngày của Cha)', 'วันชาติ', 5, 12, false, 'Chúc mừng ngắn gọn.'),
  ('Mỹ', 'Năm mới', 'New Year''s Day', 1, 1, false, 'Gửi lời chúc năm mới.'),
  ('Mỹ', 'Ngày Độc lập', 'Independence Day', 4, 7, false, 'Chúc mừng ngắn gọn.'),
  ('Mỹ', 'Giáng sinh', 'Christmas', 25, 12, false, 'Gửi thiệp / quà cuối năm trước 20/12.'),
  ('Đức', 'Năm mới', 'Neujahr', 1, 1, false, 'Gửi lời chúc năm mới.'),
  ('Đức', 'Ngày Thống nhất nước Đức', 'Tag der Deutschen Einheit', 3, 10, false, 'Chúc mừng ngắn gọn.'),
  ('Đức', 'Giáng sinh', 'Weihnachten', 25, 12, false, 'Gửi thiệp / quà cuối năm trước 20/12.'),
  ('Việt Nam', 'Tết Nguyên Đán', 'Tết', 1, 1, true, 'Quà Tết cho khách, gửi trước kỳ nghỉ.'),
  ('Việt Nam', 'Ngày Doanh nhân Việt Nam', '13/10', 13, 10, false, 'Chúc mừng ban lãnh đạo công ty.'),
  ('Việt Nam', 'Tết Trung thu', 'Trung thu', 15, 8, true, 'Tặng bánh trung thu trước 1 – 2 tuần.'),
  ('Việt Nam', 'Quốc khánh', '2/9', 2, 9, false, 'Chúc mừng ngắn gọn.')
) AS v(country, title, local_name, day, month, is_lunar, tip)
WHERE NOT EXISTS (
  SELECT 1 FROM national_holidays h
  WHERE lower(btrim(h.country)) = lower(v.country) AND lower(btrim(h.title)) = lower(v.title)
);

-- Gắn trigger "Lịch sử dữ liệu" (data_history) cho bảng mới
SELECT dh_attach_triggers();

-- ── Kiểm tra sau khi chạy (mong đợi: true · 2 · ≥ 36) ──────────────────────
-- SELECT
--   EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'clients' AND column_name = 'leader_country') AS co_cot_quoc_gia,
--   (SELECT count(*) FROM information_schema.tables WHERE table_name IN ('client_occasions', 'national_holidays')) AS so_bang_moi,
--   (SELECT count(*) FROM national_holidays) AS so_ngay_le;

-- ── ROLLBACK (chỉ chạy khi cần gỡ) ──────────────────────────────────────────
-- Mất: mọi ngày lễ / kỷ niệm công ty, danh mục ngày lễ quốc gia, quốc gia người đứng đầu đã nhập.
-- DROP TABLE IF EXISTS client_occasions;
-- DROP TABLE IF EXISTS national_holidays;
-- ALTER TABLE clients DROP COLUMN IF EXISTS leader_country;
