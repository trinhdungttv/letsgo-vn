-- Chế độ hiển thị ảnh cover đối thủ: 'cover' (lấp đầy, cắt ảnh) hoặc 'contain' (tự khớp, hiện toàn bộ ảnh)
alter table competitors add column if not exists image_fit text default 'cover';
