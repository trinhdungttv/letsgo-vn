-- ============================================================================
-- 187 — CRM Pipeline: vị trí NHÀ MÁY theo từng KCN của công ty
-- ----------------------------------------------------------------------------
-- Công ty lớn có nhà máy ở nhiều KCN (crm_pipeline.zone_ids, migration 186) → mỗi KCN 1 ghim riêng trên
-- bản đồ trong hồ sơ công ty. Lưu ngay trên dòng crm_pipeline, khoá theo mã KCN:
--   zone_sites = { "<market_zones.id>": { "map_link": "...", "lat": 10.9, "lng": 106.8 }, ... }
-- Vị trí chính của công ty (market_leads / clients .map_link, lat, lng) giữ nguyên như cũ.
-- Bỏ 1 KCN khỏi công ty thì ghim nhà máy ở KCN đó vẫn được giữ — chọn lại KCN là hiện lại.
--
-- Có mất dữ liệu hiện có không? KHÔNG — chỉ ADD COLUMN (mặc định rỗng). Chạy lại vẫn an toàn.
-- Không thêm khoá ngoại → không ảnh hưởng các chỗ embed crm_pipeline (bài học PGRST201).
-- Phải chạy SAU 186.
-- ============================================================================
ALTER TABLE crm_pipeline ADD COLUMN IF NOT EXISTS zone_sites jsonb NOT NULL DEFAULT '{}'::jsonb;

NOTIFY pgrst, 'reload schema';

-- ── ROLLBACK (mất các ghim nhà máy theo KCN đã đặt) ──
-- ALTER TABLE crm_pipeline DROP COLUMN IF EXISTS zone_sites;
