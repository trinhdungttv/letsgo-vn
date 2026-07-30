-- 133: Khu vực (KCN) — cờ đánh dấu "đặc biệt quan tâm/tiềm năng", bật tắt nhanh ngay trên thẻ
-- KCN (không cần mở hồ sơ chi tiết), khác với "Mức tiềm năng" 1-5 sao đã có (đánh giá chi tiết
-- trong hồ sơ) — cờ này chỉ để lọc nhanh "tôi đang chú trọng những KCN nào".
alter table market_zones add column if not exists is_priority boolean not null default false;

CREATE INDEX IF NOT EXISTS idx_market_zones_priority ON market_zones(is_priority) WHERE is_priority;
