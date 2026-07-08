import { useEffect, useState } from 'react';
import { Download, HardDriveDownload, CheckCircle2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { tableLabel, BACKUP_TABLES } from '../../lib/historyTables';

interface Props {
  toast: (msg: string) => void;
}

const FETCH_PAGE = 1000;

async function fetchAllRows(table: string): Promise<any[]> {
  const rows: any[] = [];
  for (let offset = 0; ; offset += FETCH_PAGE) {
    const { data, error } = await supabase.from(table).select('*').range(offset, offset + FETCH_PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < FETCH_PAGE) break;
  }
  return rows;
}

export default function BackupTab({ toast }: Props) {
  const [counts, setCounts] = useState<Record<string, number | null>>({});
  const [loadingCounts, setLoadingCounts] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState('');
  const [lastExport, setLastExport] = useState<string | null>(() => localStorage.getItem('lgv_last_backup'));

  useEffect(() => {
    (async () => {
      const result: Record<string, number | null> = {};
      // đếm song song theo lô 10 bảng để không quá tải
      for (let i = 0; i < BACKUP_TABLES.length; i += 10) {
        const batch = BACKUP_TABLES.slice(i, i + 10);
        await Promise.all(batch.map(async t => {
          const { count, error } = await supabase.from(t).select('*', { count: 'exact', head: true });
          result[t] = error ? null : (count ?? 0);
        }));
        setCounts({ ...result });
      }
      setLoadingCounts(false);
    })();
  }, []);

  const doExport = async () => {
    setExporting(true);
    try {
      const dump: Record<string, any[]> = {};
      let done = 0;
      for (const t of BACKUP_TABLES) {
        if (counts[t] === null) { done++; continue; } // bảng không tồn tại/không đọc được
        setProgress(`Đang tải ${tableLabel(t)} (${++done}/${BACKUP_TABLES.length})...`);
        dump[t] = await fetchAllRows(t);
      }
      const payload = {
        app: 'letsgo-vn',
        exported_at: new Date().toISOString(),
        tables: dump,
      };
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
      const blob = new Blob([JSON.stringify(payload, null, 1)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `letsgo-backup-${stamp}.json`;
      a.click();
      URL.revokeObjectURL(url);
      const now = new Date().toLocaleString('vi-VN');
      localStorage.setItem('lgv_last_backup', now);
      setLastExport(now);
      toast('Đã tải bản sao lưu về máy');
    } catch (e: any) {
      toast('Lỗi sao lưu: ' + e.message);
    } finally {
      setExporting(false);
      setProgress('');
    }
  };

  const totalRows = Object.values(counts).reduce((s: number, c) => s + (c || 0), 0);
  const okTables = BACKUP_TABLES.filter(t => counts[t] !== null && counts[t] !== undefined);

  return (
    <>
      <div className="bg-white border border-[#E8E7E2] rounded-[10px] p-4 space-y-3">
        <div className="flex items-center gap-2 font-semibold text-[13.5px]"><HardDriveDownload size={15} /> Sao lưu toàn bộ dữ liệu về máy</div>
        <p className="text-[12px] text-gray-500">
          Supabase gói miễn phí không có backup tự động. Nút này tải <b>toàn bộ dữ liệu của mọi bảng</b> về một file JSON trên máy bạn — nên tải định kỳ (ví dụ mỗi tuần) và trước khi cập nhật tính năng lớn, để luôn có một bản dự phòng độc lập hoàn toàn với database.
        </p>
        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={doExport} disabled={exporting || loadingCounts} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12.5px] font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
            <Download size={14} /> {exporting ? (progress || 'Đang xuất...') : `Tải bản sao lưu (${loadingCounts ? '...' : totalRows.toLocaleString('vi-VN')} dòng)`}
          </button>
          {lastExport && (
            <span className="inline-flex items-center gap-1 text-[12px] text-emerald-700"><CheckCircle2 size={13} /> Lần sao lưu gần nhất: {lastExport}</span>
          )}
        </div>
      </div>

      <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
        <div className="px-4 py-2.5 bg-[#F9F9F7] text-[11.5px] text-[#888] font-medium">
          Dữ liệu sẽ được sao lưu ({okTables.length} bảng)
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-4 text-[12px] px-4 py-3">
          {BACKUP_TABLES.map(t => (
            <div key={t} className="flex justify-between py-0.5 border-b border-[#F5F4F0] last:border-0">
              <span className={counts[t] === null ? 'text-[#ccc] line-through' : 'text-[#555]'}>{tableLabel(t)}</span>
              <span className="text-[#999] tabular-nums">
                {loadingCounts && counts[t] === undefined ? '…' : counts[t] === null ? '—' : counts[t]?.toLocaleString('vi-VN')}
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
