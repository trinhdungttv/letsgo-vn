// Pháp lý — thêm / sửa hồ sơ 1 PHÁP NHÂN: nhận diện, đăng ký doanh nghiệp, trụ sở, vốn & người đại diện,
// thành viên góp vốn, ngành nghề (dán cả danh sách), giấy phép con, tài khoản ngân hàng.
// Thêm mới có nút "Lấy từ pháp nhân báo giá" (Phương án giá, migration 161) để khỏi gõ lại tên / MST / địa chỉ.
import { useState, type ReactNode } from 'react';
import { Download, Loader2, Plus, Star, Upload, X } from 'lucide-react';
import { Sheet, SHEET_FOOTER, ChoiceChip } from '../../modules/cskh/components/Sheet';
import { saveEntity } from '../../lib/legal/api';
import { fmtMoney, fmtMoneyShort, parseMoney } from '../../lib/legal/timeline';
import {
  BUSINESS_TYPES, emptyInfo, ENTITY_STATUS, rid, SWATCHES,
  type EntityStatus, type LegalEntity, type LegalEntityInfo,
} from '../../lib/legal/types';
import { uploadLegalImage } from '../../lib/legal/upload';
import { listEntities } from '../../lib/costPlan/api';
import { getStoredSessionToken } from '../../lib/sessionToken';
import type { QuoteEntity } from '../../lib/costPlan/entity';
import { BTN_PRIMARY, BTN_SECONDARY, POPOVER } from '../workspace/wsTheme';
import { DraftNotice, useFormDraft } from './useFormDraft';
import { EntityLogo, Field, INPUT_CLS, TEXTAREA_CLS, Swatches } from './ui';

type Draft = Omit<LegalEntity, 'id' | 'updated_by' | 'updated_at' | 'created_at' | 'deleted_at' | 'charter_capital'> & { capitalText: string };

function toDraft(e: LegalEntity | null, order: number): Draft {
  return {
    name: e?.name ?? '', short_name: e?.short_name ?? '', english_name: e?.english_name ?? '', tax_code: e?.tax_code ?? '',
    business_type: e?.business_type ?? '', founded_date: e?.founded_date ?? null, registry_office: e?.registry_office ?? '',
    address: e?.address ?? '', phone: e?.phone ?? '', email: e?.email ?? '', website: e?.website ?? '',
    capitalText: e?.charter_capital != null ? Math.round(e.charter_capital).toLocaleString('vi-VN') : '',
    legal_rep: e?.legal_rep ?? '', legal_rep_title: e?.legal_rep_title ?? '', status: e?.status ?? 'active',
    color: e?.color ?? SWATCHES[order % SWATCHES.length], logo_url: e?.logo_url ?? null, drive_url: e?.drive_url ?? '',
    quote_entity_id: e?.quote_entity_id ?? null, info: e ? structuredClone(e.info) : emptyInfo(), note: e?.note ?? '',
    sort_order: e?.sort_order ?? order,
  };
}

/** "7830 – Cung ứng và quản lý nguồn lao động" / "7830 Cung ứng…" / tab từ Excel → { code, name }. */
function parseIndustryLines(text: string): { code: string; name: string }[] {
  return text.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const m = /^(\d{3,7})\s*[-–—:.\t|]?\s*(.*)$/.exec(l);
    return m ? { code: m[1], name: m[2].trim() } : { code: '', name: l };
  }).filter(x => x.code || x.name);
}

function Group({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-[16px] bg-white md:bg-black/[0.025] p-3.5 md:p-4">
      <div className="flex items-center gap-2 mb-3">
        <h4 className="text-[13px] font-semibold uppercase tracking-[0.05em] text-[#6E6E73] flex-1">{title}</h4>
        {action}
      </div>
      {children}
    </section>
  );
}

const SMALL_BTN = 'inline-flex items-center gap-1 text-[12.5px] font-medium text-[#0066CC] hover:underline';
const ROW_X = 'shrink-0 w-8 h-8 inline-flex items-center justify-center rounded-full text-[#AEAEB2] hover:text-[#D70015] hover:bg-[#FF3B30]/10';

export default function EntityForm({ initial, count, userName, toast, onClose, onSaved }: {
  initial: LegalEntity | null; count: number; userName: string; toast: (m: string) => void;
  onClose: () => void; onSaved: (e: LegalEntity) => void;
}) {
  const [d, setD] = useState<Draft>(() => toDraft(initial, count));
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [indPaste, setIndPaste] = useState<string | null>(null);
  const [quotes, setQuotes] = useState<QuoteEntity[] | null>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD(x => ({ ...x, [k]: v }));
  const setInfo = <K extends keyof LegalEntityInfo>(k: K, v: LegalEntityInfo[K]) => setD(x => ({ ...x, info: { ...x.info, [k]: v } }));
  const draft = useFormDraft<Draft>(`entity:${initial?.id ?? 'new'}`, d, setD);
  const discard = () => { draft.clear(); onClose(); };
  const capital = parseMoney(d.capitalText);

  const loadQuotes = async () => {
    const token = getStoredSessionToken();
    if (!token) { toast('Phiên đăng nhập hết hạn — đăng nhập lại'); return; }
    try {
      // Chỉ những pháp nhân báo giá CHƯA có trong Pháp lý (đã có thì giấy tờ tự lấy thông tin từ đây rồi)
      const left = (await listEntities(token)).entities.filter(e => !e.legal_id);
      if (!left.length) toast('Không còn pháp nhân báo giá nào chưa có trong Pháp lý');
      setQuotes(left);
    } catch (e) { toast((e as Error).message); }
  };
  const pickQuote = (q: QuoteEntity) => {
    setD(x => ({
      ...x, quote_entity_id: q.stamp_id ?? q.id,
      name: x.name || q.data.name || q.label, short_name: x.short_name || q.label, address: x.address || q.data.address,
      tax_code: x.tax_code || q.data.taxCode, phone: x.phone || q.data.phone, email: x.email || q.data.email,
      website: x.website || q.data.website, legal_rep: x.legal_rep || q.data.signerName, legal_rep_title: x.legal_rep_title || q.data.signerTitle,
      logo_url: x.logo_url,
    }));
    setQuotes(null);
    toast(`Đã điền từ "${q.label}" — kiểm tra lại rồi Lưu`);
  };

  const uploadLogo = async (f: File) => {
    setUploading(true);
    try { set('logo_url', await uploadLegalImage(f, 600)); } catch (e) { toast((e as Error).message); }
    setUploading(false);
  };

  const submit = async () => {
    if (!d.name.trim()) { toast('Chưa nhập tên công ty'); return; }
    if (d.capitalText.trim() && capital == null) { toast('Vốn điều lệ chưa đúng — vd 5.000.000.000 hoặc 5 tỷ'); return; }
    setBusy(true);
    try {
      const { capitalText: _c, ...rest } = d;
      void _c;
      const clean: LegalEntityInfo = {
        owners: d.info.owners.filter(o => o.name.trim()),
        industries: d.info.industries.filter(i => i.code.trim() || i.name.trim()),
        banks: d.info.banks.filter(b => b.bank.trim() || b.number.trim()),
        licenses: d.info.licenses.filter(l => l.name.trim()),
        registrationUrl: d.info.registrationUrl.trim(),
      };
      const saved = await saveEntity({
        ...rest, id: initial?.id ?? null, name: d.name.trim(), short_name: d.short_name.trim(), charter_capital: capital, info: clean,
        logo_url: d.logo_url?.trim() || null,
      }, userName);
      draft.clear();
      onSaved(saved);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const txt = (k: keyof Draft, placeholder = '', type = 'text') => (
    <input type={type} value={(d[k] as string | null) ?? ''} onChange={e => set(k, (type === 'date' ? e.target.value || null : e.target.value) as never)} placeholder={placeholder} className={INPUT_CLS} />
  );

  return (
    <Sheet label={initial ? 'Sửa pháp nhân' : 'Thêm pháp nhân'} onClose={onClose} wide="xl">
      <div className="flex items-center gap-3 pr-10 mb-4">
        <EntityLogo name={d.short_name || d.name || '?'} color={d.color} url={d.logo_url} size={46} />
        <div className="min-w-0 flex-1">
          <h3 className="text-[19px] font-semibold tracking-[-0.02em] text-[#1D1D1F]">{initial ? 'Sửa hồ sơ pháp nhân' : 'Thêm pháp nhân'}</h3>
          <div className="text-[12px] text-[#86868B]">Thông tin theo Giấy chứng nhận đăng ký doanh nghiệp hiện hành</div>
        </div>
        {!initial && (
          <div className="relative">
            <button type="button" onClick={() => void loadQuotes()} className={`${BTN_SECONDARY} h-8 px-3 text-[12px]`}><Download size={13} /> <span className="hidden sm:inline">Lấy từ pháp nhân báo giá</span></button>
            {quotes && quotes.length > 0 && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setQuotes(null)} />
                <div className={`absolute right-0 top-10 z-50 w-72 py-1.5 ${POPOVER}`}>
                  {quotes.map(q => (
                    <button key={q.id} type="button" onClick={() => pickQuote(q)} className="w-full text-left px-3.5 py-2 hover:bg-black/[0.05]">
                      <div className="text-[13px] font-medium text-[#1D1D1F] truncate">{q.label}</div>
                      <div className="text-[11.5px] text-[#86868B] truncate">{[q.data.name, q.data.taxCode].filter(Boolean).join(' · ')}</div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {draft.restored && <DraftNotice onDiscard={discard} />}
      <div className="space-y-3">
        <Group title="Nhận diện">
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Tên công ty (đầy đủ)" className="sm:col-span-2">{txt('name', 'CÔNG TY TNHH …')}</Field>
            <Field label="Tên viết tắt / tên gọi">{txt('short_name', "vd Let's Go HCM")}</Field>
            <Field label="Tên tiếng Anh">{txt('english_name', '… COMPANY LIMITED')}</Field>
            <Field label="Màu nhận diện" className="sm:col-span-2"><Swatches value={d.color} onChange={c => set('color', c)} /></Field>
            <Field label="Logo" className="sm:col-span-2">
              <div className="flex gap-2">
                <input value={d.logo_url ?? ''} onChange={e => set('logo_url', e.target.value)} placeholder="Dán link ảnh logo, hoặc tải ảnh lên" className={`${INPUT_CLS} flex-1`} />
                <label className="shrink-0 inline-flex items-center gap-1.5 h-10 md:h-9 px-3 rounded-[10px] bg-black/[0.05] text-[13px] font-medium cursor-pointer hover:bg-black/[0.08]">
                  {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Tải lên
                  <input type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void uploadLogo(f); }} />
                </label>
              </div>
            </Field>
            <Field label="Trạng thái" className="sm:col-span-2">
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(ENTITY_STATUS) as EntityStatus[]).map(s => <ChoiceChip key={s} active={d.status === s} onClick={() => set('status', s)}>{ENTITY_STATUS[s].label}</ChoiceChip>)}
              </div>
            </Field>
          </div>
        </Group>

        <Group title="Đăng ký doanh nghiệp">
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Mã số doanh nghiệp / MST">{txt('tax_code', '0312345678')}</Field>
            <Field label="Loại hình">
              <input list="legal-business-types" value={d.business_type} onChange={e => set('business_type', e.target.value)} placeholder="Công ty TNHH một thành viên" className={INPUT_CLS} />
              <datalist id="legal-business-types">{BUSINESS_TYPES.map(t => <option key={t} value={t} />)}</datalist>
            </Field>
            <Field label="Ngày cấp lần đầu">{txt('founded_date', '', 'date')}</Field>
            <Field label="Nơi cấp">{txt('registry_office', 'Phòng ĐKKD – Sở KH&ĐT TP.HCM')}</Field>
            <Field label="Link file Giấy chứng nhận ĐKDN (Google Drive)" className="sm:col-span-2" hint="Dán link để xem file gốc ngay trong app — bấm icon file ở trang hồ sơ">
              <input value={d.info.registrationUrl} onChange={e => setInfo('registrationUrl', e.target.value)} placeholder="https://drive.google.com/file/d/…" inputMode="url" className={INPUT_CLS} />
            </Field>
          </div>
        </Group>

        <Group title="Trụ sở & liên hệ">
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Địa chỉ trụ sở chính" className="sm:col-span-2">{txt('address', 'Số nhà, đường, phường/xã, tỉnh/thành')}</Field>
            <Field label="Điện thoại">{txt('phone')}</Field>
            <Field label="Email">{txt('email')}</Field>
            <Field label="Website">{txt('website')}</Field>
            <Field label="Thư mục Google Drive của pháp nhân">{txt('drive_url', 'https://drive.google.com/drive/folders/…')}</Field>
          </div>
        </Group>

        <Group title="Vốn & người đại diện">
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Vốn điều lệ" hint={capital != null ? <span className="text-[#1E7B34]">= {fmtMoney(capital)} ({fmtMoneyShort(capital)})</span> : 'Gõ 5.000.000.000 hoặc 5 tỷ'}>
              <input value={d.capitalText} onChange={e => set('capitalText', e.target.value)} inputMode="decimal" placeholder="5.000.000.000" className={INPUT_CLS} />
            </Field>
            <div />
            <Field label="Người đại diện theo pháp luật">{txt('legal_rep', 'Họ tên')}</Field>
            <Field label="Chức danh">{txt('legal_rep_title', 'Giám đốc')}</Field>
          </div>
        </Group>

        <Group title={`Thành viên góp vốn / cổ đông (${d.info.owners.length})`}
          action={<button type="button" className={SMALL_BTN} onClick={() => setInfo('owners', [...d.info.owners, { id: rid(), name: '', capital: null, percent: null, note: '' }])}><Plus size={13} /> Thêm</button>}>
          {!d.info.owners.length && <div className="text-[12.5px] text-[#86868B]">Chưa có — bấm Thêm.</div>}
          <div className="space-y-2">
            {d.info.owners.map(o => {
              const upd = (patch: Partial<typeof o>) => setInfo('owners', d.info.owners.map(x => (x.id === o.id ? { ...x, ...patch } : x)));
              return (
                <div key={o.id} className="grid grid-cols-[1fr_auto] sm:grid-cols-[1.4fr_1fr_80px_auto] gap-2 items-center">
                  <input value={o.name} onChange={e => upd({ name: e.target.value })} placeholder="Họ tên / tên tổ chức" className={`${INPUT_CLS} col-span-1`} />
                  <button type="button" className={`${ROW_X} sm:hidden`} onClick={() => setInfo('owners', d.info.owners.filter(x => x.id !== o.id))} aria-label="Xoá"><X size={15} /></button>
                  <input defaultValue={o.capital != null ? Math.round(o.capital).toLocaleString('vi-VN') : ''} onBlur={e => upd({ capital: parseMoney(e.target.value) })} placeholder="Số vốn góp" className={INPUT_CLS} />
                  <input value={o.percent ?? ''} onChange={e => upd({ percent: e.target.value === '' ? null : Number(e.target.value.replace(',', '.')) || 0 })} placeholder="%" inputMode="decimal" className={INPUT_CLS} />
                  <button type="button" className={`${ROW_X} hidden sm:inline-flex`} onClick={() => setInfo('owners', d.info.owners.filter(x => x.id !== o.id))} aria-label="Xoá"><X size={15} /></button>
                </div>
              );
            })}
          </div>
        </Group>

        <Group title={`Ngành nghề kinh doanh (${d.info.industries.length})`}
          action={<div className="flex gap-3">
            <button type="button" className={SMALL_BTN} onClick={() => setIndPaste(indPaste == null ? '' : null)}>Dán danh sách</button>
            <button type="button" className={SMALL_BTN} onClick={() => setInfo('industries', [...d.info.industries, { id: rid(), code: '', name: '', main: !d.info.industries.length }])}><Plus size={13} /> Thêm</button>
          </div>}>
          {indPaste != null && (
            <div className="mb-3">
              <textarea value={indPaste} onChange={e => setIndPaste(e.target.value)} rows={5} placeholder={'Mỗi dòng 1 ngành — dán từ Giấy ĐKDN hoặc Cổng thông tin quốc gia:\n7830 – Cung ứng và quản lý nguồn lao động\n7810 Hoạt động của các trung tâm, đại lý tư vấn, giới thiệu và môi giới lao động'} className={TEXTAREA_CLS} />
              <div className="flex justify-end gap-2 mt-1.5">
                <button type="button" onClick={() => setIndPaste(null)} className={`${BTN_SECONDARY} h-8 px-3 text-[12.5px]`}>Huỷ</button>
                <button type="button" disabled={!indPaste.trim()} onClick={() => {
                  const rows = parseIndustryLines(indPaste).map((r, i) => ({ id: rid(), ...r, main: !d.info.industries.length && i === 0 }));
                  setInfo('industries', [...d.info.industries, ...rows]);
                  setIndPaste(null);
                  toast(`Đã thêm ${rows.length} ngành`);
                }} className={`${BTN_PRIMARY} h-8 px-3 text-[12.5px]`}>Thêm vào danh sách</button>
              </div>
            </div>
          )}
          {!d.info.industries.length && indPaste == null && <div className="text-[12.5px] text-[#86868B]">Chưa có — Thêm từng ngành hoặc dán cả danh sách.</div>}
          <div className="space-y-2">
            {d.info.industries.map(i => {
              const upd = (patch: Partial<typeof i>) => setInfo('industries', d.info.industries.map(x => (x.id === i.id ? { ...x, ...patch } : x)));
              return (
                <div key={i.id} className="flex gap-2 items-center">
                  <button type="button" title={i.main ? 'Ngành chính' : 'Đặt làm ngành chính'} onClick={() => setInfo('industries', d.info.industries.map(x => ({ ...x, main: x.id === i.id })))}
                    className={`shrink-0 w-8 h-8 inline-flex items-center justify-center rounded-full ${i.main ? 'text-[#FF9500]' : 'text-[#C7C7CC] hover:text-[#FF9500]'}`}><Star size={15} className={i.main ? 'fill-[#FF9500]' : ''} /></button>
                  <input value={i.code} onChange={e => upd({ code: e.target.value })} placeholder="Mã" className={`${INPUT_CLS} !w-[84px] shrink-0`} />
                  <input value={i.name} onChange={e => upd({ name: e.target.value })} placeholder="Tên ngành" className={`${INPUT_CLS} flex-1`} />
                  <button type="button" className={ROW_X} onClick={() => setInfo('industries', d.info.industries.filter(x => x.id !== i.id))} aria-label="Xoá"><X size={15} /></button>
                </div>
              );
            })}
          </div>
        </Group>

        <Group title={`Giấy phép con (${d.info.licenses.length})`}
          action={<button type="button" className={SMALL_BTN} onClick={() => setInfo('licenses', [...d.info.licenses, { id: rid(), name: '', number: '', issuer: '', issued: '', expires: '', url: '', note: '' }])}><Plus size={13} /> Thêm</button>}>
          {!d.info.licenses.length && <div className="text-[12.5px] text-[#86868B]">vd Giấy phép cho thuê lại lao động (có thời hạn — app sẽ nhắc trước 90 ngày).</div>}
          <div className="space-y-3">
            {d.info.licenses.map(l => {
              const upd = (patch: Partial<typeof l>) => setInfo('licenses', d.info.licenses.map(x => (x.id === l.id ? { ...x, ...patch } : x)));
              return (
                <div key={l.id} className="rounded-[12px] bg-white p-2.5 shadow-[0_0_0_0.5px_rgba(0,0,0,0.08)] grid sm:grid-cols-2 gap-2">
                  <div className="sm:col-span-2 flex gap-2">
                    <input value={l.name} onChange={e => upd({ name: e.target.value })} placeholder="Tên giấy phép" className={`${INPUT_CLS} flex-1`} />
                    <button type="button" className={ROW_X} onClick={() => setInfo('licenses', d.info.licenses.filter(x => x.id !== l.id))} aria-label="Xoá"><X size={15} /></button>
                  </div>
                  <input value={l.number} onChange={e => upd({ number: e.target.value })} placeholder="Số giấy phép" className={INPUT_CLS} />
                  <input value={l.issuer} onChange={e => upd({ issuer: e.target.value })} placeholder="Cơ quan cấp" className={INPUT_CLS} />
                  <label className="flex items-center gap-2 text-[12px] text-[#86868B]"><span className="w-[58px] shrink-0">Ngày cấp</span><input type="date" value={l.issued} onChange={e => upd({ issued: e.target.value })} className={INPUT_CLS} /></label>
                  <label className="flex items-center gap-2 text-[12px] text-[#86868B]"><span className="w-[58px] shrink-0">Hết hạn</span><input type="date" value={l.expires} onChange={e => upd({ expires: e.target.value })} className={INPUT_CLS} /></label>
                  <input value={l.url} onChange={e => upd({ url: e.target.value })} placeholder="Link file giấy phép trên Google Drive (bấm icon file để xem)" className={`${INPUT_CLS} sm:col-span-2`} />
                </div>
              );
            })}
          </div>
        </Group>

        <Group title={`Tài khoản ngân hàng (${d.info.banks.length})`}
          action={<button type="button" className={SMALL_BTN} onClick={() => setInfo('banks', [...d.info.banks, { id: rid(), bank: '', number: '', branch: '', holder: '' }])}><Plus size={13} /> Thêm</button>}>
          {!d.info.banks.length && <div className="text-[12.5px] text-[#86868B]">Chưa có.</div>}
          <div className="space-y-2">
            {d.info.banks.map(b => {
              const upd = (patch: Partial<typeof b>) => setInfo('banks', d.info.banks.map(x => (x.id === b.id ? { ...x, ...patch } : x)));
              return (
                <div key={b.id} className="grid grid-cols-2 sm:grid-cols-[1fr_1fr_1fr_auto] gap-2 items-center">
                  <input value={b.bank} onChange={e => upd({ bank: e.target.value })} placeholder="Ngân hàng" className={INPUT_CLS} />
                  <input value={b.number} onChange={e => upd({ number: e.target.value })} placeholder="Số tài khoản" className={INPUT_CLS} inputMode="numeric" />
                  <input value={b.branch} onChange={e => upd({ branch: e.target.value })} placeholder="Chi nhánh" className={INPUT_CLS} />
                  <button type="button" className={ROW_X} onClick={() => setInfo('banks', d.info.banks.filter(x => x.id !== b.id))} aria-label="Xoá"><X size={15} /></button>
                </div>
              );
            })}
          </div>
        </Group>

        <Group title="Ghi chú">
          <textarea value={d.note} onChange={e => set('note', e.target.value)} rows={3} placeholder="Ghi chú nội bộ…" className={TEXTAREA_CLS} />
        </Group>
      </div>

      <div className={`${SHEET_FOOTER} bg-[#F2F2F7]/90 md:bg-white/90 mt-5 flex gap-2 justify-end`}>
        <button type="button" onClick={discard} className={`${BTN_SECONDARY} h-10 px-5 text-[14px]`}>Huỷ</button>
        <button type="button" onClick={submit} disabled={busy} className={`${BTN_PRIMARY} h-10 px-5 text-[14px]`}>{busy && <Loader2 size={15} className="animate-spin" />} Lưu</button>
      </div>
    </Sheet>
  );
}
