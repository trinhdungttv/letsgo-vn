-- 113: "Lần nhập" lương 4 vùng — mỗi lần đổi lương (thường đổi cả 4 vùng cùng lúc theo 1
-- Nghị định) là 1 batch có ngày áp dụng riêng, SỬA/XOÁ được trực tiếp (khác data_history
-- vốn chỉ đọc, không sửa/xoá được). region_wages (migration 111) vẫn là bảng "giá trị hiện
-- hành" cho mọi nơi tra cứu — được 1 trigger tự tính lại từ batch có hiệu lực gần nhất mỗi
-- khi region_wage_batches thay đổi.

CREATE TABLE IF NOT EXISTS region_wage_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  effective_date date NOT NULL,
  wage_i numeric NOT NULL,
  wage_ii numeric NOT NULL,
  wage_iii numeric NOT NULL,
  wage_iv numeric NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS region_wage_batches_effective_date_idx ON region_wage_batches(effective_date);

ALTER TABLE region_wage_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "region_wage_batches_all_anon" ON region_wage_batches FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "region_wage_batches_all_auth" ON region_wage_batches FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Khởi tạo batch gốc theo Nghị định 74/2024/NĐ-CP.
INSERT INTO region_wage_batches (effective_date, wage_i, wage_ii, wage_iii, wage_iv)
VALUES ('2024-07-01', 4960000, 4410000, 3860000, 3450000)
ON CONFLICT (effective_date) DO NOTHING;

-- Tính lại region_wages = batch có effective_date gần nhất (không vượt quá hôm nay).
-- Nếu không còn batch nào hợp lệ (vd xoá hết), giữ nguyên region_wages hiện tại.
CREATE OR REPLACE FUNCTION region_wages_apply_latest() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b region_wage_batches%ROWTYPE;
BEGIN
  SELECT * INTO b FROM region_wage_batches
  WHERE effective_date <= current_date
  ORDER BY effective_date DESC, created_at DESC
  LIMIT 1;

  IF FOUND THEN
    INSERT INTO region_wages (zone, wage_amount, effective_date, updated_at) VALUES
      ('I', b.wage_i, b.effective_date, now()),
      ('II', b.wage_ii, b.effective_date, now()),
      ('III', b.wage_iii, b.effective_date, now()),
      ('IV', b.wage_iv, b.effective_date, now())
    ON CONFLICT (zone) DO UPDATE SET
      wage_amount = EXCLUDED.wage_amount, effective_date = EXCLUDED.effective_date, updated_at = EXCLUDED.updated_at;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION region_wages_recompute() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM region_wages_apply_latest();
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS region_wage_batches_recompute_trg ON region_wage_batches;
CREATE TRIGGER region_wage_batches_recompute_trg
  AFTER INSERT OR UPDATE OR DELETE ON region_wage_batches
  FOR EACH STATEMENT EXECUTE FUNCTION region_wages_recompute();

-- Áp dụng ngay để region_wages khớp đúng batch gốc vừa tạo ở trên.
SELECT region_wages_apply_latest();

GRANT EXECUTE ON FUNCTION region_wages_apply_latest() TO anon, authenticated;

-- Gắn nhật ký data_history cho bảng batch mới (an toàn dữ liệu, dù UI đã cho sửa/xoá trực tiếp).
SELECT dh_attach_triggers();
