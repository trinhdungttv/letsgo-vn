// Bảng chỉ tiêu nhà máy × tháng: gõ tay từng ô hoặc dán nguyên bảng khách gửi (PDF / Excel / Word).
import { useEffect, useMemo, useState } from 'react';
import { ClipboardPaste } from 'lucide-react';
import { errText, saveTargets } from '../../lib/recruit/api';
import type { TargetCellInput } from '../../lib/recruit/api';
import { monthLabel, monthRange, parsePlanGrid } from '../../lib/recruit/plan';
import type { ParsedPlan } from '../../lib/recruit/plan';
import type { TargetStatus } from '../../lib/recruit/types';
import { useRecruit } from './context';
import { ChoiceChip, ErrorBanner, PILL_GRAY, PILL_PRIMARY, PILL_TINTED, Panel, PillSelect, Quiet, fmtNum, inputCls } from './ui';

const key = (siteId: string, month: string) => `${siteId}|${month}`;

export default function TargetsEditor() {
  const { project, sites, positions, boot, reload, toast, canEdit } = useRecruit();
  const months = useMemo(() => monthRange(project?.period_from, project?.period_to), [project]);
  const [scope, setScope] = useState<string>(''); // '' = chưa chia vị trí
  const positionId = scope || null;
  const existing = useMemo(
    () => boot.targets.filter(t => t.project_id === project?.id && (t.position_id ?? null) === positionId),
    [boot.targets, project, positionId],
  );
  const [draft, setDraft] = useState<Record<string, number>>({});
  const [status, setStatus] = useState<TargetStatus>('planned');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [parsed, setParsed] = useState<ParsedPlan | null>(null);

  // nạp lại bản nháp khi đổi dự án / vị trí / sau khi lưu
  useEffect(() => {
    setDraft(Object.fromEntries(existing.map(t => [key(t.site_id, t.month), t.qty])));
    setStatus(existing.some(t => t.status === 'confirmed') ? 'confirmed' : 'planned');
  }, [existing]);

  if (!project) return null;
  const selectedPos = positions.find(p => p.id === scope);

  const dirty = isDirty(existing, draft, status);
  const val = (siteId: string, m: string) => draft[key(siteId, m)] ?? 0;
  const rowTotal = (siteId: string) => months.reduce((s, m) => s + val(siteId, m), 0);
  const colTotal = (m: string) => sites.reduce((s, x) => s + val(x.id, m), 0);
  const grand = sites.reduce((s, x) => s + rowTotal(x.id), 0);

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const cells: TargetCellInput[] = [];
      for (const s of sites) for (const m of months) {
        const qty = val(s.id, m);
        const old = existing.find(t => t.site_id === s.id && t.month === m);
        if (!old && qty === 0) continue;
        if (old && old.qty === qty && old.status === status) continue;
        cells.push({ site_id: s.id, position_id: positionId, month: m, qty, status });
      }
      if (cells.length) await saveTargets(project.id, cells);
      await reload();
      toast(cells.length ? `Đã lưu ${cells.length} ô chỉ tiêu` : 'Không có thay đổi');
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const readPaste = () => setParsed(parsePlanGrid(pasteText, sites, months));
  const applyPaste = () => {
    if (!parsed) return;
    const next = { ...draft };
    for (const c of parsed.cells) if (months.includes(c.month)) next[key(c.siteId, c.month)] = c.qty;
    setDraft(next);
    setPasteOpen(false);
    setParsed(null);
    setPasteText('');
    toast('Đã đưa số vào bảng — kiểm tra rồi bấm Lưu chỉ tiêu');
  };
  const outside = parsed ? parsed.cells.filter(c => !months.includes(c.month)).length : 0;

  return (
    <Panel title="Chỉ tiêu theo nhà máy × tháng" meta={selectedPos ? `Vị trí: ${selectedPos.title}` : 'Chỉ tiêu chung của nhà máy (chưa chia vị trí) — như bảng khách gửi'}
      action={canEdit && months.length > 0 && sites.length > 0 ? (
        <button type="button" onClick={() => setPasteOpen(v => !v)} className={PILL_TINTED}><ClipboardPaste size={14} /> Dán bảng</button>
      ) : undefined}>
      {months.length === 0 ? (
        <Quiet>Đặt "Từ tháng – Đến tháng" cho dự án (nút Sửa ở trên) để hiện bảng chỉ tiêu.</Quiet>
      ) : sites.length === 0 ? (
        <Quiet>Thêm nhà máy / địa điểm trước, rồi nhập chỉ tiêu.</Quiet>
      ) : (
        <div className="space-y-3 pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <PillSelect label="Chia theo vị trí" value={scope} active={!!scope} onChange={setScope}>
              <option value="">Chưa chia vị trí</option>
              {positions.map(p => <option key={p.id} value={p.id}>{p.title}{p.confirmed ? '' : ' (khảo sát)'}</option>)}
            </PillSelect>
            {canEdit && (
              <div className="flex gap-1.5">
                <ChoiceChip active={status === 'planned'} onClick={() => setStatus('planned')}>Dự kiến</ChoiceChip>
                <ChoiceChip active={status === 'confirmed'} onClick={() => setStatus('confirmed')}>KH đã xác nhận</ChoiceChip>
              </div>
            )}
          </div>

          {pasteOpen && (
            <div className="rounded-[14px] bg-[#F5F5F7] p-3 space-y-2">
              <p className="text-[12.5px] text-[#6E6E73]">Chép nguyên bảng từ file khách gửi (gồm dòng tiêu đề tháng nếu có) rồi dán vào đây. Tên nhà máy phải trùng tên đã thêm ở trên (không cần đúng dấu).</p>
              <textarea value={pasteText} onChange={e => { setPasteText(e.target.value); setParsed(null); }} rows={6}
                placeholder={'Nhà máy T11/26 T12/26 T1/27 …\nVSIP 1 250 46 279 — — —\nVSIP 3 249 445 99 611 675 1.024'} className={`${inputCls} font-mono text-[12px]`} />
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={readPaste} disabled={!pasteText.trim()} className={PILL_GRAY}>Đọc bảng</button>
                {parsed && parsed.cells.length > 0 && <button type="button" onClick={applyPaste} className={PILL_PRIMARY}>Đưa {parsed.cells.length} ô vào bảng</button>}
              </div>
              {parsed && (
                <div className="text-[12.5px] space-y-1">
                  <p className="text-[#1D1D1F]">Đọc được {parsed.cells.length} ô · tổng {fmtNum(parsed.cells.reduce((s, c) => s + c.qty, 0))} người · {parsed.months.length} tháng ({parsed.months.map(monthLabel).join(', ')})</p>
                  {outside > 0 && <p className="text-[#B25000]">{outside} ô nằm ngoài khoảng tháng của dự án — sẽ bỏ qua (sửa "Từ tháng – Đến tháng" nếu cần).</p>}
                  {parsed.unknownSites.length > 0 && <p className="text-[#D70015]">Không thấy nhà máy: {parsed.unknownSites.join(', ')} — thêm nhà máy hoặc sửa tên cho trùng.</p>}
                  {parsed.warnings.map(w => <p key={w} className="text-[#B25000]">{w}</p>)}
                </div>
              )}
            </div>
          )}

          <div className="overflow-x-auto -mx-4 md:-mx-5 px-4 md:px-5">
            <table className="w-full text-[13px] tabular-nums border-separate border-spacing-0">
              <thead>
                <tr className="text-[11.5px] text-[#86868B]">
                  <th className="text-left font-semibold py-1.5 pr-3 sticky left-0 bg-white">Nhà máy</th>
                  {months.map(m => <th key={m} className="font-semibold px-1 py-1.5 text-center min-w-[72px]">{monthLabel(m)}</th>)}
                  <th className="font-semibold pl-2 py-1.5 text-right">Tổng</th>
                </tr>
              </thead>
              <tbody>
                {sites.map(s => (
                  <tr key={s.id}>
                    <td className="py-1 pr-3 font-medium text-[#1D1D1F] whitespace-nowrap sticky left-0 bg-white">{s.name}</td>
                    {months.map(m => (
                      <td key={m} className="px-1 py-1">
                        <input
                          type="number" min={0} inputMode="numeric" disabled={!canEdit}
                          value={val(s.id, m) || ''}
                          placeholder="—"
                          onChange={e => setDraft(cur => ({ ...cur, [key(s.id, m)]: Math.max(0, Math.round(Number(e.target.value) || 0)) }))}
                          className="w-full min-w-[64px] h-9 md:h-8 rounded-[8px] bg-black/[0.04] text-center text-[13px] text-[#1D1D1F] placeholder:text-[#C7C7CC] outline-none focus:bg-white focus:ring-2 focus:ring-[#0071E3]/40 disabled:opacity-70"
                        />
                      </td>
                    ))}
                    <td className="pl-2 py-1 text-right font-semibold text-[#1D1D1F]">{fmtNum(rowTotal(s.id))}</td>
                  </tr>
                ))}
                <tr className="text-[#1D1D1F] font-semibold">
                  <td className="pt-2 pr-3 border-t border-[#E5E5EA] sticky left-0 bg-white">Tổng</td>
                  {months.map(m => <td key={m} className="pt-2 px-1 text-center border-t border-[#E5E5EA]">{fmtNum(colTotal(m)) || '—'}</td>)}
                  <td className="pt-2 pl-2 text-right border-t border-[#E5E5EA] text-[#0066CC]">{fmtNum(grand)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {error && <ErrorBanner>{error}</ErrorBanner>}
          {canEdit && (
            <div className="flex justify-end gap-2">
              {dirty && <button type="button" onClick={() => setDraft(Object.fromEntries(existing.map(t => [key(t.site_id, t.month), t.qty])))} className={PILL_GRAY}>Huỷ thay đổi</button>}
              <button type="button" onClick={save} disabled={busy || !dirty} className={PILL_PRIMARY}>{busy ? 'Đang lưu…' : 'Lưu chỉ tiêu'}</button>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

/** Có khác dữ liệu đã lưu không. */
function isDirty(existing: { site_id: string; month: string; qty: number; status: string }[], draft: Record<string, number>, status: string): boolean {
  const saved = new Map(existing.map(t => [key(t.site_id, t.month), t]));
  for (const [k, v] of Object.entries(draft)) {
    const t = saved.get(k);
    if ((t?.qty ?? 0) !== v) return true;
    if (t && v > 0 && t.status !== status) return true;
  }
  for (const [k] of saved) if (!(k in draft)) return true;
  return false;
}
