-- Hồ sơ giữ chân lao động: chọn nhiều giai đoạn hay nghỉ + ghi chú chi tiết cho từng lý do nghỉ.
-- Cột quit_stage (1 giai đoạn) vẫn giữ lại, luôn được ghi bằng giai đoạn đầu tiên trong quit_stages
-- để dữ liệu/báo cáo cũ không vỡ.

alter table industries add column if not exists quit_stages text[] default '{}';
-- map { "<tên lý do>": "<ghi chú chi tiết>" }, hiện dạng tooltip khi rê chuột vào chip lý do
alter table industries add column if not exists quit_reason_notes jsonb default '{}'::jsonb;

-- Chuyển giai đoạn đã nhập trước đây thành phần tử đầu của mảng mới
update industries
   set quit_stages = array[quit_stage]
 where quit_stage is not null
   and btrim(quit_stage) <> ''
   and coalesce(cardinality(quit_stages), 0) = 0;
