-- Đối thủ: thêm số điện thoại liên hệ của Giám đốc/người phụ trách (cho phép tối đa 2 số)
alter table competitors add column if not exists director_phone text;
alter table competitors add column if not exists director_phone2 text;
