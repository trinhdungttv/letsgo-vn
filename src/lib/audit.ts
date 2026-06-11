import { supabase } from './supabase';
import type { AppUser, AuditAction, AuditLogEntry } from './types';

export async function logActivity(opts: {
  user: AppUser | null;
  action: AuditAction;
  table: string;
  recordId: string;
  description: string;
  oldData?: any;
  newData?: any;
}): Promise<void> {
  try {
    await supabase.from('audit_logs').insert({
      user_id: opts.user?.id || null,
      user_name: opts.user?.full_name || null,
      action: opts.action,
      table_name: opts.table,
      record_id: opts.recordId,
      description: opts.description,
      old_data: opts.oldData ?? null,
      new_data: opts.newData ?? null,
    });
  } catch (e) {
    console.error('logActivity failed:', e);
  }
}

export async function undoActivity(log: AuditLogEntry, user: AppUser | null): Promise<{ error?: string }> {
  try {
    if (log.action === 'insert') {
      const { error } = await supabase.from(log.table_name).delete().eq('id', log.record_id);
      if (error) throw error;
      await logActivity({
        user, action: 'delete', table: log.table_name, recordId: log.record_id,
        description: `Hoàn tác: xóa bản ghi đã thêm (${log.description || log.table_name})`,
        oldData: log.new_data,
      });
    } else if (log.action === 'update') {
      if (!log.old_data) throw new Error('Không có dữ liệu cũ để khôi phục');
      const { error } = await supabase.from(log.table_name).update(log.old_data).eq('id', log.record_id);
      if (error) throw error;
      await logActivity({
        user, action: 'update', table: log.table_name, recordId: log.record_id,
        description: `Hoàn tác: khôi phục dữ liệu trước thay đổi (${log.description || log.table_name})`,
        oldData: log.new_data, newData: log.old_data,
      });
    } else if (log.action === 'delete') {
      if (!log.old_data) throw new Error('Không có dữ liệu cũ để khôi phục');
      const { error } = await supabase.from(log.table_name).insert(log.old_data);
      if (error) throw error;
      await logActivity({
        user, action: 'insert', table: log.table_name, recordId: log.record_id,
        description: `Hoàn tác: khôi phục bản ghi đã xóa (${log.description || log.table_name})`,
        newData: log.old_data,
      });
    }

    const { error: markErr } = await supabase.from('audit_logs').update({ undone: true }).eq('id', log.id);
    if (markErr) throw markErr;

    return {};
  } catch (e: any) {
    return { error: e.message };
  }
}
