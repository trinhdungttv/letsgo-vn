-- Ô tổng quan cho mỗi cột trong Chuỗi giá trị ngành (Đầu vào / Khách của khách / Thị trường cuối).
-- Mặc định ẩn trên UI, gắn thẳng vào industries vì mỗi ngành chỉ có 1 bộ tổng quan.

alter table industries add column if not exists value_chain_input_summary text;
alter table industries add column if not exists value_chain_customer_summary text;
alter table industries add column if not exists value_chain_market_summary text;
