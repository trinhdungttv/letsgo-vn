-- Lịch mùa vụ ngành — mức nhu cầu lao động theo 12 tháng (1 = rất thấp … 5 = cao điểm, 0/null = chưa nhập)
-- Mảng luôn dài 12 phần tử, index 0 = tháng 1.
alter table industries add column if not exists season_levels smallint[] default '{0,0,0,0,0,0,0,0,0,0,0,0}';
alter table industries add column if not exists season_notes text[] default '{"","","","","","","","","","","",""}';
