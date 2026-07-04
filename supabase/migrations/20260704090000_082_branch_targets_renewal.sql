-- Mục tiêu doanh thu tháng theo chi nhánh — phục vụ dashboard điều hành (trang Báo cáo).
-- Đơn vị revenue_target: đồng (giống projects_pnl.revenue).

CREATE TABLE IF NOT EXISTS branch_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  revenue_target NUMERIC NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (branch_id, month)
);

-- Ghi chú: trạng thái tái ký hợp đồng KHÔNG cần cột riêng — radar hợp đồng (trang Báo cáo)
-- ánh xạ trực tiếp từ Workspace: work_tasks (task_type = 'Tái ký HĐ') + work_task_comments.
