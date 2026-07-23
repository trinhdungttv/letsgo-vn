-- SĐT của sale/cộng tác viên phụ trách từng KH đang phục vụ của đối thủ
alter table competitor_clients add column if not exists sale_phone text;
