-- 140 — Mốc "cập nhật lần cuối" cho bảng chi tiết lương (Lương cơ bản, Ca 8h, Ca 12h...)
--
-- Lâu lâu mới vào xem lại nên cần biết ngay số liệu đã nhập còn mới hay cũ. Chỉ cần cho
-- clients/market_leads: NCC (trong market_suppliers/suppliers) không cần cột riêng vì mốc
-- nằm ngay trong phần tử JSON của mảng đó (wage_detail_updated_at/wage_detail_client_updated_at).
alter table clients add column if not exists wage_detail_updated_at timestamptz;
alter table clients add column if not exists wage_detail_client_updated_at timestamptz;
alter table market_leads add column if not exists wage_detail_updated_at timestamptz;
alter table market_leads add column if not exists wage_detail_client_updated_at timestamptz;

-- Đã có số liệu từ trước: coi như chốt tại thời điểm hiện tại (không biết mốc thật), còn hơn
-- để trống khiến hiện "chưa rõ" dù rõ ràng đã có người nhập.
update clients set wage_detail_updated_at = now()
  where wage_detail_updated_at is null and wage_detail is not null and wage_detail <> '{}'::jsonb;
update clients set wage_detail_client_updated_at = now()
  where wage_detail_client_updated_at is null and wage_detail_client is not null and wage_detail_client <> '{}'::jsonb;
update market_leads set wage_detail_updated_at = now()
  where wage_detail_updated_at is null and wage_detail is not null and wage_detail <> '{}'::jsonb;
update market_leads set wage_detail_client_updated_at = now()
  where wage_detail_client_updated_at is null and wage_detail_client is not null and wage_detail_client <> '{}'::jsonb;
