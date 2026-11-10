// Hiển thị 1 thay đổi trong data_history: bảng Trước → Sau (sửa) hoặc nội dung dòng (thêm / xoá).
import { formatValue, recordName, tableLabel } from '../../lib/historyTables';
import type { DataHistoryEntry } from '../../lib/types';

export const ACTION_UI: Record<string, { label: string; cls: string }> = {
  INSERT: { label: 'Thêm', cls: 'bg-emerald-50 text-emerald-700 border border-emerald-200' },
  UPDATE: { label: 'Sửa', cls: 'bg-blue-50 text-blue-700 border border-blue-200' },
  DELETE: { label: 'Xóa', cls: 'bg-red-50 text-red-700 border border-red-200' },
};

/** Cột tự đổi theo mỗi lần lưu — không đáng nêu trong tóm tắt. */
const NOISE = new Set(['updated_at', 'created_at']);

export function eventName(row: DataHistoryEntry): string {
  return recordName(row.new_data || row.old_data) || row.record_id.slice(0, 8);
}

/** "Tên KH: A → B · Số LĐ: 10 → 12" — tối đa `max` cột, bỏ cột thời gian tự đổi. */
export function changeSummary(row: DataHistoryEntry, max = 3): string {
  if (row.action !== 'UPDATE' || !row.changed_fields?.length) return '';
  const fields = row.changed_fields.filter(f => !NOISE.has(f));
  const shown = fields.slice(0, max).map(f => `${f}: ${short(formatValue(row.old_data?.[f]))} → ${short(formatValue(row.new_data?.[f]))}`);
  return shown.join(' · ') + (fields.length > max ? ` · +${fields.length - max} cột` : '');
}

function short(s: string): string {
  return s.length > 40 ? s.slice(0, 37) + '…' : s;
}

export function EventLine({ row }: { row: DataHistoryEntry }) {
  const a = ACTION_UI[row.action];
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0">
      <span className={`text-[10.5px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${a.cls}`}>{a.label}</span>
      <span className="text-[#888] shrink-0">{tableLabel(row.table_name)}</span>
      <span className="font-medium text-[#222] truncate">{eventName(row)}</span>
    </span>
  );
}

export default function EventDiff({ row }: { row: DataHistoryEntry }) {
  if (row.action === 'UPDATE' && row.changed_fields?.length) {
    return (
      <div className="overflow-x-auto">
        <table className="text-[12px] w-full max-w-3xl">
          <thead>
            <tr>
              <th className="text-left text-[11px] text-[#888] font-medium pb-1 pr-4">Cột</th>
              <th className="text-left text-[11px] text-[#888] font-medium pb-1 pr-4">Trước</th>
              <th className="text-left text-[11px] text-[#888] font-medium pb-1">Sau</th>
            </tr>
          </thead>
          <tbody>
            {row.changed_fields.map(f => (
              <tr key={f}>
                <td className="pr-4 py-0.5 font-mono text-[11px] text-[#666] align-top">{f}</td>
                <td className="pr-4 py-0.5 text-red-700 break-all align-top">{formatValue(row.old_data?.[f])}</td>
                <td className="py-0.5 text-emerald-700 break-all align-top">{formatValue(row.new_data?.[f])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <pre className="text-[11px] text-[#555] whitespace-pre-wrap break-all max-h-64 overflow-y-auto bg-white border border-[#EEE] rounded-lg p-3">
      {JSON.stringify(row.new_data || row.old_data, null, 2)}
    </pre>
  );
}
