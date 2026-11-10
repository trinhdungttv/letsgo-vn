// Nhập nhanh thành viên từ file Excel "Danh sách đăng ký ra vào cổng" đã có (hoặc bảng có dòng tiêu đề "Họ và Tên…").
// Xem trước từng người: thêm mới hay cập nhật (trùng số CCCD). Ô trống trong file không ghi đè dữ liệu đang có.
import { useRef, useState } from 'react';
import { FileSpreadsheet, Upload } from 'lucide-react';
import { isoToVn } from '../../../lib/meetings/gateList';
import { parseMemberTable, readXlsxTable, type ImportedMember } from '../../../lib/meetings/importMembers';
import type { MeetingMember } from '../../../lib/meetings/types';
import { foldVn } from '../../../lib/companyMatch';
import { Sheet, SHEET_FOOTER } from '../components/Sheet';

export function MemberImportSheet({ members, onImport, onClose }: {
  members: readonly MeetingMember[];
  onImport: (rows: ImportedMember[]) => Promise<string | null>;
  onClose: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ImportedMember[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const live = members.filter(m => !m.deleted_at);
  const matchOf = (r: ImportedMember): MeetingMember | undefined => {
    const id = r.id_number.replace(/\D/g, '');
    if (id) return live.find(m => m.id_number.replace(/\D/g, '') === id);
    return live.find(m => !m.id_number.replace(/\D/g, '') && foldVn(m.full_name.trim()) === foldVn(r.full_name.trim()));
  };

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setError(''); setRows(null); setFileName(f.name);
    if (!/\.xlsx$/i.test(f.name)) { setError('Chỉ đọc file Excel .xlsx (file .xls cũ: mở bằng Excel rồi Lưu thành .xlsx).'); return; }
    setBusy(true);
    try {
      const r = parseMemberTable(await readXlsxTable(await f.arrayBuffer()));
      if (r.noHeader) setError('Không thấy dòng tiêu đề có cột “Họ và Tên” trong sheet đầu tiên.');
      else if (!r.rows.length) setError('Có dòng tiêu đề nhưng không có người nào bên dưới.');
      else setRows(r.rows);
    } catch (e) {
      setError('Không đọc được file: ' + (e instanceof Error ? e.message : String(e)));
    }
    setBusy(false);
  };

  const run = async () => {
    if (!rows?.length) return;
    setBusy(true);
    const err = await onImport(rows);
    setBusy(false);
    if (err) setError(err);
  };

  const added = rows?.filter(r => !matchOf(r)).length ?? 0;
  return (
    <Sheet label="Nhập thành viên từ Excel" onClose={onClose} wide="xl">
      <h2 className="text-[20px] font-bold tracking-[-0.02em] text-[#1D1D1F]">Nhập từ file Excel</h2>
      <p className="text-[12.5px] text-[#86868B] mt-0.5 mb-3 leading-snug">
        Chọn file danh sách đăng ký ra vào cổng đã gửi trước đây (hoặc bảng có các cột Họ và Tên · Giới tính · Năm sinh · Số CCCD · Ngày cấp · Nơi cấp · Địa chỉ thường trú · Chức vụ).
        Trùng số CCCD → cập nhật người đó, ô trống trong file không xoá dữ liệu đang có.
      </p>
      <input ref={fileRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden"
        onChange={e => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
      <button type="button" onClick={() => fileRef.current?.click()} disabled={busy}
        className="w-full flex items-center gap-3 rounded-[14px] border-2 border-dashed border-black/[0.12] hover:border-[#0071E3]/50 hover:bg-[#0071E3]/[0.03] px-4 py-4 text-left transition disabled:opacity-50">
        <span className="w-10 h-10 rounded-[10px] bg-[#34C759]/15 text-[#248A3D] flex items-center justify-center shrink-0"><FileSpreadsheet size={20} /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-semibold text-[#1D1D1F] truncate">{fileName || 'Chọn file .xlsx'}</span>
          <span className="block text-[12px] text-[#86868B]">{busy ? 'Đang đọc…' : fileName ? 'Bấm để chọn file khác' : 'Đọc sheet đầu tiên của file'}</span>
        </span>
        <Upload size={18} className="text-[#0071E3] shrink-0" />
      </button>

      {rows && (
        <div className="mt-3">
          <p className="text-[13px] text-[#1D1D1F] mb-1.5">
            Thấy <b>{rows.length}</b> người · <span className="text-[#248A3D] font-medium">{added} thêm mới</span> · <span className="text-[#0066CC] font-medium">{rows.length - added} cập nhật</span>
          </p>
          <div className="rounded-[12px] ring-1 ring-black/[0.08] overflow-x-auto bg-white">
            <table className="w-full text-[12.5px] min-w-[640px]">
              <thead className="bg-[#F5F5F7] text-[#6E6E73]">
                <tr>
                  {['', 'Họ và tên', 'Giới tính', 'Năm sinh', 'Số CCCD', 'Ngày cấp', 'Chức vụ'].map(h => <th key={h} className="text-left font-medium px-2.5 py-1.5 whitespace-nowrap">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const m = matchOf(r);
                  return (
                    <tr key={i} className="border-t border-black/[0.06]">
                      <td className="px-2.5 py-1.5 whitespace-nowrap">
                        <span className={`inline-flex px-2 py-[1px] rounded-full text-[11px] font-semibold ${m ? 'bg-[#0071E3]/10 text-[#0066CC]' : 'bg-[#34C759]/15 text-[#248A3D]'}`}>{m ? 'Cập nhật' : 'Mới'}</span>
                      </td>
                      <td className="px-2.5 py-1.5 font-semibold text-[#1D1D1F] whitespace-nowrap">{r.full_name}</td>
                      <td className="px-2.5 py-1.5">{r.gender || '—'}</td>
                      <td className="px-2.5 py-1.5">{r.birth || '—'}</td>
                      <td className="px-2.5 py-1.5 tabular-nums">{r.id_number || <span className="text-[#B25000]">thiếu</span>}</td>
                      <td className="px-2.5 py-1.5 tabular-nums">{r.id_issued_on ? isoToVn(r.id_issued_on) : '—'}</td>
                      <td className="px-2.5 py-1.5">{r.title || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {error && <p className="mt-3 text-[13px] text-[#D70015] bg-[#FF3B30]/10 rounded-[12px] px-3.5 py-2.5">{error}</p>}
      <div className={`${SHEET_FOOTER} mt-4 flex gap-2 bg-[#F2F2F7]/90 md:bg-white/90`}>
        <button type="button" onClick={onClose} className="flex-1 h-11 md:h-9 rounded-full bg-[rgba(118,118,128,0.12)] text-[13px] font-medium text-[#1D1D1F] hover:bg-[rgba(118,118,128,0.2)] transition">Huỷ</button>
        <button type="button" onClick={run} disabled={busy || !rows?.length}
          className="flex-[2] h-11 md:h-9 rounded-full bg-[#0071E3] text-white text-[13px] font-semibold disabled:opacity-40 transition">
          {busy && rows ? 'Đang nhập…' : rows ? `Nhập ${rows.length} người` : 'Nhập'}
        </button>
      </div>
    </Sheet>
  );
}
