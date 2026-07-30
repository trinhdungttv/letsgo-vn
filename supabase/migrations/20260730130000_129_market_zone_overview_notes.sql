-- 129: Khu vực (KCN) — thêm 1 ô "Tổng quan" tự do (rich text, cùng cơ chế RichTextEditor
-- đã dùng ở Ngành Nghề: đậm/nghiêng/gạch đầu dòng/đánh số/thụt lề/bôi màu) để ghi thông tin
-- tổng quan tuỳ ý, KHÔNG đụng tới các trường mô tả cũ (characteristics/strengths/weaknesses/notes).
alter table market_zones add column if not exists overview_notes text;

SELECT dh_attach_triggers();
