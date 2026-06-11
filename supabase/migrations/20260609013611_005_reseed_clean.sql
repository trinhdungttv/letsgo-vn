-- Truncate and re-seed cleanly
TRUNCATE crm_gifts, crm_interactions, cskh_logs, finance_records, client_labor_history, competitors, market_surveys, crm_pipeline, quotes, clients, app_users RESTART IDENTITY CASCADE;

INSERT INTO app_users (username, password, full_name, role) VALUES
  ('admin', 'admin', 'Quản trị viên', 'admin'),
  ('ketoan', 'ketoan', 'Kế Toán', 'ketoan'),
  ('kinhdoanh', 'kd123', 'Kinh Doanh BD', 'kinhdoanh'),
  ('bdh', 'bdh123', 'Ban Điều Hành', 'bdh');

INSERT INTO clients (id, name, region, manager, cutoff_day, payment_start, payment_end, next_month_pay, contract_start, contract_end, status, paid_this_month, prog_cutoff, prog_calc, prog_paid) VALUES
  ('a1000000-0000-0000-0000-000000000001','Changshin VN','Biên Hòa','Ms. Lan',25,1,5,true,'2024-08-15','2026-08-15','warn',false,true,true,false),
  ('a1000000-0000-0000-0000-000000000002','TTP Vinawood','Biên Hòa','Ms. Trang',20,26,30,false,'2024-01-01','2027-01-01','ok',true,true,true,true),
  ('a1000000-0000-0000-0000-000000000003','CP Việt Hưng','Bình Dương','Mr. Hùng',25,3,6,true,'2023-06-15','2026-06-15','danger',false,false,false,false),
  ('a1000000-0000-0000-0000-000000000004','Hansae Vietnam','VSIP','Ms. Lan',20,24,27,false,'2025-03-01','2027-03-01','ok',true,true,true,true),
  ('a1000000-0000-0000-0000-000000000005','Taekwang Vina','Biên Hòa','Anh Minh',22,28,31,false,'2024-07-15','2026-07-15','warn',false,true,false,false),
  ('a1000000-0000-0000-0000-000000000006','Korea Electronic VN','VSIP','Ms. Trang',15,21,24,false,'2024-06-09','2026-06-09','danger',false,true,true,false),
  ('a1000000-0000-0000-0000-000000000007','Pou Chen Vietnam','Bình Dương','Mr. Hùng',20,26,29,false,'2024-06-01','2027-06-01','ok',true,true,true,true),
  ('a1000000-0000-0000-0000-000000000008','TNHH Minh Trang','Biên Hòa','Anh Minh',28,5,8,true,'2025-04-01','2027-04-01','ok',true,true,true,true);

INSERT INTO client_labor_history (client_id, week_label, count, updated_by, created_at) VALUES
  ('a1000000-0000-0000-0000-000000000001','T4W4',298,'Ms. Lan','2026-04-28T00:00:00Z'),
  ('a1000000-0000-0000-0000-000000000001','T5W1',305,'Ms. Lan','2026-05-05T00:00:00Z'),
  ('a1000000-0000-0000-0000-000000000001','T5W2',308,'Ms. Lan','2026-05-12T00:00:00Z'),
  ('a1000000-0000-0000-0000-000000000001','T5W4',310,'Ms. Lan','2026-05-26T00:00:00Z'),
  ('a1000000-0000-0000-0000-000000000001','T6W1',314,'Ms. Lan','2026-06-02T00:00:00Z'),
  ('a1000000-0000-0000-0000-000000000002','T4W4',80,'Ms. Trang','2026-04-28T00:00:00Z'),
  ('a1000000-0000-0000-0000-000000000002','T5W2',83,'Ms. Trang','2026-05-12T00:00:00Z'),
  ('a1000000-0000-0000-0000-000000000002','T6W1',87,'Ms. Trang','2026-06-02T00:00:00Z'),
  ('a1000000-0000-0000-0000-000000000003','T4W4',150,'Mr. Hùng','2026-04-28T00:00:00Z'),
  ('a1000000-0000-0000-0000-000000000003','T5W2',148,'Mr. Hùng','2026-05-12T00:00:00Z'),
  ('a1000000-0000-0000-0000-000000000003','T6W1',145,'Mr. Hùng','2026-06-02T00:00:00Z'),
  ('a1000000-0000-0000-0000-000000000004','T4W4',195,'Ms. Lan','2026-04-28T00:00:00Z'),
  ('a1000000-0000-0000-0000-000000000004','T5W2',202,'Ms. Lan','2026-05-12T00:00:00Z'),
  ('a1000000-0000-0000-0000-000000000004','T6W1',210,'Ms. Lan','2026-06-02T00:00:00Z'),
  ('a1000000-0000-0000-0000-000000000005','T4W4',170,'Anh Minh','2026-04-28T00:00:00Z'),
  ('a1000000-0000-0000-0000-000000000005','T5W2',174,'Anh Minh','2026-05-12T00:00:00Z'),
  ('a1000000-0000-0000-0000-000000000005','T6W1',178,'Anh Minh','2026-06-02T00:00:00Z'),
  ('a1000000-0000-0000-0000-000000000006','T4W4',90,'Ms. Trang','2026-04-28T00:00:00Z'),
  ('a1000000-0000-0000-0000-000000000006','T5W2',92,'Ms. Trang','2026-05-12T00:00:00Z'),
  ('a1000000-0000-0000-0000-000000000006','T6W1',94,'Ms. Trang','2026-06-02T00:00:00Z'),
  ('a1000000-0000-0000-0000-000000000007','T4W4',405,'Mr. Hùng','2026-04-28T00:00:00Z'),
  ('a1000000-0000-0000-0000-000000000007','T5W2',415,'Mr. Hùng','2026-05-12T00:00:00Z'),
  ('a1000000-0000-0000-0000-000000000007','T6W1',425,'Mr. Hùng','2026-06-02T00:00:00Z'),
  ('a1000000-0000-0000-0000-000000000008','T4W4',60,'Anh Minh','2026-04-28T00:00:00Z'),
  ('a1000000-0000-0000-0000-000000000008','T5W2',61,'Anh Minh','2026-05-12T00:00:00Z'),
  ('a1000000-0000-0000-0000-000000000008','T6W1',63,'Anh Minh','2026-06-02T00:00:00Z');

INSERT INTO finance_records (client_id, month, revenue, cost_labor, cost_mgmt, cost_other, paid_status, paid_date) VALUES
  ('a1000000-0000-0000-0000-000000000001','2026-06',266900000,220000000,15000000,5000000,false,null),
  ('a1000000-0000-0000-0000-000000000002','2026-06',73950000,61000000,4000000,1000000,true,'2026-06-02'),
  ('a1000000-0000-0000-0000-000000000003','2026-06',123250000,102000000,7000000,2000000,false,null),
  ('a1000000-0000-0000-0000-000000000004','2026-06',178500000,147000000,9000000,3000000,true,'2026-06-03'),
  ('a1000000-0000-0000-0000-000000000005','2026-06',151300000,124000000,8000000,2500000,false,null),
  ('a1000000-0000-0000-0000-000000000006','2026-06',79900000,65000000,5000000,1500000,false,null),
  ('a1000000-0000-0000-0000-000000000007','2026-06',361250000,297000000,18000000,5000000,true,'2026-06-04'),
  ('a1000000-0000-0000-0000-000000000008','2026-06',53550000,44000000,3000000,1000000,true,'2026-06-01');

INSERT INTO crm_pipeline (id, company_name, region, worker_estimate, stage, rating, last_contact, notes) VALUES
  ('b1000000-0000-0000-0000-000000000001','Samil Vina','KCN Biên Hòa 2',120,'tiem-nang','hot','2026-06-01','Liên hệ qua HR cũ của Changshin'),
  ('b1000000-0000-0000-0000-000000000002','Dongwoo VN','VSIP II',80,'dang-lh','normal','2026-06-05','Đang đàm phán giá'),
  ('b1000000-0000-0000-0000-000000000003','LG Electronics','KCN Amata',200,'quan-tam','hot','2026-06-03','Cần tuyển gấp Q3'),
  ('b1000000-0000-0000-0000-000000000004','Pine Electronics','Bình Dương',50,'dam-phan','normal','2026-05-28','HĐ đang soạn thảo'),
  ('b1000000-0000-0000-0000-000000000005','Orion VN','KCN Biên Hòa 2',150,'hop-tac','hot','2026-06-07',null),
  ('b1000000-0000-0000-0000-000000000006','Hyundai Seat VN','Bình Dương',90,'khong-nhu-cau','low','2026-04-15','Họ tự tuyển'),
  ('b1000000-0000-0000-0000-000000000007','Fuji Manufacturing','VSIP II',60,'tiem-nang','normal','2026-05-20',null),
  ('b1000000-0000-0000-0000-000000000008','Viet Star Corp','Biên Hòa',30,'ngung','low','2026-03-10','Dừng do ngân sách');

INSERT INTO crm_interactions (crm_id, interaction_date, interaction_type, content) VALUES
  ('b1000000-0000-0000-0000-000000000001','2026-06-01','call','Gọi điện lần đầu, giới thiệu dịch vụ. HR tỏ ra quan tâm.'),
  ('b1000000-0000-0000-0000-000000000002','2026-06-05','meeting','Họp tại VP, trình bày bảng giá. Họ yêu cầu giảm phí 5%.'),
  ('b1000000-0000-0000-0000-000000000003','2026-06-03','zalo','Gửi profile công ty và case studies qua Zalo.');

INSERT INTO crm_gifts (crm_id, gift_date, item_name, value) VALUES
  ('b1000000-0000-0000-0000-000000000003','2026-06-03','Hộp trà cao cấp','350,000₫');

INSERT INTO market_surveys (zone_name, survey_date, wage_unskilled_min, wage_unskilled_max, wage_skilled_min, wage_skilled_max, wage_tech, labor_availability, surveyed_by) VALUES
  ('KCN Biên Hòa 2','2026-06-01',5800000,6200000,7500000,8500000,11000000,'Trung bình','Anh Minh'),
  ('KCN VSIP II','2026-06-01',6000000,6500000,7800000,8800000,11500000,'Dồi dào','Ms. Lan'),
  ('KCN Amata','2026-05-15',5900000,6300000,7600000,8600000,11200000,'Khan hiếm','Ms. Trang'),
  ('KCN Bàu Bàng','2026-05-15',5300000,5700000,6800000,7600000,9800000,'Dồi dào','Mr. Hùng');

INSERT INTO competitors (zone_name, company_name, survey_date, fee_unskilled, fee_skilled, fee_tech, trend, notes) VALUES
  ('KCN Biên Hòa 2','Manpower VN','2026-06-01',900000,1200000,1600000,'up','Tăng phí 5% từ T5'),
  ('KCN Biên Hòa 2','Adecco VN','2026-06-01',820000,1050000,1450000,'stable','Giá ổn định'),
  ('KCN Biên Hòa 2','Công ty B (local)','2026-06-01',750000,980000,1350000,'down','Đang phá giá'),
  ('KCN VSIP II','Manpower VN','2026-06-01',950000,1250000,1650000,'up',null),
  ('KCN VSIP II','Adecco VN','2026-06-01',870000,1100000,1500000,'stable',null);

INSERT INTO cskh_logs (client_id, client_name, contact_person, contact_type, content, followup, followup_done, log_date) VALUES
  ('a1000000-0000-0000-0000-000000000001','Changshin VN','Ms. Kim - HR Manager','meeting','Gặp mặt tháng 6, thảo luận nhu cầu tuyển thêm 20 LĐ tay nghề','Gửi báo giá tay nghề trước 15/06',false,'2026-06-05'),
  ('a1000000-0000-0000-0000-000000000007','Pou Chen Vietnam','Mr. Chen - Giám đốc','call','Báo cáo tiến độ tuyển tháng 6, đang thiếu 15 LĐ','Họp nội bộ xem xét nguồn cung',true,'2026-06-04'),
  ('a1000000-0000-0000-0000-000000000003','CP Việt Hưng','Ms. Hoa - HR','zalo','Nhắc nhở gia hạn HĐ, hết hạn 15/06','Soạn HĐ gia hạn gửi trước 10/06',false,'2026-06-03'),
  ('a1000000-0000-0000-0000-000000000006','Korea Electronic VN','Mr. Park - Operations','call','HĐ hết hạn hôm nay, cần quyết định','Họp khẩn trước 17h',false,'2026-06-09');
