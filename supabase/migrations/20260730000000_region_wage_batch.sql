-- ═══════════════════════════════════════════════════════════════════════════════════════════
--  TEMPLATE — THÊM 1 LẦN NHẬP LƯƠNG TỐI THIỂU VÙNG THEO NGHỊ ĐỊNH MỚI
--  ⚠ FILE NÀY CHƯA CHẠY ĐƯỢC. CÒN PLACEHOLDER. KHÔNG PASTE NGUYÊN VÀO SQL EDITOR.
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
--  VÌ SAO ĐỂ TRỐNG: mức lương tối thiểu vùng là NGƯỠNG PHÁP LÝ. Điền sai thì hệ thống hoặc để
--  lọt mức lương đã vi phạm luật, hoặc chặn oan mức hợp lệ. Số phải do người vận hành tự đối
--  chiếu công báo rồi điền, không để công cụ tự suy.
--
--  CÁCH DÙNG
--  ─────────
--  1. Mở công báo / cổng thông tin Chính phủ, tra Nghị định đang có hiệu lực.
--  2. Thay TOÀN BỘ placeholder :name bên dưới bằng số thật. Tìm chuỗi ':' để chắc chắn
--     không sót placeholder nào — còn sót thì Postgres sẽ báo lỗi cú pháp, không âm thầm chèn sai.
--  3. Chạy trên Supabase SQL Editor.
--  4. Cập nhật MIN_WAGE_BATCHES trong src/lib/minWage.ts cho khớp (thêm phần tử MỚI, KHÔNG sửa
--     batch cũ — batch cũ vẫn cần để tra hợp đồng ký trước mốc này).
--
--  TRIGGER region_wage_batches_recompute_trg (migration 113) sẽ TỰ tính lại bảng region_wages
--  từ batch có hiệu lực gần nhất — KHÔNG cần UPDATE region_wages bằng tay.
--
--  ⚠ CẢNH BÁO GHI ĐÈ: câu INSERT dưới đây có ON CONFLICT (effective_date) DO UPDATE, nghĩa là
--  nếu đã tồn tại batch ĐÚNG ngày hiệu lực này thì số cũ của nó SẼ BỊ THAY. Muốn chắc chắn không
--  đè mất gì, chạy câu kiểm tra ở BƯỚC 0 trước.

-- ─── BƯỚC 0 — KIỂM TRA TRƯỚC KHI GHI (chạy riêng, đọc kết quả rồi mới chạy tiếp) ───────────
-- SELECT effective_date, wage_i, wage_ii, wage_iii, wage_iv, note
--   FROM region_wage_batches
--  ORDER BY effective_date DESC;


-- ─── BƯỚC 1 — (TUỲ CHỌN) THÊM CỘT MỨC GIỜ ─────────────────────────────────────────────────
-- Bảng region_wage_batches (migration 113) chỉ có mức THÁNG. Mức GIỜ cần cho việc kiểm tra sàn
-- theo giờ ở module "Tính bảng lương" (§4.6). Thêm cột dạng nullable để batch cũ không vỡ.
-- Bỏ qua bước này nếu chỉ muốn giữ mức giờ trong code (src/lib/minWage.ts).

ALTER TABLE region_wage_batches ADD COLUMN IF NOT EXISTS wage_i_hourly   numeric;
ALTER TABLE region_wage_batches ADD COLUMN IF NOT EXISTS wage_ii_hourly  numeric;
ALTER TABLE region_wage_batches ADD COLUMN IF NOT EXISTS wage_iii_hourly numeric;
ALTER TABLE region_wage_batches ADD COLUMN IF NOT EXISTS wage_iv_hourly  numeric;

COMMENT ON COLUMN region_wage_batches.wage_i_hourly IS
  'Mức lương tối thiểu GIỜ Vùng I. NULL = batch này không khai mức giờ, code sẽ lấy theo seed cùng mốc.';


-- ─── BƯỚC 2 — CHÈN BATCH MỚI ───────────────────────────────────────────────────────────────
-- TODO: thay :effective_date  → ngày hiệu lực của nghị định, dạng 'YYYY-MM-DD'
-- TODO: thay :decree_note     → số hiệu nghị định, vd 'NĐ xxx/20xx/NĐ-CP'
-- TODO: thay :monthly_I..IV   → mức lương tối thiểu THÁNG từng vùng (đồng, số nguyên, không dấu chấm)
-- TODO: thay :hourly_I..IV    → mức lương tối thiểu GIỜ từng vùng (đồng). Bỏ 4 cột này nếu đã bỏ BƯỚC 1.

INSERT INTO region_wage_batches (
  effective_date,
  wage_i,      wage_ii,      wage_iii,      wage_iv,
  wage_i_hourly, wage_ii_hourly, wage_iii_hourly, wage_iv_hourly,
  note
) VALUES (
  :effective_date,
  :monthly_I,  :monthly_II,  :monthly_III,  :monthly_IV,
  :hourly_I,   :hourly_II,   :hourly_III,   :hourly_IV,
  :decree_note
)
ON CONFLICT (effective_date) DO UPDATE SET
  wage_i           = EXCLUDED.wage_i,
  wage_ii          = EXCLUDED.wage_ii,
  wage_iii         = EXCLUDED.wage_iii,
  wage_iv          = EXCLUDED.wage_iv,
  wage_i_hourly    = EXCLUDED.wage_i_hourly,
  wage_ii_hourly   = EXCLUDED.wage_ii_hourly,
  wage_iii_hourly  = EXCLUDED.wage_iii_hourly,
  wage_iv_hourly   = EXCLUDED.wage_iv_hourly,
  note             = EXCLUDED.note;


-- ─── BƯỚC 3 — ĐỐI CHIẾU SAU KHI CHẠY ───────────────────────────────────────────────────────
-- region_wages phải khớp batch vừa chèn (nếu ngày hiệu lực <= hôm nay).
-- SELECT zone, wage_amount, effective_date FROM region_wages ORDER BY zone;
