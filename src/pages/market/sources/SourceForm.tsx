// Thêm / sửa hồ sơ đơn vị nguồn. Vị trí: dán link Google Maps (kể cả link rút gọn) hoặc tìm theo địa chỉ.
import { useEffect, useMemo, useState } from 'react';
import { Check, Loader2, MapPin, Search } from 'lucide-react';
import { useAuth } from '../../../lib/auth';
import { nominatimGeocode, isValidVnLatLng } from '../../../lib/geo';
import { mapLinkCoords, useMapLink } from '../../../modules/cskh/data/mapLink';
import { canonicalNewProvince, NEW_PROVINCES_SORTED, newProvinceOfMerged } from '../../../lib/laborSources/provinces';
import { Sheet } from '../../../modules/cskh/components/Sheet';
import { ChoiceChip } from '../../../modules/cskh/components/Sheet';
import { inputCls } from '../../../modules/cskh/ui';
import { lastSaveMissed214, saveSource, type SourceInput } from '../../../lib/laborSources/api';
import { CatalogPick } from '../../../modules/cskh/components/CatalogPick';
import {
  KIND_LABEL, MIGRATION_214_HINT, OWNERSHIP_LABEL, PURSUITS, PURSUIT_LABEL, REQUIREMENTS, SOURCE_KINDS, SOURCE_STATUSES, STATUS_LABEL,
  type LaborSource, type Ownership,
} from '../../../lib/laborSources/types';
import { useLabor } from './context';
import { Field, FOOT_BLUE, FOOT_GRAY, intOrNull, Section, SheetFooter, SheetHead } from './form';
import { Stars } from './parts';

const blank = (): SourceInput => ({
  kind: 'cao_dang', name: '', short_name: '', ownership: '', status: 'new', priority: null,
  province: '', address: '', map_link: '', lat: null, lng: null, website: '', fanpage: '', phone: '', email: '',
  logo_url: null, student_total: null, intern_per_year: null, has_dorm: null, requirements: [], requirements_note: '',
  mou_signed_at: null, mou_expires_at: null, mou_note: '', branch_id: null, owner_id: null, tags: [], notes: '',
  competitor_ids: [], competitor_note: '', pursuit: '', recontact_at: null, recontact_task_for: null,
});

function useDebounced<T>(v: T, ms: number): T {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

export default function SourceForm({ source, onClose, onSaved }: {
  source: LaborSource | null;
  onClose: () => void;
  onSaved: (s: LaborSource) => void;
}) {
  const { user, token } = useAuth();
  const { data, branches, users, toast, competitorOptions } = useLabor();
  const [f, setF] = useState<SourceInput>(() => {
    if (!source) return blank();
    // Chỉ lấy các trường nhập được (bỏ id / người tạo / mốc giờ)
    const base = blank();
    const out = { ...base } as Record<string, unknown>;
    for (const k of Object.keys(base)) out[k] = (source as unknown as Record<string, unknown>)[k];
    const init = out as unknown as SourceInput;
    // "Hồ Chí Minh" / "Tỉnh Đồng Nai" → tên chuẩn trong danh sách 34 tỉnh mới để ô chọn hiện đúng
    return { ...init, province: canonicalNewProvince(init.province) ?? init.province };
  });
  const set = <K extends keyof SourceInput>(k: K, v: SourceInput[K]) => setF(prev => ({ ...prev, [k]: v }));
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [tagText, setTagText] = useState(f.tags.join(', '));
  // Tỉnh đã ghi bằng tên cũ / gõ tay (không thuộc 34 tỉnh mới) → giữ nguyên làm 1 lựa chọn để không mất khi mở form
  const legacyProvince = f.province.trim() && !canonicalNewProvince(f.province) ? f.province : '';
  const legacyTo = legacyProvince ? newProvinceOfMerged(legacyProvince) : null;

  // Link Google Maps → toạ độ (link rút gọn mở qua server)
  const link = useMapLink(useDebounced(f.map_link, 500), token);
  useEffect(() => {
    if (link.status === 'ok' && link.coords && isValidVnLatLng(link.coords)) {
      setF(prev => (prev.lat === link.coords!.lat && prev.lng === link.coords!.lng ? prev : { ...prev, lat: link.coords!.lat, lng: link.coords!.lng }));
    }
  }, [link.status, link.coords]);

  // Trùng tên với đơn vị đã có (bỏ dấu, hoa/thường)
  const dup = useMemo(() => {
    const k = f.name.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
    if (k.length < 4) return null;
    return [...data.sources, ...data.trash].find(s => s.id !== source?.id
      && s.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd') === k) ?? null;
  }, [f.name, data.sources, data.trash, source]);

  const locateByAddress = async () => {
    const q = [f.name, f.address, f.province].filter(s => s.trim()).join(', ');
    if (!q.trim()) { toast('Nhập tên / địa chỉ trước'); return; }
    setLocating(true);
    try {
      const p = await nominatimGeocode(f.address.trim() ? `${f.address}, ${f.province}` : q);
      if (p && isValidVnLatLng(p)) { setF(prev => ({ ...prev, lat: p.lat, lng: p.lng })); toast('Đã tìm được vị trí — kiểm tra lại trên bản đồ trong hồ sơ'); }
      else toast('Không tìm được vị trí theo địa chỉ — dán link Google Maps để chính xác');
    } finally { setLocating(false); }
  };

  const submit = async () => {
    if (!f.name.trim()) { toast('Nhập tên đơn vị'); return; }
    if (f.mou_signed_at && f.mou_expires_at && f.mou_expires_at < f.mou_signed_at) { toast('Ngày hết hạn MOU phải sau ngày ký'); return; }
    setSaving(true);
    try {
      const tags = [...new Set(tagText.split(',').map(t => t.trim()).filter(Boolean))].slice(0, 20);
      // Bấm Lưu quá nhanh sau khi dán link (toạ độ chưa kịp đọc) → đọc lại ở đây để không lưu "có link mà không có vị trí"
      let { lat, lng } = f;
      if ((lat == null || lng == null) && f.map_link.trim()) {
        const c = await mapLinkCoords(f.map_link, token);
        if (c && isValidVnLatLng(c)) { lat = c.lat; lng = c.lng; }
      }
      const row = await saveSource({ ...f, lat, lng, tags }, user, source ?? undefined);
      toast(lastSaveMissed214 ? `Đã lưu — riêng đối thủ / nhãn chưa lưu: ${MIGRATION_214_HINT}` : source ? 'Đã lưu hồ sơ' : `Đã thêm "${row.name}"`);
      onSaved(row);
    } catch (e) {
      toast((e as Error).message);
    } finally { setSaving(false); }
  };

  const toggleReq = (k: string) => set('requirements', f.requirements.includes(k) ? f.requirements.filter(x => x !== k) : [...f.requirements, k]);

  return (
    <Sheet label={source ? `Sửa ${source.name}` : 'Thêm đơn vị nguồn'} onClose={onClose} wide="xl">
      <SheetHead title={source ? 'Sửa hồ sơ' : 'Thêm đơn vị nguồn'} sub={source ? source.name : 'Trường, trung tâm hoặc địa phương cung cấp lao động / sinh viên thực tập'} />

      <Section title="Loại đơn vị" cols={1}>
        <div className="flex flex-wrap gap-1.5">
          {SOURCE_KINDS.map(k => <ChoiceChip key={k} active={f.kind === k} onClick={() => set('kind', k)}>{KIND_LABEL[k]}</ChoiceChip>)}
        </div>
      </Section>

      <Section title="Thông tin chung">
        <Field label="Tên đầy đủ *" full hint={dup ? <span className="text-[#B25000]">Đã có "{dup.name}"{dup.deleted_at ? ' trong thùng rác' : ''} — kiểm tra trước khi thêm trùng</span> : undefined}>
          <input value={f.name} onChange={e => set('name', e.target.value)} className={inputCls} placeholder="VD: Trường Cao đẳng Công nghệ cao Đồng Nai" maxLength={200} autoFocus={!source} />
        </Field>
        <Field label="Tên viết tắt" hint="Hiện trên bản đồ, lịch, tên việc nhắc">
          <input value={f.short_name} onChange={e => set('short_name', e.target.value)} className={inputCls} placeholder="VD: CĐ CNC Đồng Nai" maxLength={60} />
        </Field>
        <Field label="Loại hình">
          <select value={f.ownership} onChange={e => set('ownership', e.target.value as Ownership)} className={inputCls}>
            {(['', 'cong_lap', 'tu_thuc'] as Ownership[]).map(o => <option key={o} value={o}>{OWNERSHIP_LABEL[o]}</option>)}
          </select>
        </Field>
        <Field label="Trạng thái hợp tác">
          <select value={f.status} onChange={e => set('status', e.target.value as SourceInput['status'])} className={inputCls}>
            {SOURCE_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </Field>
        <Field label="Mức ưu tiên">
          <div className="h-[38px] flex items-center"><Stars value={f.priority} onChange={v => set('priority', v)} size={20} /></div>
        </Field>
      </Section>

      <Section title="Đánh giá & đối thủ" note="Trường đối thủ đã làm thì hiện cảnh báo ở mọi danh sách — tránh mất thời gian kết nối.">
        <Field label="Nhãn" full>
          <div className="flex flex-wrap gap-1.5">
            {PURSUITS.map(p => <ChoiceChip key={p || 'none'} active={f.pursuit === p} onClick={() => set('pursuit', p)}>{PURSUIT_LABEL[p]}</ChoiceChip>)}
          </div>
        </Field>
        {f.pursuit === 'lien_he_sau' && (
          <Field label="Hẹn liên hệ lại" full hint="Tới ngày này app tự tạo việc &quot;Liên hệ lại&quot; trong Workspace (để trống = không nhắc)">
            <input type="date" value={f.recontact_at ?? ''} onChange={e => set('recontact_at', e.target.value || null)} className={`${inputCls} md:max-w-[220px]`} />
          </Field>
        )}
        <Field label="Đối thủ đã làm với trường" full hint={competitorOptions.length ? 'Chọn từ Thị trường → Đối thủ' : 'Chưa có đối thủ nào trong Thị trường → Đối thủ'}>
          <CatalogPick items={competitorOptions} value={f.competitor_ids} onChange={v => set('competitor_ids', v)} addLabel="Thêm đối thủ…" emptyText="Chưa có đối thủ nào trong Thị trường → Đối thủ." />
        </Field>
        {f.competitor_ids.length > 0 && (
          <Field label="Ghi chú về đối thủ" full>
            <input value={f.competitor_note} onChange={e => set('competitor_note', e.target.value)} className={inputCls} placeholder="VD: đã ký độc quyền khoa Điện tử tới 2027; khoa Cơ khí còn trống" />
          </Field>
        )}
      </Section>

      <Section title="Vị trí" note="Có vị trí mới tính được đường xe khách tới KCN / công ty và hiện trên Bản đồ.">
        <Field label="Link Google Maps" full hint={
          link.status === 'resolving' ? 'Đang mở link rút gọn…'
            : link.status === 'nocoords' ? 'Link không có toạ độ — mở Google Maps, bấm vào đúng điểm rồi chép lại link'
              : link.status === 'fail' ? 'Không mở được link — thử lại hoặc dùng "Tìm theo địa chỉ"' : undefined
        }>
          <input value={f.map_link} onChange={e => set('map_link', e.target.value)} className={inputCls} placeholder="Dán link chia sẻ từ Google Maps" />
        </Field>
        <Field label="Địa chỉ" full>
          <input value={f.address} onChange={e => set('address', e.target.value)} className={inputCls} placeholder="Số nhà, đường, phường / xã" />
        </Field>
        <Field label="Tỉnh / thành" hint={legacyProvince
          ? `"${legacyProvince}" là cách ghi cũ${legacyTo ? ` — từ 1/7/2025 thuộc ${legacyTo}` : ''}. Chọn tỉnh / thành mới trong danh sách.`
          : 'Theo 34 tỉnh / thành sau sáp nhập'}>
          <select value={f.province} onChange={e => set('province', e.target.value)} className={inputCls}>
            <option value="">— Chưa chọn —</option>
            {legacyProvince && <option value={legacyProvince}>{legacyProvince} (cách ghi cũ)</option>}
            {NEW_PROVINCES_SORTED.map(p => (
              <option key={p.name} value={p.name}>{p.merged.length ? `${p.name} (gồm cả ${p.merged.join(', ')})` : p.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Toạ độ">
          <div className="flex items-center gap-2 min-h-[38px]">
            {f.lat != null && f.lng != null
              ? <span className="inline-flex items-center gap-1 text-[13px] text-[#248A3D]"><Check size={14} /> {f.lat.toFixed(5)}, {f.lng.toFixed(5)}</span>
              : <span className="inline-flex items-center gap-1 text-[13px] text-[#86868B]"><MapPin size={14} /> Chưa có</span>}
            <button type="button" onClick={() => void locateByAddress()} disabled={locating}
              className="ml-auto inline-flex items-center gap-1 h-8 px-3 rounded-full bg-[#0071E3]/10 text-[#0066CC] text-[12.5px] font-medium disabled:opacity-40">
              {locating ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />} Tìm theo địa chỉ
            </button>
          </div>
        </Field>
      </Section>

      <Section title="Liên hệ chung">
        <Field label="Điện thoại"><input value={f.phone} onChange={e => set('phone', e.target.value)} className={inputCls} inputMode="tel" /></Field>
        <Field label="Email"><input value={f.email} onChange={e => set('email', e.target.value)} className={inputCls} inputMode="email" /></Field>
        <Field label="Website"><input value={f.website} onChange={e => set('website', e.target.value)} className={inputCls} placeholder="https://" /></Field>
        <Field label="Fanpage"><input value={f.fanpage} onChange={e => set('fanpage', e.target.value)} className={inputCls} placeholder="https://facebook.com/…" /></Field>
        <Field label="Logo (link ảnh)" full><input value={f.logo_url ?? ''} onChange={e => set('logo_url', e.target.value.trim() || null)} className={inputCls} placeholder="Dán link ảnh logo của trường (không bắt buộc)" /></Field>
      </Section>

      <Section title="Quy mô">
        <Field label="Tổng số người học"><input value={f.student_total ?? ''} onChange={e => set('student_total', intOrNull(e.target.value))} className={inputCls} inputMode="numeric" placeholder="VD: 8000" /></Field>
        <Field label="SV đi thực tập / năm (ước tính)"><input value={f.intern_per_year ?? ''} onChange={e => set('intern_per_year', intOrNull(e.target.value))} className={inputCls} inputMode="numeric" placeholder="VD: 1200" /></Field>
        <Field label="Ký túc xá của trường" full>
          <div className="flex gap-1.5">
            {([[true, 'Có'], [false, 'Không'], [null, 'Chưa rõ']] as const).map(([v, l]) => (
              <ChoiceChip key={l} active={f.has_dorm === v} onClick={() => set('has_dorm', v)}>{l}</ChoiceChip>
            ))}
          </div>
        </Field>
      </Section>

      <Section title="Trường yêu cầu doanh nghiệp" cols={1} note="Để biết công ty nào đáp ứng được khi ghép SV.">
        <div className="flex flex-wrap gap-1.5">
          {REQUIREMENTS.map(r => <ChoiceChip key={r.key} active={f.requirements.includes(r.key)} onClick={() => toggleReq(r.key)}>{r.label}</ChoiceChip>)}
        </div>
        <textarea value={f.requirements_note} onChange={e => set('requirements_note', e.target.value)} rows={2} className={inputCls}
          placeholder="Ghi chú thêm: mức phụ cấp tối thiểu, giờ làm, không làm ca đêm…" />
      </Section>

      <Section title="Thoả thuận hợp tác (MOU)">
        <Field label="Ngày ký"><input type="date" value={f.mou_signed_at ?? ''} onChange={e => set('mou_signed_at', e.target.value || null)} className={inputCls} /></Field>
        <Field label="Hết hạn"><input type="date" value={f.mou_expires_at ?? ''} onChange={e => set('mou_expires_at', e.target.value || null)} className={inputCls} /></Field>
        <Field label="Ghi chú MOU" full><input value={f.mou_note} onChange={e => set('mou_note', e.target.value)} className={inputCls} placeholder="Nội dung chính, số văn bản, link Drive…" /></Field>
      </Section>

      <Section title="Phụ trách">
        <Field label="Chi nhánh phụ trách">
          <select value={f.branch_id ?? ''} onChange={e => set('branch_id', e.target.value || null)} className={inputCls}>
            <option value="">— Chưa chọn —</option>
            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </Field>
        <Field label="Người phụ trách" hint="Việc nhắc mùa thực tập giao cho người này">
          <select value={f.owner_id ?? ''} onChange={e => set('owner_id', e.target.value || null)} className={inputCls}>
            <option value="">— Người đang dùng app —</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
        </Field>
        <Field label="Thẻ" full hint="Cách nhau bằng dấu phẩy, VD: điện tử, gần VSIP">
          <input value={tagText} onChange={e => setTagText(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Ghi chú" full>
          <textarea value={f.notes} onChange={e => set('notes', e.target.value)} rows={3} className={inputCls} placeholder="Điểm mạnh, lưu ý khi làm việc với trường…" />
        </Field>
      </Section>

      <SheetFooter>
        <span className="flex-1" />
        <button type="button" onClick={onClose} className={FOOT_GRAY}>Huỷ</button>
        <button type="button" onClick={() => void submit()} disabled={saving} className={FOOT_BLUE}>{saving ? 'Đang lưu…' : source ? 'Lưu hồ sơ' : 'Thêm đơn vị'}</button>
      </SheetFooter>
    </Sheet>
  );
}
