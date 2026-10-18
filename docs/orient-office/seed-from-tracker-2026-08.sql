-- Nạp số liệu ban đầu cho Văn phòng Orient từ tracker cũ (file orient_pl_2026-08.json, xuất 03/08/2026).
-- Chạy trong Supabase → SQL Editor, SAU migration 164 + 165. Chạy lại nhiều lần không bị nhân đôi (khớp theo tên).
-- Không xoá dữ liệu nào, trừ việc thay mốc tăng giá của chính 4 khoản thuê dưới đây bằng bản trong file.

-- ═══ KHỐI 1 — SỐ ANH ĐÃ NHẬP TRONG TRACKER ═══════════════════════════════════
-- 4 khoản thuê đầu vào + mốc tăng giá, khách XHOME (USD, không VAT, chưa gán mặt bằng),
-- 5 hạng mục chi phí vận hành (chỉ tên, chưa có số tiền), kịch bản hòa vốn "XHOME 778m²" gắn vào 2.01.
DO $$
DECLARE
  r     record;
  v_id  uuid;
  v_201 uuid;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('mbt', 'Mặt bằng 1.05',       57971000::numeric, DATE '2025-03-01', 'rent', false, 1, DATE '2027-03-01', 10::numeric),
    ('mbt', 'Mặt bằng 2.01',       305556000,         DATE '2025-03-01', 'rent', false, 2, DATE '2027-01-01', 5),
    ('ts4', 'Mặt tiền phía trước', 101306795,         DATE '2026-01-01', 'rent', false, 1, NULL,              NULL),
    ('ts4', 'Bãi giữ xe',          27000000,          DATE '2026-01-01', 'util', true,  2, NULL,              NULL)
  ) AS t(landlord, name, base_price, base_month, vat_category, is_parking, sort_order, inc_month, inc_percent)
  LOOP
    SELECT id INTO v_id FROM bds_head_leases
     WHERE landlord = r.landlord AND lower(btrim(name)) = lower(btrim(r.name));
    IF v_id IS NULL THEN
      INSERT INTO bds_head_leases (landlord, name, currency, base_price, base_month, vat_mode, vat_category, is_parking, sort_order)
      VALUES (r.landlord, r.name, 'VND', r.base_price, r.base_month, 'incl', r.vat_category, r.is_parking, r.sort_order)
      RETURNING id INTO v_id;
    ELSE
      UPDATE bds_head_leases
         SET currency = 'VND', base_price = r.base_price, base_month = r.base_month, vat_mode = 'incl',
             vat_category = r.vat_category, is_parking = r.is_parking
       WHERE id = v_id;
    END IF;
    DELETE FROM bds_head_lease_increases WHERE head_lease_id = v_id;
    IF r.inc_month IS NOT NULL THEN
      INSERT INTO bds_head_lease_increases (head_lease_id, effective_month, percent) VALUES (v_id, r.inc_month, r.inc_percent);
    END IF;
    IF r.name = 'Mặt bằng 2.01' THEN v_201 := v_id; END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM bds_tenants WHERE lower(btrim(name)) = 'xhome') THEN
    INSERT INTO bds_tenants (name, currency, vat_mode, sort_order) VALUES ('XHOME', 'USD', 'none', 1);
  END IF;

  FOR r IN SELECT * FROM (VALUES
    ('Phí quản lý', 1), ('Bảo trì', 2), ('Sửa chữa', 3), ('Lương NV (bảo vệ/vệ sinh)', 4), ('Đối ngoại', 5)
  ) AS t(name, sort_order)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM bds_opex_categories WHERE lower(btrim(name)) = lower(btrim(r.name))) THEN
      INSERT INTO bds_opex_categories (name, vat_mode, vat_category, sort_order) VALUES (r.name, 'none', 'rent', r.sort_order);
    END IF;
  END LOOP;

  -- Kịch bản hòa vốn có sẵn từ migration: gắn vào 2.01, chi phí mục tiêu = giá thuê 2.01 (chỉ khi còn trống)
  UPDATE bds_breakeven_scenarios
     SET head_lease_id = v_201, reference_month = DATE '2026-01-01', target_cost = 305556000
   WHERE name = 'XHOME 778m²' AND head_lease_id IS NULL AND target_cost = 0;
END $$;

-- ═══ KHỐI 2 — TUỲ CHỌN: SỐ MẪU CỦA TRACKER ════════════════════════════════════
-- Chi phí vận hành T1–T7/2026 (5tr + 2tr + 15tr + 3tr/tháng, sửa chữa 8tr T4 & 4tr T6) và 2 khoản dự kiến
-- (Sơn lại mặt tiền 12tr T9, Bảo trì thang máy 8tr T12). Đây là SỐ MẪU MẶC ĐỊNH của tracker — trong file
-- anh chưa sửa. Chỉ chạy khối này nếu muốn có số tạm để xem, sau đó sửa lại ở tab "Chi phí vận hành".
DO $$
DECLARE
  v_ql uuid; v_bt uuid; v_sc uuid; v_lg uuid; v_dn uuid;
  m    date;
BEGIN
  SELECT id INTO v_ql FROM bds_opex_categories WHERE lower(btrim(name)) = lower('Phí quản lý');
  SELECT id INTO v_bt FROM bds_opex_categories WHERE lower(btrim(name)) = lower('Bảo trì');
  SELECT id INTO v_sc FROM bds_opex_categories WHERE lower(btrim(name)) = lower('Sửa chữa');
  SELECT id INTO v_lg FROM bds_opex_categories WHERE lower(btrim(name)) = lower('Lương NV (bảo vệ/vệ sinh)');
  SELECT id INTO v_dn FROM bds_opex_categories WHERE lower(btrim(name)) = lower('Đối ngoại');
  IF v_ql IS NULL OR v_bt IS NULL OR v_sc IS NULL OR v_lg IS NULL OR v_dn IS NULL THEN
    RAISE EXCEPTION 'Thiếu hạng mục chi phí vận hành — hãy chạy KHỐI 1 trước.';
  END IF;

  FOR m IN SELECT d::date FROM generate_series(DATE '2026-01-01', DATE '2026-07-01', interval '1 month') AS d LOOP
    INSERT INTO bds_opex_monthly (category_id, month, amount) VALUES
      (v_ql, m, 5000000), (v_bt, m, 2000000), (v_lg, m, 15000000), (v_dn, m, 3000000)
    ON CONFLICT (category_id, month) DO UPDATE SET amount = EXCLUDED.amount;
  END LOOP;
  INSERT INTO bds_opex_monthly (category_id, month, amount) VALUES
    (v_sc, DATE '2026-04-01', 8000000), (v_sc, DATE '2026-06-01', 4000000)
  ON CONFLICT (category_id, month) DO UPDATE SET amount = EXCLUDED.amount;

  IF NOT EXISTS (SELECT 1 FROM bds_forecast_expenses WHERE lower(btrim(name)) = lower('Sơn lại mặt tiền') AND month = DATE '2026-09-01') THEN
    INSERT INTO bds_forecast_expenses (name, month, amount, note)
    VALUES ('Sơn lại mặt tiền', DATE '2026-09-01', 12000000, 'Chưa báo giá chính thức, ước tính');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM bds_forecast_expenses WHERE lower(btrim(name)) = lower('Bảo trì thang máy định kỳ') AND month = DATE '2026-12-01') THEN
    INSERT INTO bds_forecast_expenses (name, month, amount, note)
    VALUES ('Bảo trì thang máy định kỳ', DATE '2026-12-01', 8000000, NULL);
  END IF;
END $$;

-- ═══ KIỂM TRA ════════════════════════════════════════════════════════════════
SELECT upper(l.landlord) AS "Bên cho thuê", l.name AS "Khoản thuê",
       to_char(l.base_price, 'FM999,999,999,990') AS "Giá gốc/tháng (VNĐ, đã gồm VAT)",
       to_char(l.base_month, 'MM/YYYY') AS "Áp dụng từ",
       CASE WHEN l.is_parking THEN 'Bãi xe' ELSE '' END AS "Loại",
       coalesce((SELECT string_agg('từ ' || to_char(i.effective_month, 'MM/YYYY') || ' +' || trim_scale(i.percent)::text || '%', ', ')
                   FROM bds_head_lease_increases i WHERE i.head_lease_id = l.id), '—') AS "Mốc tăng giá"
  FROM bds_head_leases l
 ORDER BY l.landlord, l.sort_order;
