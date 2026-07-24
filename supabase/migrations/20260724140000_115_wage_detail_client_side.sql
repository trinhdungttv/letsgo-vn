-- 115: Chi tiết lương giờ có 2 PHÍA — wage_detail (đã có, migration 101) = lương Let's Go VN
-- trả cho người lao động; wage_detail_client (mới) = lương/phí phía công ty trả cho Let's Go
-- VN. Có đủ 2 phía thì FE tự tính chênh lệch, không cần cột riêng cho phần chênh lệch.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS wage_detail_client jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE market_leads ADD COLUMN IF NOT EXISTS wage_detail_client jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Bổ sung các trường lương chi tiết theo đúng bảng khảo sát thực tế (LCB, ca kíp, OT, CN,
-- các khoản thưởng/phụ cấp...) — CHỈ THÊM, không xoá/đổi trường cũ để không mất dữ liệu đã
-- nhập. sort_order để cao (100+) nên xếp sau các trường hiện có.
INSERT INTO wage_detail_fields (name, sort_order) VALUES
  ('LCB', 100),
  ('Ca ngày 8h (Ca 1+2)', 101),
  ('Ca đêm 8h (130%)', 102),
  ('Ca ngày 12h', 103),
  ('Ca đêm 12h', 104),
  ('CN ngày', 105),
  ('CN đêm', 106),
  ('OT ngày (1h)', 107),
  ('OT đêm (1h)', 108),
  ('Sinh hoạt', 109),
  ('Tiền cơm (8h/12h)', 110),
  ('Thưởng (GT/Vào cty)', 111),
  ('Con nhỏ', 112),
  ('Ứng lương', 113)
ON CONFLICT (name) DO NOTHING;
