-- ============================================================================
-- 198 — XẾP SAO công ty khách hàng (mức ưu tiên chăm sóc)
-- Chạy tay trong Supabase → SQL Editor. Chạy lại nhiều lần vẫn an toàn (idempotent).
--
--   clients.star_rating   3 = Quan trọng · 2 = Bình thường · 1 = Dự án nhỏ (có thể thay thế)
--                         NULL = chưa xếp sao.
--
-- Gán sao ở trang Khách hàng (bảng / thẻ / hồ sơ công ty). CSKH KHÔNG lưu sao riêng: sao của người
-- liên hệ = sao CAO NHẤT trong các công ty người đó gắn (contact_clients) → đổi sao công ty là bộ lọc
-- sao bên CSKH đổi theo ngay, không phải sửa 2 chỗ.
--
-- Chưa chạy migration này: app vẫn mở bình thường, mọi công ty hiện "chưa xếp sao", bấm gán sao sẽ
-- báo "chưa chạy migration 198".
--
-- Có mất / đổi dữ liệu hiện có không? KHÔNG — chỉ THÊM 1 cột (để trống với mọi công ty hiện có),
-- 1 ràng buộc giá trị 1–3 và 1 dòng chú thích. Không xoá, không sửa dòng nào.
-- Lịch sử dữ liệu: bảng clients đã có trigger dh_track từ trước → đổi sao tự ghi lịch sử, không cần thêm.
-- ============================================================================

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS star_rating smallint;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'clients_star_rating_range' AND conrelid = 'public.clients'::regclass
  ) THEN
    ALTER TABLE clients
      ADD CONSTRAINT clients_star_rating_range CHECK (star_rating IS NULL OR star_rating BETWEEN 1 AND 3);
  END IF;
END $$;

COMMENT ON COLUMN clients.star_rating IS
  'Xếp sao ưu tiên: 3 = Quan trọng, 2 = Bình thường, 1 = Dự án nhỏ (có thể thay thế), NULL = chưa xếp. CSKH lọc người liên hệ theo sao cao nhất của các công ty họ gắn.';

-- PostgREST nạp lại danh sách cột ngay (khỏi đợi)
NOTIFY pgrst, 'reload schema';

-- ── Kiểm tra sau khi chạy (tuỳ chọn) ───────────────────────────────────────
-- SELECT column_name, data_type FROM information_schema.columns
--  WHERE table_name = 'clients' AND column_name = 'star_rating';
--  → phải ra 1 dòng (smallint).

-- ── Rollback (chạy tay nếu cần bỏ — MẤT sao đã gán) ────────────────────────
-- ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_star_rating_range;
-- ALTER TABLE clients DROP COLUMN IF EXISTS star_rating;
