// Nhập danh sách ứng viên từ Excel (danh sách CTV gửi, hội chợ việc làm, file cũ…). Tự nhận cột theo tiêu đề,
// sửa được ánh xạ; SĐT/CCCD đã có → dùng hồ sơ cũ (không ghi đè); có chọn dự án → tạo ứng tuyển.
import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { FileSpreadsheet } from 'lucide-react';
import { errText, importCandidates } from '../../lib/recruit/api';
import { IMPORT_FIELD_LABEL, guessField, mapHeaders, prepareImport } from '../../lib/recruit/importRows';
import type { ImportField } from '../../lib/recruit/importRows';
import { SOURCE_CHANNELS } from '../../lib/recruit/types';
import type { ImportResult, RecruitStage } from '../../lib/recruit/types';
import { useRecruit } from './context';
import { ChoiceChip, ErrorBanner, Field, PILL_GRAY, PILL_PRIMARY, SHEET_FOOTER, Sheet, fmtNum, inputCls, sectionCls } from './ui';

const STAGES: { key: RecruitStage; label: string }[] = [
  { key: 'new', label: 'Mới nộp' },
  { key: 'contacted', label: 'Đã liên hệ' },
  { key: 'passed', label: 'Đạt PV' },
  { key: 'started', label: 'Đã đi làm' },
];
const CHUNK = 500;

export default function ImportSheet({ onClose, onDone, leasing = false }: {
  onClose: () => void;
  onDone: () => void;
  /** Nhập lao động THỜI VỤ đang làm cho 1 khách (không gắn dự án tuyển dụng) — GĐ4 */
  leasing?: boolean;
}) {
  const ctx = useRecruit();
  const { sites, positions, toast, clients } = ctx;
  const project = leasing ? null : ctx.project;
  const [clientId, setClientId] = useState('');
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [body, setBody] = useState<unknown[][]>([]);
  const [headerRow, setHeaderRow] = useState(1);
  const [mapping, setMapping] = useState<(ImportField | null)[]>([]);
  const [siteId, setSiteId] = useState('');
  const [positionId, setPositionId] = useState('');
  const [stage, setStage] = useState<RecruitStage>('new');
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);

  const prepared = useMemo(() => (mapping.length ? prepareImport(body, mapping, headerRow + 1) : null), [body, mapping, headerRow]);

  const readFile = async (f: File) => {
    setError('');
    setResult(null);
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array', cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '', raw: true });
      // dòng tiêu đề = dòng đầu (trong 10 dòng) nhận ra ≥ 2 cột
      const idx = rows.slice(0, 10).findIndex(r => r.filter(c => guessField(String(c ?? ''))).length >= 2);
      if (idx < 0) { setError('Không tìm thấy dòng tiêu đề (cần có cột Họ tên, SĐT…)'); return; }
      const hdr = rows[idx].map(c => String(c ?? '').trim());
      setFileName(f.name);
      setHeaders(hdr);
      setHeaderRow(idx + 1);
      setBody(rows.slice(idx + 1));
      setMapping(mapHeaders(hdr));
    } catch (e) {
      setError(`Không đọc được file: ${errText(e)}`);
    }
  };

  const submit = async () => {
    if (!prepared || !prepared.rows.length) return;
    if (leasing && !clientId) { setError('Chọn khách hàng đang dùng số lao động này'); return; }
    setBusy(true);
    setError('');
    const total: ImportResult = { created: 0, linked: 0, apps: 0, skipped: [] };
    try {
      for (let i = 0; i < prepared.rows.length; i += CHUNK) {
        setProgress(`Đang nhập ${fmtNum(Math.min(i + CHUNK, prepared.rows.length))}/${fmtNum(prepared.rows.length)}…`);
        const r = await importCandidates(prepared.rows.slice(i, i + CHUNK), leasing
          ? { client_id: clientId, employment_type: 'leasing', stage: 'started', source_channel: source }
          : { project_id: project?.id ?? null, site_id: siteId || null, position_id: positionId || null, stage, source_channel: source });
        total.created += r.created;
        total.linked += r.linked;
        total.apps += r.apps;
        // số dòng server báo là thứ tự trong lô → đổi về số dòng Excel
        total.skipped.push(...r.skipped.map(s => ({ ...s, row: prepared.rowNos[i + s.row - 1] ?? s.row })));
      }
      setResult(total);
      toast(`Đã nhập ${total.created} hồ sơ mới, ${total.linked} hồ sơ có sẵn`);
      onDone();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
      setProgress('');
    }
  };

  return (
    <Sheet label="Nhập ứng viên từ Excel" onClose={onClose} wide="xl">
      <h2 className="text-[20px] font-bold tracking-[-0.02em] text-[#1D1D1F]">{leasing ? 'Nhập lao động thời vụ đang làm' : 'Nhập ứng viên từ Excel'}</h2>
      <p className="text-[12.5px] text-[#86868B] mt-0.5">{leasing
        ? 'Danh sách người đang làm thời vụ cho 1 khách: cần Họ tên + SĐT (hoặc CCCD) + "Ngày đi làm" (để tính mốc 12 tháng). Người đang làm thời vụ nơi khác sẽ bị bỏ qua.'
        : 'Cần ít nhất cột Họ tên + SĐT (hoặc CCCD). SĐT đã có trong kho → giữ hồ sơ cũ, chỉ gắn vào dự án.'}</p>

      <section className={`${sectionCls} mt-4`}>
        <label className="flex items-center gap-3 cursor-pointer">
          <span className="w-10 h-10 rounded-[10px] bg-[#34C759]/[0.14] text-[#1E7B34] flex items-center justify-center shrink-0"><FileSpreadsheet size={20} /></span>
          <span className="min-w-0 flex-1 text-[13.5px] text-[#1D1D1F]">{fileName || 'Chọn file .xlsx / .xls / .csv'}</span>
          <span className={PILL_GRAY}>Chọn file</span>
          <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) readFile(f); e.target.value = ''; }} />
        </label>
      </section>

      {headers.length > 0 && (
        <>
          <section className={`${sectionCls} mt-3`}>
            <h3 className="text-[14px] font-semibold text-[#1D1D1F]">Cột trong file → thông tin</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {headers.map((h, i) => (
                <Field key={i} label={h || `(cột ${i + 1})`}>
                  <select value={mapping[i] ?? ''} onChange={e => setMapping(m => m.map((x, j) => (j === i ? (e.target.value || null) as ImportField | null : x)))} className={inputCls}>
                    <option value="">Bỏ qua</option>
                    {(Object.keys(IMPORT_FIELD_LABEL) as ImportField[]).map(f => <option key={f} value={f}>{IMPORT_FIELD_LABEL[f]}</option>)}
                  </select>
                </Field>
              ))}
            </div>
          </section>

          <section className={`${sectionCls} mt-3`}>
            <h3 className="text-[14px] font-semibold text-[#1D1D1F]">{leasing ? 'Đang làm thời vụ cho khách' : project ? `Gắn vào dự án ${project.name}` : 'Chỉ đưa vào kho ứng viên'}</h3>
            {leasing && (
              <Field label="Khách hàng *">
                <select value={clientId} onChange={e => setClientId(e.target.value)} className={inputCls}>
                  <option value="">— Chọn khách —</option>
                  {clients.filter(c => !c.archived_at).sort((a, b) => a.name.localeCompare(b.name, 'vi')).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
            )}
            <div className="grid md:grid-cols-3 gap-3">
              {project && (
                <>
                  <Field label="Nhà máy">
                    <select value={siteId} onChange={e => setSiteId(e.target.value)} className={inputCls}>
                      <option value="">— Chưa chọn —</option>
                      {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Vị trí">
                    <select value={positionId} onChange={e => setPositionId(e.target.value)} className={inputCls}>
                      <option value="">— Chưa chọn —</option>
                      {positions.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
                    </select>
                  </Field>
                </>
              )}
              <Field label="Nguồn (khi file không có cột Nguồn)">
                <input value={source} onChange={e => setSource(e.target.value)} list="recruit-import-source" placeholder="VD: CTV giới thiệu" className={inputCls} />
                <datalist id="recruit-import-source">{SOURCE_CHANNELS.map(s => <option key={s} value={s} />)}</datalist>
              </Field>
            </div>
            {project && (
              <div>
                <span className="block text-[12px] font-medium text-[#6E6E73] mb-1">Đưa vào bước</span>
                <div className="flex flex-wrap gap-1.5">
                  {STAGES.map(s => <ChoiceChip key={s.key} active={stage === s.key} onClick={() => setStage(s.key)}>{s.label}</ChoiceChip>)}
                </div>
                {stage === 'started' && !leasing && <p className="text-[12px] text-[#86868B] mt-1">Ngày đi làm lấy từ cột "Ngày đi làm" (không có thì tính là hôm nay).</p>}
              </div>
            )}
          </section>

          {prepared && (
            <div className="mt-3 text-[13px] space-y-1">
              <p className="text-[#1D1D1F]"><b>{fmtNum(prepared.rows.length)}</b> dòng hợp lệ{prepared.rejected.length ? ` · ${prepared.rejected.length} dòng bị loại` : ''}</p>
              {prepared.rejected.slice(0, 8).map(r => <p key={r.row} className="text-[#B25000]">Dòng {r.row}: {r.reason}</p>)}
              {prepared.rejected.length > 8 && <p className="text-[#86868B]">… và {prepared.rejected.length - 8} dòng khác</p>}
              {!mapping.includes('full_name') && <p className="text-[#D70015]">Chưa chọn cột Họ tên.</p>}
            </div>
          )}
        </>
      )}

      {result && (
        <div className="mt-3 rounded-[12px] bg-[#34C759]/[0.12] text-[#1E7B34] text-[13px] px-3.5 py-2.5 space-y-0.5">
          <p className="font-semibold">Xong: {result.created} hồ sơ mới · {result.linked} hồ sơ đã có · {result.apps} lượt ứng tuyển</p>
          {result.skipped.slice(0, 8).map((s, i) => <p key={i} className="text-[#8A4B00]">Bỏ qua dòng {s.row}: {s.reason}</p>)}
        </div>
      )}
      {error && <div className="mt-3"><ErrorBanner>{error}</ErrorBanner></div>}

      <div className={`${SHEET_FOOTER} mt-4 flex items-center justify-end gap-2 bg-[#F2F2F7]/90 md:bg-white/90`}>
        {progress && <span className="text-[12.5px] text-[#86868B] mr-auto">{progress}</span>}
        <button type="button" onClick={onClose} className={PILL_GRAY}>{result ? 'Đóng' : 'Huỷ'}</button>
        {!result && (
          <button type="button" onClick={submit} disabled={busy || !prepared?.rows.length || !mapping.includes('full_name')} className={PILL_PRIMARY}>
            {busy ? 'Đang nhập…' : `Nhập ${fmtNum(prepared?.rows.length ?? 0)} người`}
          </button>
        )}
      </div>
    </Sheet>
  );
}
