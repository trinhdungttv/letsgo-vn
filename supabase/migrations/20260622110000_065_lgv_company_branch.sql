-- Tao chi nhanh dac biet "LGV - Cong ty" dai dien cho cong ty tu quan ly du an.
-- Khi du an bi tra ve tu chi nhanh, chuyen sang chi nhanh nay + doi project_type = 'managed'.
-- Chay thu cong trong Supabase SQL Editor.

INSERT INTO branches (name, short_name, region, status, notes)
VALUES (
  'LGV - Cong ty',
  'LGV',
  'LGV - Cong ty',
  'active',
  'Chi nhanh dac biet: cong ty tu quan ly du an (khong khoan). LGV huong 100% loi nhuan, tra luong truc tiep cho nguoi quan ly.'
)
ON CONFLICT DO NOTHING;
