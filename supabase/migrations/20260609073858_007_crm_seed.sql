
DO $$
DECLARE
  l1 UUID := 'a1000000-0000-0000-0000-000000000001';
  l2 UUID := 'a1000000-0000-0000-0000-000000000002';
  l3 UUID := 'a1000000-0000-0000-0000-000000000003';
  l4 UUID := 'a1000000-0000-0000-0000-000000000004';
  l5 UUID := 'a1000000-0000-0000-0000-000000000005';
  l6 UUID := 'a1000000-0000-0000-0000-000000000006';
  l7 UUID := 'a1000000-0000-0000-0000-000000000007';
  l8 UUID := 'a1000000-0000-0000-0000-000000000008';
  l9 UUID := 'a1000000-0000-0000-0000-000000000009';
  l10 UUID := 'a1000000-0000-0000-0000-000000000010';

  p1 UUID := 'b1000000-0000-0000-0000-000000000001';
  p2 UUID := 'b1000000-0000-0000-0000-000000000002';
  p3 UUID := 'b1000000-0000-0000-0000-000000000003';
  p4 UUID := 'b1000000-0000-0000-0000-000000000004';
  p5 UUID := 'b1000000-0000-0000-0000-000000000005';

  d1 UUID := 'c1000000-0000-0000-0000-000000000001';
  d2 UUID := 'c1000000-0000-0000-0000-000000000002';
  d3 UUID := 'c1000000-0000-0000-0000-000000000003';
  d4 UUID := 'c1000000-0000-0000-0000-000000000004';
  d5 UUID := 'c1000000-0000-0000-0000-000000000005';
  d6 UUID := 'c1000000-0000-0000-0000-000000000006';
  d7 UUID := 'c1000000-0000-0000-0000-000000000007';
  d8 UUID := 'c1000000-0000-0000-0000-000000000008';
BEGIN

-- Leads
INSERT INTO crm_leads (id, name, phone, email, company, source, status, owner, created_at) VALUES
  (l1,  'Nguyễn Văn An',   '0901234567', 'an.nguyen@techcorp.vn',   'TechCorp VN',           'linkedin',  'prospect', 'Minh',   NOW() - INTERVAL '30 days'),
  (l2,  'Trần Thị Lan',    '0912345678', 'lan.tran@megabank.vn',    'MegaBank',               'referral',  'customer', 'Hương',  NOW() - INTERVAL '45 days'),
  (l3,  'Lê Minh Tuấn',    '0923456789', 'tuan.le@vinfast.vn',      'Vinfast',                'website',   'lead',     'Tony',   NOW() - INTERVAL '10 days'),
  (l4,  'Phạm Thu Hà',     '0934567890', 'ha.pham@samsung.vn',      'Samsung Electronics VN', 'cold_call', 'prospect', 'Hương',  NOW() - INTERVAL '20 days'),
  (l5,  'Hoàng Văn Khánh', '0945678901', 'khanh.hoang@fpt.vn',      'FPT Software',           'event',     'customer', 'Tony',   NOW() - INTERVAL '60 days'),
  (l6,  'Nguyễn Thị Mai',  '0956789012', 'mai.nguyen@vcb.vn',       'Vietcombank',            'referral',  'lead',     'Lan',    NOW() - INTERVAL '5 days'),
  (l7,  'Đỗ Văn Hùng',     '0967890123', 'hung.do@toyota.vn',       'Toyota Vietnam',         'linkedin',  'prospect', 'Hương',  NOW() - INTERVAL '25 days'),
  (l8,  'Bùi Thị Ngọc',    '0978901234', 'ngoc.bui@masan.vn',       'Masan Group',            'website',   'lead',     'Minh',   NOW() - INTERVAL '3 days'),
  (l9,  'Vũ Minh Quân',    '0989012345', 'quan.vu@vingroup.vn',     'VinGroup',               'cold_call', 'customer', 'Minh',   NOW() - INTERVAL '50 days'),
  (l10, 'Cao Thị Thúy',    '0990123456', 'thuy.cao@bidv.vn',        'BIDV',                   'event',     'prospect', 'Tony',   NOW() - INTERVAL '15 days')
ON CONFLICT (id) DO NOTHING;

-- Products
INSERT INTO crm_products (id, name, price, sku, description, category, created_at) VALUES
  (p1, 'Dịch vụ Tuyển dụng',    50000000,  'SVC-001', 'Tuyển dụng và sàng lọc nhân sự chuyên nghiệp',       'Recruitment',  NOW() - INTERVAL '90 days'),
  (p2, 'Phần mềm HRM',          120000000, 'SFT-001', 'Hệ thống quản lý nhân sự tích hợp toàn diện',        'Software',     NOW() - INTERVAL '90 days'),
  (p3, 'Đào tạo Nhân sự',       30000000,  'TRN-001', 'Chương trình đào tạo kỹ năng cho đội ngũ HR',        'Training',     NOW() - INTERVAL '90 days'),
  (p4, 'Tư vấn Tổ chức',        80000000,  'CON-001', 'Tư vấn tái cơ cấu và xây dựng văn hóa tổ chức',     'Consulting',   NOW() - INTERVAL '90 days'),
  (p5, 'Outsourcing Lao động',   200000000, 'OUT-001', 'Cung ứng và quản lý lao động tại khu công nghiệp',   'Outsourcing',  NOW() - INTERVAL '90 days')
ON CONFLICT (id) DO NOTHING;

-- Deals
INSERT INTO crm_deals (id, title, lead_id, product_id, value, stage, owner, expected_closing_date, probability, notes, created_at) VALUES
  (d1, 'TechCorp – Phần mềm HRM Q3',         l1, p2, 120000000, 'in_progress', 'Minh',   '2026-07-30', 50, 'Đang demo, phản hồi tích cực từ IT dept',        NOW() - INTERVAL '20 days'),
  (d2, 'Samsung – Outsourcing Lao động',      l4, p5, 500000000, 'proposal',    'Hương',  '2026-06-30', 75, 'Đã gửi báo giá 500M, chờ phê duyệt cấp GM',     NOW() - INTERVAL '15 days'),
  (d3, 'FPT – Đào tạo Leadership 2026',       l5, p3,  90000000, 'won',         'Tony',   '2026-05-31', 100,'Hợp đồng đã ký, khởi động 01/06',               NOW() - INTERVAL '40 days'),
  (d4, 'VinGroup – HRM + Tư vấn Tổ chức',    l9, p2, 320000000, 'proposal',    'Minh',   '2026-07-15', 70, 'Bundled deal – 2 sản phẩm, đàm phán chiết khấu', NOW() - INTERVAL '12 days'),
  (d5, 'MegaBank – Tuyển dụng Bulk 2026',     l2, p1, 150000000, 'contacted',   'Lan',    '2026-08-01', 30, 'Meeting lần 2 dự kiến 15/06',                   NOW() - INTERVAL '8 days'),
  (d6, 'Toyota – Outsourcing Dây chuyền',     l7, p5, 480000000, 'new',         'Hương',  '2026-08-31', 15, 'Referral từ Changshin, cần khảo sát nhà máy',    NOW() - INTERVAL '3 days'),
  (d7, 'BIDV – Tư vấn Mô hình HR',            l10,p4,  80000000, 'lost',        'Tony',   '2026-05-15', 0,  'Thua Deloitte về giá, lưu để retarget Q4',       NOW() - INTERVAL '30 days'),
  (d8, 'Vietcombank – Phần mềm HRM 2026',     l6, p2, 240000000, 'contacted',   'Minh',   '2026-09-01', 25, 'Cold contact, đã có buổi intro call 09/06',      NOW() - INTERVAL '2 days')
ON CONFLICT (id) DO NOTHING;

-- Activities (15)
INSERT INTO crm_activities (deal_id, type, content, created_by, created_at) VALUES
  (d1, 'meeting', 'Demo sản phẩm HRM cho team IT TechCorp. Phản hồi rất tích cực, họ muốn xem module payroll.', 'Minh',  NOW() - INTERVAL '5 days'),
  (d1, 'email',   'Gửi tài liệu kỹ thuật HRM + case study Changshin VN cho Mr. An.', 'Minh',  NOW() - INTERVAL '10 days'),
  (d1, 'call',    'Gọi follow-up sau demo. An xác nhận sẽ trình board vào tuần tới.', 'Minh',  NOW() - INTERVAL '3 days'),
  (d2, 'email',   'Gửi báo giá chính thức 500M cho Samsung. Bao gồm SLA 99.5% uptime.', 'Hương', NOW() - INTERVAL '7 days'),
  (d2, 'call',    'Phạm Thu Hà phản hồi: cần xem xét thêm về điều khoản bảo hiểm lao động.', 'Hương', NOW() - INTERVAL '2 days'),
  (d2, 'meeting', 'Họp với HR Director Samsung tại văn phòng VSIP. Đã clarify được 3 điểm quan trọng.', 'Hương', NOW() - INTERVAL '12 days'),
  (d3, 'note',    'HĐ ký xong. Tony chuyển cho ops team setup lớp đào tạo. Khai giảng 01/06.', 'Tony',  NOW() - INTERVAL '35 days'),
  (d3, 'email',   'Confirmation email về lịch training và danh sách học viên.', 'Tony',  NOW() - INTERVAL '38 days'),
  (d4, 'meeting', 'Buổi khám phá nhu cầu tại VinGroup HQ. CEO muốn tích hợp với SAP hiện có.', 'Minh',  NOW() - INTERVAL '10 days'),
  (d4, 'note',    'Cần price break nếu bundle HRM + Consulting. Dự kiến giảm 10%.', 'Minh',  NOW() - INTERVAL '5 days'),
  (d5, 'call',    'Cold call tới HR Director MegaBank. Họ đang cần tuyển 200 người cho chi nhánh Bình Dương.', 'Lan',   NOW() - INTERVAL '8 days'),
  (d6, 'note',    'Lead từ referral của Changshin. Toyota cần ~150 LĐ cho dây chuyền mới mở rộng Q3.', 'Hương', NOW() - INTERVAL '3 days'),
  (d7, 'note',    'Thua bid. Deloitte đưa ra giá thấp hơn 25%. Ghi nhận để cải thiện pricing Q4.', 'Tony',  NOW() - INTERVAL '25 days'),
  (d8, 'call',    'Intro call với Nguyễn Thị Mai - VCB Digital Banking Dept. Họ muốn demo online.', 'Minh',  NOW() - INTERVAL '2 days'),
  (d8, 'email',   'Email giới thiệu công ty và deck sản phẩm HRM gửi Ms. Mai.', 'Minh',  NOW() - INTERVAL '1 day')
ON CONFLICT DO NOTHING;

END $$;
