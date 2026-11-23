-- 232: Ảnh đại diện gắn với NGƯỜI (Trưởng CN / người phụ trách), không gắn với chi nhánh.
-- Chi nhánh nào do ai phụ trách thì hiện ảnh của người đó; đổi người phụ trách → ảnh đổi theo.
-- branches.manager_avatar_url vẫn giữ (để mọi màn hình cũ đọc được) nhưng luôn được trigger đồng bộ
-- từ managers.avatar_url. Không xoá dữ liệu cũ. Chạy lại nhiều lần vẫn an toàn.

ALTER TABLE managers ADD COLUMN IF NOT EXISTS avatar_url text;

-- Chép ảnh đang có ở chi nhánh sang người phụ trách (người nào chưa có ảnh; lấy ảnh chi nhánh mới sửa nhất)
UPDATE managers m
SET avatar_url = s.url
FROM (
  SELECT DISTINCT ON (manager_id) manager_id, manager_avatar_url AS url
  FROM branches
  WHERE manager_id IS NOT NULL AND manager_avatar_url IS NOT NULL
  ORDER BY manager_id, updated_at DESC NULLS LAST
) s
WHERE m.id = s.manager_id AND m.avatar_url IS NULL;

-- 1) Đổi người phụ trách của chi nhánh → lấy ảnh của người mới (chưa có ảnh → hiện chữ cái đầu)
CREATE OR REPLACE FUNCTION branches_pull_manager_avatar() RETURNS trigger AS $$
BEGIN
  IF NEW.manager_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.manager_id IS DISTINCT FROM OLD.manager_id)
     AND (TG_OP = 'INSERT' OR NEW.manager_avatar_url IS NOT DISTINCT FROM OLD.manager_avatar_url) THEN
    NEW.manager_avatar_url := (SELECT avatar_url FROM managers WHERE id = NEW.manager_id);
  ELSIF NEW.manager_id IS NULL AND TG_OP = 'UPDATE' AND OLD.manager_id IS NOT NULL
        AND NEW.manager_avatar_url IS NOT DISTINCT FROM OLD.manager_avatar_url THEN
    NEW.manager_avatar_url := NULL;   -- bỏ người phụ trách → bỏ ảnh
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_branches_pull_manager_avatar ON branches;
CREATE TRIGGER trg_branches_pull_manager_avatar
BEFORE INSERT OR UPDATE OF manager_id ON branches
FOR EACH ROW EXECUTE FUNCTION branches_pull_manager_avatar();

-- 2) Tải / gỡ ảnh ở một chi nhánh → lưu vào người phụ trách (các chi nhánh khác của người đó tự theo ở bước 3)
CREATE OR REPLACE FUNCTION branches_push_manager_avatar() RETURNS trigger AS $$
BEGIN
  IF NEW.manager_id IS NOT NULL THEN
    UPDATE managers SET avatar_url = NEW.manager_avatar_url
    WHERE id = NEW.manager_id AND avatar_url IS DISTINCT FROM NEW.manager_avatar_url;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_branches_push_manager_avatar ON branches;
CREATE TRIGGER trg_branches_push_manager_avatar
AFTER UPDATE OF manager_avatar_url ON branches
FOR EACH ROW
WHEN (NEW.manager_avatar_url IS DISTINCT FROM OLD.manager_avatar_url AND NEW.manager_id IS NOT DISTINCT FROM OLD.manager_id)
EXECUTE FUNCTION branches_push_manager_avatar();

-- 3) Ảnh của người thay đổi → mọi chi nhánh người đó phụ trách đổi theo
CREATE OR REPLACE FUNCTION managers_sync_branch_avatar() RETURNS trigger AS $$
BEGIN
  UPDATE branches SET manager_avatar_url = NEW.avatar_url
  WHERE manager_id = NEW.id AND manager_avatar_url IS DISTINCT FROM NEW.avatar_url;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_managers_sync_branch_avatar ON managers;
CREATE TRIGGER trg_managers_sync_branch_avatar
AFTER UPDATE OF avatar_url ON managers
FOR EACH ROW
WHEN (NEW.avatar_url IS DISTINCT FROM OLD.avatar_url)
EXECUTE FUNCTION managers_sync_branch_avatar();

-- Đồng bộ lần đầu: chi nhánh nào có người phụ trách đã có ảnh thì lấy ảnh của người đó
UPDATE branches b SET manager_avatar_url = m.avatar_url
FROM managers m
WHERE b.manager_id = m.id AND m.avatar_url IS NOT NULL AND b.manager_avatar_url IS DISTINCT FROM m.avatar_url;
