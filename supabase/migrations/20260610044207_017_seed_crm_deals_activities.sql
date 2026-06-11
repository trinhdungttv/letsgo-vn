
DO $$
DECLARE
  l1  UUID := 'a1000000-0000-0000-0000-000000000001';
  l2  UUID := 'a1000000-0000-0000-0000-000000000002';
  l3  UUID := 'a1000000-0000-0000-0000-000000000003';
  l4  UUID := 'a1000000-0000-0000-0000-000000000004';
  l5  UUID := 'a1000000-0000-0000-0000-000000000005';
  l6  UUID := 'a1000000-0000-0000-0000-000000000006';
  l7  UUID := 'a1000000-0000-0000-0000-000000000007';
  l8  UUID := 'a1000000-0000-0000-0000-000000000008';
  l9  UUID := 'a1000000-0000-0000-0000-000000000009';
  l10 UUID := 'a1000000-0000-0000-0000-000000000010';
  p1  UUID := 'b1000000-0000-0000-0000-000000000001';
  p2  UUID := 'b1000000-0000-0000-0000-000000000002';
  p3  UUID := 'b1000000-0000-0000-0000-000000000003';
  p4  UUID := 'b1000000-0000-0000-0000-000000000004';
  p5  UUID := 'b1000000-0000-0000-0000-000000000005';
  d1  UUID := 'c1000000-0000-0000-0000-000000000001';
  d2  UUID := 'c1000000-0000-0000-0000-000000000002';
  d3  UUID := 'c1000000-0000-0000-0000-000000000003';
  d4  UUID := 'c1000000-0000-0000-0000-000000000004';
  d5  UUID := 'c1000000-0000-0000-0000-000000000005';
  d6  UUID := 'c1000000-0000-0000-0000-000000000006';
  d7  UUID := 'c1000000-0000-0000-0000-000000000007';
  d8  UUID := 'c1000000-0000-0000-0000-000000000008';
BEGIN

INSERT INTO crm_leads (id, name, phone, email, company, source, status, owner, created_at) VALUES
  (l1,  'Nguyen Van An',   '0901234567', 'an@techcorp.vn',   'TechCorp VN',           'linkedin',  'prospect', 'Minh',  NOW() - INTERVAL '30 days'),
  (l2,  'Tran Thi Lan',    '0912345678', 'lan@megabank.vn',  'MegaBank',              'referral',  'customer', 'Huong', NOW() - INTERVAL '45 days'),
  (l3,  'Le Minh Tuan',    '0923456789', 'tuan@vinfast.vn',  'Vinfast',               'website',   'lead',     'Tony',  NOW() - INTERVAL '10 days'),
  (l4,  'Pham Thu Ha',     '0934567890', 'ha@samsung.vn',    'Samsung Electronics VN','cold_call', 'prospect', 'Huong', NOW() - INTERVAL '20 days'),
  (l5,  'Hoang Van Khanh', '0945678901', 'khanh@fpt.vn',     'FPT Software',          'event',     'customer', 'Tony',  NOW() - INTERVAL '60 days'),
  (l6,  'Nguyen Thi Mai',  '0956789012', 'mai@vcb.vn',       'Vietcombank',           'referral',  'lead',     'Lan',   NOW() - INTERVAL '5 days'),
  (l7,  'Do Van Hung',     '0967890123', 'hung@toyota.vn',   'Toyota Vietnam',        'linkedin',  'prospect', 'Huong', NOW() - INTERVAL '25 days'),
  (l8,  'Bui Thi Ngoc',    '0978901234', 'ngoc@masan.vn',    'Masan Group',           'website',   'lead',     'Minh',  NOW() - INTERVAL '3 days'),
  (l9,  'Vu Minh Quan',    '0989012345', 'quan@vingroup.vn', 'VinGroup',              'cold_call', 'customer', 'Minh',  NOW() - INTERVAL '50 days'),
  (l10, 'Cao Thi Thuy',    '0990123456', 'thuy@bidv.vn',     'BIDV',                  'event',     'prospect', 'Tony',  NOW() - INTERVAL '15 days')
ON CONFLICT (id) DO NOTHING;

INSERT INTO crm_products (id, name, price, sku, description, category, created_at) VALUES
  (p1, 'Dich vu Tuyen dung',   50000000,  'SVC-001', 'Tuyen dung va sang loc nhan su chuyen nghiep',      'recruitment', NOW() - INTERVAL '90 days'),
  (p2, 'Phan mem HRM',         120000000, 'SFT-001', 'He thong quan ly nhan su tich hop toan dien',       'software',    NOW() - INTERVAL '90 days'),
  (p3, 'Dao tao Nhan su',      30000000,  'TRN-001', 'Chuong trinh dao tao ky nang cho doi ngu HR',      'training',    NOW() - INTERVAL '90 days'),
  (p4, 'Tu van To chuc',       80000000,  'CON-001', 'Tu van tai co cau va xay dung van hoa to chuc',    'consulting',  NOW() - INTERVAL '90 days'),
  (p5, 'Outsourcing Lao dong', 200000000, 'OUT-001', 'Cung ung va quan ly lao dong tai khu cong nghiep', 'outsourcing', NOW() - INTERVAL '90 days')
ON CONFLICT (id) DO NOTHING;

INSERT INTO crm_deals (id, title, lead_id, product_id, value, stage, owner, expected_closing_date, probability, notes, created_at) VALUES
  (d1, 'TechCorp - Phan mem HRM Q3',      l1,  p2, 120000000, 'in_progress', 'Minh',  '2026-07-30', 50,  'Dang demo, phan hoi tich cuc tu IT dept',        NOW() - INTERVAL '20 days'),
  (d2, 'Samsung - Outsourcing Lao dong',  l4,  p5, 500000000, 'proposal',    'Huong', '2026-06-30', 75,  'Da gui bao gia 500M, cho phe duyet cap GM',      NOW() - INTERVAL '15 days'),
  (d3, 'FPT - Dao tao Leadership 2026',   l5,  p3,  90000000, 'won',         'Tony',  '2026-05-31', 100, 'Hop dong da ky, khoi dong 01/06',                NOW() - INTERVAL '40 days'),
  (d4, 'VinGroup - HRM + Tu van To chuc', l9,  p2, 320000000, 'proposal',    'Minh',  '2026-07-15', 70,  'Bundled deal - 2 san pham, dam phan chiet khau', NOW() - INTERVAL '12 days'),
  (d5, 'MegaBank - Tuyen dung Bulk 2026', l2,  p1, 150000000, 'contacted',   'Lan',   '2026-08-01', 30,  'Meeting lan 2 du kien 15/06',                   NOW() - INTERVAL '8 days'),
  (d6, 'Toyota - Outsourcing Day chuyen', l7,  p5, 480000000, 'new',         'Huong', '2026-08-31', 15,  'Referral tu Changshin, can khao sat nha may',   NOW() - INTERVAL '3 days'),
  (d7, 'BIDV - Tu van Mo hinh HR',        l10, p4,  80000000, 'lost',        'Tony',  '2026-05-15', 0,   'Thua Deloitte ve gia, luu de retarget Q4',      NOW() - INTERVAL '30 days'),
  (d8, 'Vietcombank - Phan mem HRM 2026', l6,  p2, 240000000, 'contacted',   'Minh',  '2026-09-01', 25,  'Cold contact, da co buoi intro call 09/06',     NOW() - INTERVAL '2 days')
ON CONFLICT (id) DO NOTHING;

INSERT INTO crm_activities (deal_id, type, content, created_by, created_at) VALUES
  (d1, 'meeting', 'Demo san pham HRM cho team IT TechCorp. Phan hoi rat tich cuc.', 'Minh',  NOW() - INTERVAL '5 days'),
  (d1, 'email',   'Gui tai lieu ky thuat HRM + case study cho Mr. An.', 'Minh',  NOW() - INTERVAL '10 days'),
  (d1, 'call',    'Goi follow-up sau demo. An xac nhan se trinh board vao tuan toi.', 'Minh',  NOW() - INTERVAL '3 days'),
  (d2, 'email',   'Gui bao gia chinh thuc 500M cho Samsung.', 'Huong', NOW() - INTERVAL '7 days'),
  (d2, 'call',    'Pham Thu Ha phan hoi: can xem xet them ve dieu khoan bao hiem.', 'Huong', NOW() - INTERVAL '2 days'),
  (d2, 'meeting', 'Hop voi HR Director Samsung tai van phong VSIP.', 'Huong', NOW() - INTERVAL '12 days'),
  (d3, 'note',    'HD ky xong. Tony chuyen cho ops team setup lop dao tao.', 'Tony',  NOW() - INTERVAL '35 days'),
  (d4, 'meeting', 'Buoi kham pha nhu cau tai VinGroup HQ.', 'Minh',  NOW() - INTERVAL '10 days'),
  (d5, 'call',    'Cold call toi HR Director MegaBank. Can tuyen 200 nguoi.', 'Lan',   NOW() - INTERVAL '8 days'),
  (d6, 'note',    'Lead tu referral Changshin. Toyota can 150 LD cho day chuyen moi.', 'Huong', NOW() - INTERVAL '3 days'),
  (d7, 'note',    'Thua bid. Deloitte dua ra gia thap hon 25%.', 'Tony',  NOW() - INTERVAL '25 days'),
  (d8, 'call',    'Intro call voi Ms. Mai - VCB Digital Banking Dept.', 'Minh',  NOW() - INTERVAL '2 days')
ON CONFLICT DO NOTHING;

END $$;
