// Hộp thoại con trong hồ sơ đơn vị nguồn: ngành đào tạo, lịch thực tập, đợt gửi SV, người liên hệ.
import { useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Sheet, ChoiceChip } from '../../../modules/cskh/components/Sheet';
import { CatalogPick } from '../../../modules/cskh/components/CatalogPick';
import { inputCls } from '../../../modules/cskh/ui';
import { foldVn } from '../../../lib/companyMatch';
import {
  deleteBatch, deleteProgram, deleteWindow, linkContact, quickAddContact, saveBatch, saveProgram, saveWindow,
} from '../../../lib/laborSources/api';
import {
  BATCH_STATUSES, BATCH_STATUS_LABEL, LEVEL_LABEL, PROGRAM_LEVELS,
  type BatchStatus, type InternWindow, type LaborSource, type ProgramLevel, type SourceBatch, type SourceProgram,
} from '../../../lib/laborSources/types';
import { liveClients, liveLeads, zoneIdOfName } from '../../../lib/laborSources/targets';
import { supabase } from '../../../lib/supabase';
import { useLabor } from './context';
import { Field, FOOT_BLUE, FOOT_GRAY, FOOT_RED, intOrNull, Section, SheetFooter, SheetHead } from './form';

function useSaver(onDone: () => void) {
  const { toast } = useLabor();
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    try { await fn(); toast(msg); onDone(); } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  return { busy, run };
}

// ── Ngành đào tạo ───────────────────────────────────────────────────────────
export function ProgramForm({ source, program, onClose }: { source: LaborSource; program: SourceProgram | null; onClose: () => void }) {
  const L = useLabor();
  const [name, setName] = useState(program?.name ?? '');
  const [level, setLevel] = useState<ProgramLevel>(program?.level ?? (source.kind === 'dai_hoc' ? 'dai_hoc' : source.kind === 'cao_dang' ? 'cao_dang' : source.kind === 'trung_cap' ? 'trung_cap' : ''));
  const [industryIds, setIndustryIds] = useState<string[]>(program?.industry_ids ?? []);
  const [students, setStudents] = useState(program?.students_per_year?.toString() ?? '');
  const [note, setNote] = useState(program?.note ?? '');
  const { busy, run } = useSaver(onClose);
  // Gợi ý tên ngành đã nhập ở trường khác (gõ thống nhất để lọc được)
  const suggestions = useMemo(() => [...new Set(L.data.programs.map(p => p.name.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi')), [L.data.programs]);

  const submit = () => {
    if (!name.trim()) { L.toast('Nhập tên ngành'); return; }
    const count = (L.programsBy.get(source.id) ?? []).length;
    void run(() => saveProgram({ source_id: source.id, name, level, industry_ids: industryIds, students_per_year: intOrNull(students), note: note.trim(), sort_order: program?.sort_order ?? count }, L.user, program?.id),
      program ? 'Đã lưu ngành' : `Đã thêm ngành ${name.trim()}`);
  };

  return (
    <Sheet label="Ngành đào tạo" onClose={onClose} wide>
      <SheetHead title={program ? 'Sửa ngành đào tạo' : 'Thêm ngành đào tạo'} sub={source.short_name || source.name} />
      <Section title="Ngành">
        <Field label="Tên ngành *" full>
          <input value={name} onChange={e => setName(e.target.value)} className={inputCls} list="labor-program-names" placeholder="VD: Điện tử công nghiệp" autoFocus={!program} />
          <datalist id="labor-program-names">{suggestions.map(s => <option key={s} value={s} />)}</datalist>
        </Field>
        <Field label="Trình độ">
          <select value={level} onChange={e => setLevel(e.target.value as ProgramLevel)} className={inputCls}>
            {PROGRAM_LEVELS.map(l => <option key={l} value={l}>{LEVEL_LABEL[l]}</option>)}
          </select>
        </Field>
        <Field label="SV / khoá (ước tính)"><input value={students} onChange={e => setStudents(e.target.value)} className={inputCls} inputMode="numeric" /></Field>
        <Field label="Phù hợp công ty ngành" full hint="Chọn từ Thị trường → Ngành Nghề — dùng để gợi ý trường nào hợp công ty nào">
          <CatalogPick items={L.industries} value={industryIds} onChange={setIndustryIds} addLabel="Thêm ngành…" emptyText="Chưa có ngành nào trong Thị trường → Ngành Nghề." />
        </Field>
        <Field label="Ghi chú" full><input value={note} onChange={e => setNote(e.target.value)} className={inputCls} placeholder="VD: SV năm 3, học kỳ 2 đi thực tập 3 tháng" /></Field>
      </Section>
      <SheetFooter>
        {program && <button type="button" disabled={busy} onClick={() => { if (confirm(`Xoá ngành "${program.name}"? (khôi phục được trong Lịch sử dữ liệu)`)) void run(() => deleteProgram(program, L.user), 'Đã xoá ngành'); }} className={FOOT_RED}><Trash2 size={14} /> Xoá</button>}
        <span className="flex-1" />
        <button type="button" onClick={onClose} className={FOOT_GRAY}>Huỷ</button>
        <button type="button" onClick={submit} disabled={busy} className={FOOT_BLUE}>{busy ? 'Đang lưu…' : 'Lưu'}</button>
      </SheetFooter>
    </Sheet>
  );
}

// ── Lịch thực tập ───────────────────────────────────────────────────────────
export function WindowForm({ source, win, onClose }: { source: LaborSource; win: InternWindow | null; onClose: () => void }) {
  const L = useLabor();
  const programs = L.programsBy.get(source.id) ?? [];
  const [cohort, setCohort] = useState(win?.cohort ?? '');
  const [start, setStart] = useState(win?.start_date ?? '');
  const [end, setEnd] = useState(win?.end_date ?? '');
  const [expected, setExpected] = useState(win?.expected_count?.toString() ?? '');
  const [repeat, setRepeat] = useState(win?.repeat_yearly ?? true);
  const [remind, setRemind] = useState(win?.remind_days ?? 30);
  const [programIds, setProgramIds] = useState<string[]>(win?.program_ids ?? []);
  const [note, setNote] = useState(win?.note ?? '');
  const { busy, run } = useSaver(onClose);

  const submit = () => {
    if (!start) { L.toast('Chọn ngày bắt đầu'); return; }
    if (end && end < start) { L.toast('Ngày kết thúc phải sau ngày bắt đầu'); return; }
    void run(() => saveWindow({
      source_id: source.id, program_ids: programIds, cohort, start_date: start, end_date: end || null,
      expected_count: intOrNull(expected), repeat_yearly: repeat, remind_days: remind, note: note.trim(),
    }, L.user, win?.id), win ? 'Đã lưu lịch thực tập' : 'Đã thêm lịch thực tập');
  };

  return (
    <Sheet label="Lịch thực tập" onClose={onClose} wide>
      <SheetHead title={win ? 'Sửa lịch thực tập' : 'Thêm lịch thực tập'} sub={source.short_name || source.name} />
      <Section title="Mùa thực tập">
        <Field label="Bắt đầu *"><input type="date" value={start} onChange={e => setStart(e.target.value)} className={inputCls} /></Field>
        <Field label="Kết thúc"><input type="date" value={end} onChange={e => setEnd(e.target.value)} className={inputCls} /></Field>
        <Field label="Khoá"><input value={cohort} onChange={e => setCohort(e.target.value)} className={inputCls} placeholder="VD: K47, năm 3" /></Field>
        <Field label="SV dự kiến"><input value={expected} onChange={e => setExpected(e.target.value)} className={inputCls} inputMode="numeric" /></Field>
        <Field label="Năm nào cũng vào mùa này" full>
          <div className="flex gap-1.5">
            <ChoiceChip active={repeat} onClick={() => setRepeat(true)}>Lặp hằng năm</ChoiceChip>
            <ChoiceChip active={!repeat} onClick={() => setRepeat(false)}>Chỉ năm này</ChoiceChip>
          </div>
        </Field>
        {programs.length > 0 && (
          <Field label="Ngành đi thực tập" full hint="Không chọn = cả trường">
            <CatalogPick items={programs.map(p => ({ id: p.id, name: p.name }))} value={programIds} onChange={setProgramIds} addLabel="Thêm ngành…" emptyText="" />
          </Field>
        )}
      </Section>
      <Section title="Nhắc việc trong Workspace" cols={1} note="Trước mùa thực tập, app tự tạo việc &quot;Nguồn LĐ: Liên hệ trường…&quot; cho người phụ trách đơn vị này.">
        <div className="flex flex-wrap gap-1.5">
          {[0, 14, 30, 45, 60].map(d => <ChoiceChip key={d} active={remind === d} onClick={() => setRemind(d)}>{d === 0 ? 'Không nhắc' : `Trước ${d} ngày`}</ChoiceChip>)}
        </div>
        <input value={note} onChange={e => setNote(e.target.value)} className={inputCls} placeholder="Ghi chú: yêu cầu của khoa, giấy tờ cần chuẩn bị…" />
      </Section>
      <SheetFooter>
        {win && <button type="button" disabled={busy} onClick={() => { if (confirm('Xoá lịch thực tập này?')) void run(() => deleteWindow(win, L.user), 'Đã xoá lịch'); }} className={FOOT_RED}><Trash2 size={14} /> Xoá</button>}
        <span className="flex-1" />
        <button type="button" onClick={onClose} className={FOOT_GRAY}>Huỷ</button>
        <button type="button" onClick={submit} disabled={busy} className={FOOT_BLUE}>{busy ? 'Đang lưu…' : 'Lưu'}</button>
      </SheetFooter>
    </Sheet>
  );
}

// ── Đợt gửi SV (chỉ số lượng) ───────────────────────────────────────────────
type CompanyOpt = { key: string; type: 'client' | 'lead'; id: string; name: string; zone: string | null };

export function BatchForm({ source, batch, preset, onClose }: {
  source: LaborSource;
  batch: SourceBatch | null;
  /** Mở từ "Công ty phù hợp" → chọn sẵn công ty. */
  preset?: { type: 'client' | 'lead'; id: string } | null;
  onClose: () => void;
}) {
  const L = useLabor();
  const programs = L.programsBy.get(source.id) ?? [];
  const windows = L.windowsBy.get(source.id) ?? [];
  const companies = useMemo<CompanyOpt[]>(() => {
    const cs = liveClients(L.clients);
    return [
      ...cs.map(c => ({ key: `client:${c.id}`, type: 'client' as const, id: c.id, name: c.name, zone: c.industrial_zones?.[0] ?? null })),
      ...liveLeads(L.leads, cs).map(l => ({ key: `lead:${l.id}`, type: 'lead' as const, id: l.id, name: l.company_name, zone: l.region })),
    ].sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  }, [L.clients, L.leads]);
  const initialKey = batch?.client_id ? `client:${batch.client_id}` : batch?.lead_id ? `lead:${batch.lead_id}` : preset ? `${preset.type}:${preset.id}` : '';
  const [companyKey, setCompanyKey] = useState(initialKey);
  const [companyText, setCompanyText] = useState(batch && !batch.client_id && !batch.lead_id ? batch.company_name : '');
  const [query, setQuery] = useState('');
  const picked = companies.find(c => c.key === companyKey) ?? null;
  const [zoneId, setZoneId] = useState(batch?.zone_id ?? (picked ? zoneIdOfName(picked.zone, L.zones) ?? '' : ''));
  const [start, setStart] = useState(batch?.start_date ?? '');
  const [end, setEnd] = useState(batch?.end_date ?? '');
  const [sent, setSent] = useState(batch?.sent_count?.toString() ?? '');
  const [passed, setPassed] = useState(batch?.passed_count?.toString() ?? '');
  const [status, setStatus] = useState<BatchStatus>(batch?.status ?? 'done');
  const [programIds, setProgramIds] = useState<string[]>(batch?.program_ids ?? []);
  const [windowId, setWindowId] = useState(batch?.window_id ?? '');
  const [note, setNote] = useState(batch?.note ?? '');
  const { busy, run } = useSaver(onClose);

  const shown = useMemo(() => {
    const k = foldVn(query).trim();
    return (k ? companies.filter(c => foldVn(c.name).includes(k)) : companies).slice(0, 30);
  }, [companies, query]);

  const choose = (c: CompanyOpt | null) => {
    setCompanyKey(c?.key ?? '');
    setQuery('');
    if (c) { setCompanyText(''); const z = zoneIdOfName(c.zone, L.zones); if (z) setZoneId(z); }
  };

  const submit = () => {
    const s = intOrNull(sent) ?? 0;
    const p = intOrNull(passed) ?? 0;
    if (!picked && !companyText.trim()) { L.toast('Chọn công ty nhận SV (hoặc gõ tên)'); return; }
    if (p > s) { L.toast('Số đạt không được lớn hơn số gửi đi'); return; }
    if (end && start && end < start) { L.toast('Ngày kết thúc phải sau ngày bắt đầu'); return; }
    void run(() => saveBatch({
      source_id: source.id, window_id: windowId || null, program_ids: programIds,
      client_id: picked?.type === 'client' ? picked.id : null,
      lead_id: picked?.type === 'lead' ? picked.id : null,
      company_name: picked?.name ?? companyText,
      zone_id: zoneId || null, start_date: start || null, end_date: end || null,
      sent_count: s, passed_count: p, status, note: note.trim(),
    }, L.user, batch?.id), batch ? 'Đã lưu đợt' : 'Đã thêm đợt gửi SV');
  };

  return (
    <Sheet label="Đợt gửi sinh viên" onClose={onClose} wide>
      <SheetHead title={batch ? 'Sửa đợt gửi SV' : 'Thêm đợt gửi SV'} sub={`${source.short_name || source.name} — chỉ ghi số lượng, không lưu thông tin từng SV`} />
      <Section title="Công ty nhận" cols={1}>
        {picked ? (
          <div className="flex items-center gap-2 rounded-[10px] bg-[#0071E3]/[0.08] px-3 py-2">
            <span className="flex-1 min-w-0 text-[14px] font-semibold text-[#0058B0] truncate">{picked.name}</span>
            <span className="text-[12px] text-[#6E6E73]">{picked.type === 'client' ? 'Khách hàng' : 'Công ty / Dự án'}</span>
            <button type="button" onClick={() => choose(null)} className="text-[12.5px] font-medium text-[#0066CC]">Đổi</button>
          </div>
        ) : (
          <>
            <input value={query} onChange={e => setQuery(e.target.value)} className={inputCls} placeholder="Tìm công ty trong Khách hàng / Công ty-Dự án…" />
            {query && (
              <ul className="max-h-[220px] overflow-y-auto rounded-[10px] bg-white shadow-[0_0_0_0.5px_rgba(0,0,0,0.12)]">
                {shown.map(c => (
                  <li key={c.key}><button type="button" onClick={() => choose(c)} className="w-full text-left px-3 py-2 text-[13px] hover:bg-[#F5F5F7] flex justify-between gap-2">
                    <span className="truncate">{c.name}</span><span className="text-[11.5px] text-[#86868B] shrink-0">{c.type === 'client' ? 'Khách hàng' : 'Công ty/Dự án'}</span>
                  </button></li>
                ))}
                {!shown.length && <li className="px-3 py-2 text-[12.5px] text-[#86868B]">Không thấy — gõ tên ở ô dưới</li>}
              </ul>
            )}
            <input value={companyText} onChange={e => setCompanyText(e.target.value)} className={inputCls} placeholder="Hoặc gõ tên công ty chưa có trong hệ thống" />
          </>
        )}
        <select value={zoneId} onChange={e => setZoneId(e.target.value)} className={inputCls} aria-label="KCN">
          <option value="">— KCN —</option>
          {L.zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
        </select>
      </Section>
      <Section title="Số lượng & thời gian">
        {/* 2 ô số luôn nằm cạnh nhau (kể cả điện thoại) cho nhập nhanh */}
        <div className="md:col-span-2 grid grid-cols-2 gap-3">
          <Field label="Gửi đi (SV)"><input value={sent} onChange={e => setSent(e.target.value)} className={`${inputCls} text-[16px] font-semibold`} inputMode="numeric" placeholder="0" /></Field>
          <Field label="Đạt (được nhận)"><input value={passed} onChange={e => setPassed(e.target.value)} className={`${inputCls} text-[16px] font-semibold`} inputMode="numeric" placeholder="0" /></Field>
        </div>
        <Field label="Từ ngày"><input type="date" value={start} onChange={e => setStart(e.target.value)} className={inputCls} /></Field>
        <Field label="Đến ngày"><input type="date" value={end} onChange={e => setEnd(e.target.value)} className={inputCls} /></Field>
        <Field label="Tình trạng" full>
          <div className="flex flex-wrap gap-1.5">{BATCH_STATUSES.map(s => <ChoiceChip key={s} active={status === s} onClick={() => setStatus(s)}>{BATCH_STATUS_LABEL[s]}</ChoiceChip>)}</div>
        </Field>
        {programs.length > 0 && (
          <Field label="Ngành" full>
            <CatalogPick items={programs.map(p => ({ id: p.id, name: p.name }))} value={programIds} onChange={setProgramIds} addLabel="Thêm ngành…" emptyText="" />
          </Field>
        )}
        {windows.length > 0 && (
          <Field label="Thuộc mùa thực tập" full>
            <select value={windowId} onChange={e => setWindowId(e.target.value)} className={inputCls}>
              <option value="">— Không gắn —</option>
              {windows.map(w => <option key={w.id} value={w.id}>{[w.cohort, `${w.start_date.slice(8, 10)}/${w.start_date.slice(5, 7)}`].filter(Boolean).join(' · ')}{w.repeat_yearly ? ' (hằng năm)' : ''}</option>)}
            </select>
          </Field>
        )}
        <Field label="Ghi chú" full><input value={note} onChange={e => setNote(e.target.value)} className={inputCls} placeholder="Lý do không đạt, phản hồi của công ty…" /></Field>
      </Section>
      <SheetFooter>
        {batch && <button type="button" disabled={busy} onClick={() => { if (confirm('Xoá đợt này?')) void run(() => deleteBatch(batch, L.user), 'Đã xoá đợt'); }} className={FOOT_RED}><Trash2 size={14} /> Xoá</button>}
        <span className="flex-1" />
        <button type="button" onClick={onClose} className={FOOT_GRAY}>Huỷ</button>
        <button type="button" onClick={submit} disabled={busy} className={FOOT_BLUE}>{busy ? 'Đang lưu…' : 'Lưu'}</button>
      </SheetFooter>
    </Sheet>
  );
}

// ── Người liên hệ (CSKH tệp Sale / CTV) ─────────────────────────────────────
export function ContactSheet({ source, onClose }: { source: LaborSource; onClose: () => void }) {
  const L = useLabor();
  const [mode, setMode] = useState<'new' | 'link'>('new');
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [phone, setPhone] = useState('');
  const [groupId, setGroupId] = useState('');
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<{ id: string; name: string; sale_company: string | null; labor_source_id: string | null }[]>([]);
  const { busy, run } = useSaver(onClose);
  const group = L.groups.find(g => g.id === groupId) ?? null;

  const search = async (q: string) => {
    setQuery(q);
    if (q.trim().length < 2) { setFound([]); return; }
    const { data } = await supabase.from('contacts').select('id, name, sale_company, labor_source_id').eq('kind', 'sale').ilike('name', `%${q.trim()}%`).limit(20);
    setFound((data ?? []) as typeof found);
  };

  return (
    <Sheet label="Người liên hệ" onClose={onClose} wide>
      <SheetHead title="Người liên hệ của trường" sub="Lưu ở CSKH tệp Sale / CTV — chăm sóc (sinh nhật, nhật ký, quà) như các Sale khác" />
      <div className="mt-4 flex gap-1.5">
        <ChoiceChip active={mode === 'new'} onClick={() => setMode('new')}>Thêm người mới</ChoiceChip>
        <ChoiceChip active={mode === 'link'} onClick={() => setMode('link')}>Gắn người đã có</ChoiceChip>
      </div>
      {mode === 'new' ? (
        <>
          <Section title="Thông tin">
            <Field label="Họ tên *" full><input value={name} onChange={e => setName(e.target.value)} className={inputCls} autoFocus /></Field>
            <Field label="Chức vụ"><input value={role} onChange={e => setRole(e.target.value)} className={inputCls} placeholder="VD: Phó Hiệu trưởng, Trưởng phòng QHDN" /></Field>
            <Field label="Điện thoại"><input value={phone} onChange={e => setPhone(e.target.value)} className={inputCls} inputMode="tel" /></Field>
            <Field label="Nhóm (CSKH)" full hint={L.groups.length ? 'VD: Ban giám hiệu / Đại diện trường — tạo nhóm ở CSKH → tệp Sale / CTV' : 'Chưa có nhóm Sale nào — tạo ở CSKH → tệp Sale / CTV'}>
              <select value={groupId} onChange={e => setGroupId(e.target.value)} className={inputCls}>
                <option value="">— Chưa xếp nhóm —</option>
                {L.groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </Field>
          </Section>
          <SheetFooter>
            <span className="flex-1" />
            <button type="button" onClick={onClose} className={FOOT_GRAY}>Huỷ</button>
            <button type="button" disabled={busy} className={FOOT_BLUE}
              onClick={() => void run(() => quickAddContact({ name, role, phone, groupId: group?.id ?? null, groupTier: group?.base_tier ?? null }, source, L.user), `Đã thêm ${name.trim()}`)}>
              {busy ? 'Đang lưu…' : 'Thêm'}
            </button>
          </SheetFooter>
        </>
      ) : (
        <>
          <Section title="Tìm trong tệp Sale / CTV" cols={1}>
            <input value={query} onChange={e => void search(e.target.value)} className={inputCls} placeholder="Gõ tên người (ít nhất 2 chữ)" autoFocus />
            <ul className="divide-y divide-[#E5E5EA]">
              {found.map(c => {
                const other = c.labor_source_id && c.labor_source_id !== source.id ? L.data.sources.find(s => s.id === c.labor_source_id) : null;
                const here = c.labor_source_id === source.id;
                return (
                  <li key={c.id} className="flex items-center gap-2 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] text-[#1D1D1F] truncate">{c.name}</p>
                      <p className="text-[12px] text-[#86868B] truncate">{other ? `Đang gắn: ${other.name}` : c.sale_company || '—'}</p>
                    </div>
                    {here ? <span className="text-[12px] text-[#248A3D]">Đã gắn</span> : (
                      <button type="button" disabled={busy} className="h-8 px-3 rounded-full bg-[#0071E3]/10 text-[#0066CC] text-[12.5px] font-medium"
                        onClick={() => void run(() => linkContact(c.id, source, other?.name ?? '', L.user), `Đã gắn ${c.name}`)}>Gắn</button>
                    )}
                  </li>
                );
              })}
              {query.trim().length >= 2 && !found.length && <li className="py-3 text-[13px] text-[#86868B]">Không thấy ai — chuyển sang "Thêm người mới"</li>}
            </ul>
          </Section>
          <SheetFooter><span className="flex-1" /><button type="button" onClick={onClose} className={FOOT_GRAY}>Xong</button></SheetFooter>
        </>
      )}
    </Sheet>
  );
}
