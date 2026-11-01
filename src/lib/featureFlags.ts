// Cờ bật/tắt module. Tắt = ẩn khỏi giao diện (menu, trang, quyền, link) — KHÔNG xoá code, KHÔNG đụng dữ liệu.
// Bật lại: đổi giá trị thành true rồi build/deploy lại là xong (không cần migration).

/**
 * Tuyển dụng (Dự án Co-Herent): trang `recruit`, mục "Tuyển dụng" trong menu, dòng quyền trong Admin và
 * form ứng tuyển công khai #/apply/<mã>. Tắt 01/11/2026 vì Tony không dùng — dữ liệu ứng viên
 * (migration 180–183, khoá RLS + recruit_rpc) vẫn còn nguyên trên Supabase.
 */
export const RECRUIT_ENABLED = false;
