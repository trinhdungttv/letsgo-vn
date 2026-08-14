// Bình luận cho workspace_tasks (Task nội bộ chung) — dùng chung giữa MyWorkFeed.tsx
// (Workspace) và BranchHistoryFields.tsx (trang Chi nhánh) để 2 nơi luôn đọc/ghi
// đúng 1 bảng workspace_task_comments, không có logic đồng bộ riêng nào khác.
import { supabase } from './supabase'
import type { WorkspaceTaskComment } from './types'

export async function fetchWorkspaceTaskComments(taskIds: string[]): Promise<WorkspaceTaskComment[]> {
  if (!taskIds.length) return []
  const { data } = await supabase
    .from('workspace_task_comments')
    .select('*')
    .in('task_id', taskIds)
    .order('created_at', { ascending: true })
  return (data as WorkspaceTaskComment[]) || []
}

export async function addWorkspaceTaskComment(
  taskId: string, userId: string, userName: string, content: string
): Promise<WorkspaceTaskComment | null> {
  const { data, error } = await supabase
    .from('workspace_task_comments')
    .insert({ task_id: taskId, user_id: userId, user_name: userName, content })
    .select()
    .single()
  if (error) return null
  return data as WorkspaceTaskComment
}

export async function updateWorkspaceTaskComment(commentId: string, content: string): Promise<boolean> {
  const { error } = await supabase.from('workspace_task_comments').update({ content }).eq('id', commentId)
  return !error
}

export async function deleteWorkspaceTaskComment(commentId: string): Promise<boolean> {
  const { error } = await supabase.from('workspace_task_comments').delete().eq('id', commentId)
  return !error
}
