-- ============================================================================
-- 191 — Bỏ mã băm mật khẩu người dùng khỏi "Lịch sử dữ liệu" (data_history)
-- ----------------------------------------------------------------------------
-- Vì sao: data_history đọc được bằng anon key (migration 090 — khoá này nằm sẵn trong file JS của app). Trigger
-- dh_track gắn trên app_users từ 090 nên MỖI lần thêm / sửa người dùng, cả dòng — kể cả cột password (mã băm
-- bcrypt) — bị chép vào data_history. Migration 060 đã chặn đọc cột password trực tiếp, nhưng bản sao trong lịch
-- sử thì ai có anon key cũng đọc được, rồi đem đi dò mật khẩu yếu.
--
-- Làm gì:
--   1. Gỡ trigger dh_track khỏi app_users → từ nay không chép người dùng vào data_history nữa.
--      Thêm / sửa / khoá người dùng qua màn Quản lý người dùng VẪN được ghi ở audit_logs (không kèm mật khẩu).
--      "Cỗ máy thời gian" cũng không còn nhận bảng Người dùng — trước đây dùng nó cho bảng này rất nguy hiểm: nó
--      XOÁ rồi chèn lại dòng người dùng (xoá kéo theo dữ liệu nối ON DELETE CASCADE, VD kcn_visits).
--      Không chỉ cắt cột password khỏi lịch sử mà gỡ hẳn: cắt cột thì cỗ máy thời gian khôi phục người dùng sẽ ra
--      mật khẩu rỗng → người đó không đăng nhập được.
--   2. Bỏ cột password khỏi các bản sao CŨ trong data_history (chỉ dòng của app_users). Các thay đổi khác (tên, vai
--      trò, khoá / mở…) giữ nguyên để vẫn xem lại được; thay đổi có mật khẩu thì hiện cột "password (đã ẩn)".
--
-- Có mất dữ liệu không? Mật khẩu thật của người dùng KHÔNG đổi (nằm ở app_users, không đụng tới), không ai bị đăng
-- xuất. Chỉ mất bản sao mã băm mật khẩu trong lịch sử (bước 2, không hoàn tác được — đó chính là thứ cần bỏ).
-- Chạy lại nhiều lần vẫn an toàn. Hàm dh_attach_triggers() bản sửa ở 185 đã bỏ qua app_users, nên các migration
-- sau gọi hàm đó cũng không gắn lại.
-- ============================================================================

-- 1) Ngừng chép người dùng vào lịch sử
DROP TRIGGER IF EXISTS dh_track ON app_users;

-- 2) Bỏ mã băm khỏi các bản sao cũ
UPDATE data_history
SET old_data = CASE WHEN old_data ? 'password' THEN old_data - 'password' ELSE old_data END,
    new_data = CASE WHEN new_data ? 'password' THEN new_data - 'password' ELSE new_data END,
    changed_fields = CASE WHEN 'password' = ANY (changed_fields)
                          THEN array_replace(changed_fields, 'password', 'password (đã ẩn)')
                          ELSE changed_fields END
WHERE table_name = 'app_users'
  AND (old_data ? 'password' OR new_data ? 'password' OR 'password' = ANY (changed_fields));

-- ── Kiểm tra sau khi chạy (mong đợi: false · 0) ─────────────────────────────
-- SELECT
--   EXISTS (SELECT 1 FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
--           WHERE tg.tgname = 'dh_track' AND c.relname = 'app_users') AS con_trigger_nguoi_dung,
--   (SELECT count(*) FROM data_history
--    WHERE table_name = 'app_users' AND (old_data ? 'password' OR new_data ? 'password')) AS con_ma_bam_trong_lich_su;

-- ── ROLLBACK (chỉ bước 1; mã băm đã bỏ ở bước 2 không lấy lại được) ─────────
-- CREATE TRIGGER dh_track AFTER INSERT OR UPDATE OR DELETE ON app_users FOR EACH ROW EXECUTE FUNCTION dh_log_change();
