-- Vùng lương tối thiểu (Vùng I–IV theo Nghị định của Chính phủ) cho từng KCN.
-- Mỗi khu công nghiệp nằm ở 1 vùng khác nhau nên lương tối thiểu vùng phải gắn riêng
-- theo từng KCN, không dùng chung 1 giá trị cho toàn hệ thống.
alter table market_zones add column if not exists region_zone text;
