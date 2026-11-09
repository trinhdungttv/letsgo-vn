-- ============================================================================
-- 216 — THẺ ĐỐI THỦ CHO "ẢNH TUYỂN DỤNG" (CRM Pipeline → hồ sơ công ty → Thị trường). Chạy tay trong Supabase → SQL Editor.
-- Chạy lại nhiều lần vẫn an toàn.
--
--   clients.recruit_image_tags       jsonb  — mỗi ảnh tuyển dụng gắn được 1 hay nhiều đối thủ (Thị trường → Đối thủ)
--   market_leads.recruit_image_tags  jsonb    để biết ảnh đó của nhà cung ứng nào. Xếp SONG SONG với recruit_image_urls:
--        [ { "u": "<link ảnh>", "c": [ { "id": "<mã đối thủ>", "n": "<tên lúc gắn>" } ] }, … ]
--
-- Có mất / đổi dữ liệu hiện có không? KHÔNG — chỉ THÊM 1 cột mới (mặc định '[]') vào 2 bảng.
--   • Cột recruit_image_urls (danh sách link ảnh) GIỮ NGUYÊN, không đụng tới → ảnh cũ vẫn hiện bình thường, chỉ là "Chưa gắn đối thủ".
--   • Không sửa / xoá dòng nào. Không có khoá ngoại (bài học PGRST201) — mã đối thủ chỉ là chuỗi trong jsonb.
--   • Trigger lịch sử dữ liệu (dh_track) của clients / market_leads đã sẵn → đổi thẻ tự ghi lịch sử, không cần thêm gì.
-- Chưa chạy migration này: ảnh tuyển dụng vẫn xem / thêm / bỏ như thường; chỉ chưa gắn được thẻ đối thủ (app báo rõ).
-- ============================================================================

ALTER TABLE clients      ADD COLUMN IF NOT EXISTS recruit_image_tags jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE market_leads ADD COLUMN IF NOT EXISTS recruit_image_tags jsonb NOT NULL DEFAULT '[]'::jsonb;
