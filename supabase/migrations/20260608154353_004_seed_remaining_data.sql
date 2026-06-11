-- DỮ LIỆU MẪU — TÀI CHÍNH T6/2026
INSERT INTO finance_records (client_id, month, revenue, cost_labor, cost_mgmt, cost_other, paid_status)
SELECT 
  id,
  '2026-06',
  ROUND((CAST(cutoff_day AS NUMERIC) * 850000 + 100000000) / 1000000) * 1000000,
  ROUND((CAST(cutoff_day AS NUMERIC) * 720000 + 80000000) / 1000000) * 1000000,
  5000000,
  2000000,
  paid_this_month
FROM clients;

-- DỮ LIỆU MẪU — CSKH LOG
INSERT INTO cskh_logs (client_name, contact_person, contact_type, content, followup, log_date)
VALUES
  ('Changshin VN',       'Ms. Hoa - HR',  'meeting',  'Thảo luận gia hạn HĐ Q3',     'Gửi HĐ ngày 10/06',  '2026-06-05'),
  ('Pou Chen Vietnam',   'Mr. Kim - GM',  'zalo',     'Tiến độ bổ sung 50 LĐ tháng 7','Update ngày 15/06',  '2026-06-04'),
  ('TTP Vinawood',       'Ms. Lan - NS',  'call',     'Xác nhận ngày chốt T6',        '',                   '2026-06-03'),
  ('Korea Electronic VN','Mr. Park - HR', 'meeting',  'Đàm phán gia hạn HĐ',          'Gọi lại ngay!',      '2026-06-01');

-- DỮ LIỆU MẪU — CRM PIPELINE
INSERT INTO crm_pipeline (company_name, region, worker_estimate, stage, last_contact)
VALUES
  ('Cty TNHH Sunrise VN',  'Nhơn Trạch',  80,  'tiem-nang',    '2026-06-01'),
  ('Korea Tech Mfg',       'KCN Amata',   150, 'tiem-nang',    '2026-06-03'),
  ('Fuji Electric VN',     'Biên Hòa 2',  200, 'dang-lh',      '2026-06-07'),
  ('CP Đông Phương',       'Sóng Thần',   45,  'dang-lh',      '2026-06-06'),
  ('Nidec Vietnam',        'Biên Hòa',    90,  'quan-tam',     '2026-06-04'),
  ('Yamaha Motor VN',      'Phố Nối',     180, 'quan-tam',     '2026-06-02'),
  ('LG Electronics VN',    'Tràng Duệ',   150, 'dam-phan',     '2026-06-07'),
  ('Jabil Circuit VN',     'VSIP II',     220, 'dam-phan',     '2026-06-06');

-- DỮ LIỆU MẪU — KHẢO SÁT THỊ TRƯỜNG
INSERT INTO market_surveys (zone_name, wage_unskilled_min, wage_unskilled_max, wage_skilled_min, wage_skilled_max, labor_availability, occupancy_rate)
VALUES
  ('KCN Biên Hòa 2', 5800000, 6000000, 7500000, 9000000,  'doi-dao',    95),
  ('KCN Amata',      6000000, 6500000, 8000000, 10000000, 'trung-binh', 90),
  ('VSIP I',         6200000, 6800000, 8500000, 11000000, 'trung-binh', 88),
  ('Bàu Bàng',       5500000, 5800000, 7000000, 8500000,  'doi-dao',    75);

-- DỮ LIỆU MẪU — ĐỐI THỦ CẠNH TRANH
INSERT INTO competitors (zone_name, company_name, fee_unskilled, fee_skilled, trend, notes)
VALUES
  ('KCN Biên Hòa 2', 'Cty A (nội địa)', 800000, 1020000, 'stable', 'Giữ nguyên'),
  ('KCN Biên Hòa 2', 'Manpower VN',     970000, 1280000, 'up',      'Tăng Q2/2026'),
  ('KCN Biên Hòa 2', 'Cty B (mới)',     770000, 980000,  'down',    'Đang phá giá');
