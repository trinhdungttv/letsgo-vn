-- 141 — Ảnh cover cho Khách hàng (tỷ lệ 16:9), cùng cơ chế đã có ở Khu vực (migration 128)
-- và Đối thủ (migration 116): image_pos_x/y để kéo chỉnh object-position, image_fit để chọn
-- 'cover' (lấp đầy, cắt ảnh) hoặc 'contain' (tự khớp, hiện toàn bộ ảnh).
--
-- clients.map_link đã có sẵn từ migration 094 — không cần thêm cột Google Maps ở đây.
alter table clients add column if not exists cover_image_url text;
alter table clients add column if not exists cover_image_fit text default 'cover';
alter table clients add column if not exists cover_image_pos_x numeric not null default 50;
alter table clients add column if not exists cover_image_pos_y numeric not null default 50;
