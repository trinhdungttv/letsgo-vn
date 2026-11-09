// Nhập nhanh nhiều đơn vị nguồn 1 lượt: dán danh sách (Excel / Zalo / gõ tay) → xem trước → thêm.
// Mỗi dòng: Tên trường | Tỉnh | Người phụ trách | Chức vụ | SĐT. Nhãn, đối thủ đã làm, trạng thái áp chung cả lượt.
// Người phụ trách vào CSKH tệp Sale / CTV, gắn sẵn với trường.
import { useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import { Sheet, ChoiceChip } from '../../../modules/cskh/components/Sheet';
import { CatalogPick } from '../../../modules/cskh/components/CatalogPick';
import { inputCls } from '../../../modules/cskh/ui';
import { bulkCreateSources } from '../../../lib/laborSources/api';
import { nameKey, parseBulk } from '../../../lib/laborSources/bulk';
import {
  KIND_LABEL, KIND_SHORT, MIGRATION_214_HINT, PURSUITS, PURSUIT_LABEL, SOURCE_KINDS, SOURCE_STATUSES, STATUS_LABEL,
  type Pursuit, type SourceKind, type SourceStatus,
} from '../../../lib/laborSources/types';
import { useLabor } from './context';
import { Field, FOOT_BLUE, FOOT_GRAY, Section, SheetFooter, SheetHead } from './form';

const EXAMPLE = 'Trường Cao đẳng Công nghệ cao Đồng Nai\tĐồng Nai\tNguyễn Văn A\tTrưởng phòng QHDN\t0909 123 456';

export default function BulkAddSheet({ onClose }: { onClose: () => void }) {
  const L = useLabor();
  const [text, setText] = useState('');
  const [defKind, setDefKind] = useState<SourceKind>('cao_dang');
  const [status, setStatus] = useState<SourceStatus>('new');
  const [pursuit, setPursuit] = useState<Pursuit>('');
  const [competitorIds, setCompetitorIds] = useState<string[]>([]);
  const [groupId, setGroupId] = useState('');
  /** Ghi đè loại / bỏ chọn theo từng dòng (khoá = số dòng). */
  const [kindOver, setKindOver] = useState<Record<number, SourceKind>>({});
  const [skip, setSkip] = useState<Record<number, boolean>>({});
  const [busy, setBusy] = useState(false);

  const existing = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of [...L.data.sources, ...L.data.trash]) m.set(nameKey(s.name), s.deleted_at ? `${s.name} (thùng rác)` : s.name);
    return m;
  }, [L.data.sources, L.data.trash]);

  const rows = useMemo(() => {
    const seen = new Set<string>();
    return parseBulk(text).map(r => {
      const k = nameKey(r.name);
      const dupExisting = existing.get(k) ?? null;
      const dupInList = seen.has(k);
      seen.add(k);
      return { ...r, kind: kindOver[r.line] ?? r.kind ?? defKind, dupExisting, dupInList };
    });
  }, [text, existing, kindOver, defKind]);

  const included = rows.filter(r => !r.dupInList && !(skip[r.line] ?? !!r.dupExisting));
  const peopleCount = included.filter(r => r.person.trim()).length;
  const group = L.groups.find(g => g.id === groupId) ?? null;

  const submit = async () => {
    if (!included.length) { L.toast('Chưa có dòng nào để thêm'); return; }
    setBusy(true);
    try {
      const res = await bulkCreateSources(included.map(r => ({ name: r.name, province: r.province, kind: r.kind, person: r.person, role: r.role, phone: r.phone })),
        { status, pursuit, competitorIds, groupId: group?.id ?? null, groupTier: group?.base_tier ?? null }, L.user);
      L.toast(`Đã thêm ${res.sources} đơn vị${res.contacts ? ` + ${res.contacts} người phụ trách` : ''}${res.missed214 && (pursuit || competitorIds.length) ? ` — riêng nhãn / đối thủ chưa lưu: ${MIGRATION_214_HINT}` : ''}`);
      await L.reload();
      onClose();
    } catch (e) {
      L.toast((e as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <Sheet label="Nhập nhanh danh sách" onClose={onClose} wide="xl">
      <SheetHead title="Nhập nhanh danh sách" sub="Dán nhiều trường 1 lượt — mỗi dòng 1 trường. Thông tin chi tiết (vị trí, ngành, lịch) bổ sung sau trong hồ sơ." />

      <Section title="Danh sách" cols={1} note={<>Mỗi dòng: <b>Tên trường | Tỉnh | Người phụ trách | Chức vụ | SĐT</b> — dán thẳng từ Excel (cột cách bằng Tab) hoặc cách bằng dấu ; . Chỉ tên trường là bắt buộc; số điện thoại để cột nào cũng được.</>}>
        <textarea value={text} onChange={e => setText(e.target.value)} rows={8} className={`${inputCls} font-mono text-[12.5px]`}
          placeholder={`${EXAMPLE}\nĐại học Lạc Hồng; Đồng Nai\nTrung cấp nghề Nhơn Trạch; Đồng Nai; Cô Lan; GV phụ trách thực tập; 0251 356 0123`} autoFocus />
      </Section>

      <Section title="Áp dụng cho cả lượt">
        <Field label="Nhãn" full>
          <div className="flex flex-wrap gap-1.5">{PURSUITS.map(p => <ChoiceChip key={p || 'none'} active={pursuit === p} onClick={() => setPursuit(p)}>{PURSUIT_LABEL[p]}</ChoiceChip>)}</div>
        </Field>
        <Field label="Đối thủ đã làm với các trường này" full hint="Để trống nếu chưa có đối thủ — sửa riêng từng trường sau được">
          <CatalogPick items={L.competitorOptions} value={competitorIds} onChange={setCompetitorIds} addLabel="Thêm đối thủ…" emptyText="Chưa có đối thủ nào trong Thị trường → Đối thủ." />
        </Field>
        <Field label="Trạng thái hợp tác">
          <select value={status} onChange={e => setStatus(e.target.value as SourceStatus)} className={inputCls}>
            {SOURCE_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </Field>
        <Field label="Loại khi tên không rõ" hint="Tên có &quot;Đại học / Cao đẳng / Trung cấp / Trung tâm / UBND&quot; thì tự nhận">
          <select value={defKind} onChange={e => setDefKind(e.target.value as SourceKind)} className={inputCls}>
            {SOURCE_KINDS.map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </Field>
        <Field label="Nhóm CSKH cho người phụ trách" full hint="VD: Ban giám hiệu / Đại diện trường (tệp Sale / CTV)">
          <select value={groupId} onChange={e => setGroupId(e.target.value)} className={inputCls}>
            <option value="">— Chưa xếp nhóm —</option>
            {L.groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </Field>
      </Section>

      {rows.length > 0 && (
        <Section title={`Xem trước · ${included.length}/${rows.length} dòng sẽ thêm`} cols={1}>
          <ul className="divide-y divide-black/[0.06] -my-1">
            {rows.map(r => {
              const blocked = r.dupInList;
              const on = !blocked && !(skip[r.line] ?? !!r.dupExisting);
              return (
                <li key={r.line} className={`flex items-start gap-2.5 py-2 ${on ? '' : 'opacity-50'}`}>
                  <button type="button" disabled={blocked} onClick={() => setSkip(s => ({ ...s, [r.line]: on }))} aria-label={on ? 'Bỏ dòng này' : 'Lấy dòng này'}
                    className={`mt-0.5 w-[22px] h-[22px] shrink-0 rounded-full border-2 flex items-center justify-center ${on ? 'bg-[#0071E3] border-[#0071E3] text-white' : 'border-[#AEAEB2] text-transparent'}`}>
                    <Check size={12} strokeWidth={3.2} />
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] font-medium text-[#1D1D1F]">{r.name}{r.province && <span className="font-normal text-[#86868B]"> · {r.province}</span>}</p>
                    {(r.person || r.phone) && <p className="text-[12px] text-[#6E6E73]">{[r.person, r.role, r.phone].filter(Boolean).join(' · ')}</p>}
                    {r.dupInList && <p className="text-[12px] text-[#B25000]">Trùng dòng phía trên — bỏ qua</p>}
                    {!r.dupInList && r.dupExisting && <p className="text-[12px] text-[#B25000]">Đã có "{r.dupExisting}" — mặc định bỏ qua, bấm vòng tròn nếu vẫn muốn thêm</p>}
                  </div>
                  <select value={r.kind} onChange={e => setKindOver(o => ({ ...o, [r.line]: e.target.value as SourceKind }))} aria-label="Loại"
                    className="shrink-0 h-8 px-2 rounded-full bg-[rgba(118,118,128,0.12)] text-[12px] font-medium outline-none">
                    {SOURCE_KINDS.map(k => <option key={k} value={k}>{KIND_SHORT[k]} · {KIND_LABEL[k]}</option>)}
                  </select>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      <SheetFooter>
        <span className="flex-1 text-[12.5px] text-[#86868B]">{included.length ? `${included.length} đơn vị · ${peopleCount} người phụ trách` : ''}</span>
        <button type="button" onClick={onClose} className={FOOT_GRAY}>Huỷ</button>
        <button type="button" onClick={() => void submit()} disabled={busy || !included.length} className={FOOT_BLUE}>{busy ? 'Đang thêm…' : `Thêm ${included.length || ''} đơn vị`}</button>
      </SheetFooter>
    </Sheet>
  );
}
