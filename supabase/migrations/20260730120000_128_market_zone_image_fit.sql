-- 128: Khu vực (KCN) — vị trí + chế độ hiển thị ảnh cover, cùng cơ chế đã có ở Đối thủ
-- (migration 114 + 116): image_pos_x/y cho kéo chỉnh object-position, image_fit cho chọn
-- 'cover' (lấp đầy, cắt ảnh) hoặc 'contain' (tự khớp, hiện toàn bộ ảnh).
alter table market_zones add column if not exists image_pos_x numeric not null default 50;
alter table market_zones add column if not exists image_pos_y numeric not null default 50;
alter table market_zones add column if not exists image_fit text default 'cover';

SELECT dh_attach_triggers();
