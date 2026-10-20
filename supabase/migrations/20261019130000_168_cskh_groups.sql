-- ============================================================================
-- 168 — CSKH: nhóm chăm sóc tự tạo (cskh_groups)
-- ----------------------------------------------------------------------------
-- Mang từ PRM (prm_groups, Tony Study): nhóm có tên, 1 trong 6 màu và "nhắc
-- liên hệ như" một hạng có sẵn (base_tier). Xếp người vào nhóm = ghi
-- contacts.group_id + contacts.tier = base_tier (migration 169), nên nhịp, điểm,
-- hàng đợi không đổi logic.
--
-- Có mất dữ liệu hiện có không? KHÔNG — chỉ TẠO MỚI bảng, không đụng bảng cũ.
-- Chạy lại nhiều lần vẫn an toàn (IF NOT EXISTS / CREATE OR REPLACE).
-- Phải chạy TRƯỚC 169 (contacts.group_id tham chiếu bảng này).
-- ============================================================================

-- Hàm dùng chung cho các bảng CSKH: tự cập nhật updated_at mỗi lần sửa.
CREATE OR REPLACE FUNCTION cskh_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE TABLE IF NOT EXISTS cskh_groups (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  color       text NOT NULL DEFAULT 'blue'
              CHECK (color IN ('blue', 'green', 'orange', 'red', 'purple', 'gray')),
  -- NULL = chưa chọn → code coi như 'other' (giống PRM)
  base_tier   text CHECK (base_tier IS NULL OR base_tier IN ('vvip', 'vip', 'partner', 'friend', 'family', 'other')),
  created_by  uuid,          -- app_users.id người tạo (không FK, giống cost_plans)
  is_archived boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Không trùng tên giữa các nhóm còn dùng (không phân biệt hoa/thường, khoảng trắng 2 đầu)
CREATE UNIQUE INDEX IF NOT EXISTS cskh_groups_name_uq
  ON cskh_groups (lower(btrim(name))) WHERE NOT is_archived;

DROP TRIGGER IF EXISTS trg_cskh_groups_touch ON cskh_groups;
CREATE TRIGGER trg_cskh_groups_touch
  BEFORE UPDATE ON cskh_groups
  FOR EACH ROW EXECUTE FUNCTION cskh_touch_updated_at();

-- Quy ước LetsGo: app chạy role anon (session token riêng) → mở cho anon + authenticated
ALTER TABLE cskh_groups ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'cskh_groups' AND policyname = 'cskh_groups_all_anon') THEN
    CREATE POLICY "cskh_groups_all_anon" ON cskh_groups FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'cskh_groups' AND policyname = 'cskh_groups_all_auth') THEN
    CREATE POLICY "cskh_groups_all_auth" ON cskh_groups FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Gắn trigger "Lịch sử dữ liệu" (data_history) cho bảng mới
SELECT dh_attach_triggers();

-- ── ROLLBACK (chỉ chạy khi cần gỡ; chạy SAU khi đã gỡ 169) ──────────────────
-- DROP TABLE IF EXISTS cskh_groups;
-- DROP FUNCTION IF EXISTS cskh_touch_updated_at();   -- chỉ khi không bảng nào khác còn dùng
