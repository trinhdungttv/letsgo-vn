// Màn lưu ảnh chỉ tiêu tuyển dụng vừa chụp: gắn công ty (gợi ý công ty quanh chỗ chụp), vị trí tuyển, số lượng, lương.
// Công ty chưa có trong hệ thống → tuỳ chọn thêm luôn vào Thị trường → Công ty/Dự án, ghim tại chỗ chụp.
import { useEffect, useMemo, useState } from 'react';
import { Check, MapPin, Search, X } from 'lucide-react';
import { useCompanyDuplicates } from '../../../hooks/useCompanyDuplicates';
import DuplicateCompanyNotice from '../../../components/common/DuplicateCompanyNotice';
import type { NearbyCompany, SurveyCompany } from '../../../lib/kcnSurvey/companies';
import { fmtDistance } from '../../../lib/kcnSurvey/track';
import { StatusDot, statusLabel, type CompanyLookup } from './SurveyCompanyCard';
import { fold } from './surveyData';

export interface PhotoPosition {
  lat: number;
  lng: number;
  acc: number | null;
  source: 'gps' | 'exif' | 'manual';
}

export interface PhotoFormValue {
  company: SurveyCompany | null;
  companyName: string;
  addToMarket: boolean;
  positions: string;
  headcount: number | null;
  wage_text: string;
  note: string;
}

interface Props {
  file: File;
  position: PhotoPosition | null;
  suggestions: NearbyCompany[];
  allCompanies: SurveyCompany[];
  preset: SurveyCompany | null;
  zoneName: string | null;
  lookup: CompanyLookup;
  onCancel: () => void;
  onSave: (v: PhotoFormValue) => void;
}

const input = 'w-full h-11 px-3 rounded-xl bg-[#F2F2F7] text-[15px] text-[#1D1D1F] outline-none focus:ring-2 focus:ring-[#0A84FF]/40 placeholder:text-[#8E8E93]';

export default function SurveyPhotoSheet({ file, position, suggestions, allCompanies, preset, zoneName, lookup, onCancel, onSave }: Props) {
  const [preview, setPreview] = useState<string | null>(null);
  const [company, setCompany] = useState<SurveyCompany | null>(preset);
  const [query, setQuery] = useState('');
  const [freeName, setFreeName] = useState('');
  const [addToMarket, setAddToMarket] = useState(true);
  const [positions, setPositions] = useState('');
  const [headcount, setHeadcount] = useState('');
  const [wage, setWage] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const results = useMemo(() => {
    const q = fold(query.trim());
    if (q.length < 2) return [];
    return allCompanies.filter(c => c.status !== 'osm' && fold(c.name).includes(q)).slice(0, 8);
  }, [query, allCompanies]);

  // Công ty chỉ có trên OSM chưa có trong hệ thống → coi như tên mới (thêm được vào Thị trường)
  const isNew = !company || company.status === 'osm';
  const newName = company?.status === 'osm' ? company.name : freeName;
  const dup = useCompanyDuplicates(newName, { enabled: isNew && addToMarket && newName.trim().length >= 2 });

  const pickCompany = (c: SurveyCompany) => { setCompany(c); setFreeName(''); setQuery(''); };
  const useFreeName = () => { setCompany(null); setFreeName(query.trim()); setQuery(''); };

  const save = () => onSave({
    company: company?.status === 'osm' ? null : company,
    companyName: (company && company.status !== 'osm' ? company.name : newName).trim(),
    addToMarket: isNew && addToMarket && !!newName.trim() && !dup.blocked,
    positions: positions.trim(),
    headcount: headcount.trim() ? Math.max(0, parseInt(headcount, 10) || 0) : null,
    wage_text: wage.trim(),
    note: note.trim(),
  });

  return (
    <div className="fixed inset-0 z-[1300] bg-white flex flex-col pt-[env(safe-area-inset-top)]">
      <div className="flex items-center justify-between h-12 px-2 border-b border-black/5 shrink-0">
        <button onClick={onCancel} className="h-10 px-3 text-[16px] text-[#0A84FF]">Huỷ</button>
        <div className="text-[16px] font-semibold text-[#1D1D1F]">Ảnh chỉ tiêu</div>
        <button onClick={save} disabled={!position} className="h-10 px-3 text-[16px] font-semibold text-[#0A84FF] disabled:text-[#C7C7CC]">Lưu</button>
      </div>

      <div className="flex-1 overflow-y-auto pb-[calc(24px+env(safe-area-inset-bottom))]">
        <div className="bg-black flex items-center justify-center" style={{ maxHeight: '38vh' }}>
          {preview && <img src={preview} alt="Ảnh vừa chụp" className="max-h-[38vh] w-auto object-contain" />}
        </div>

        <div className={`flex items-center gap-1.5 px-4 py-2 text-[12.5px] ${position ? 'text-[#3A3A3C]' : 'text-[#D70015] font-medium'}`}>
          <MapPin size={14} className="shrink-0" />
          {!position && 'Chưa có vị trí GPS — chờ tín hiệu rồi chụp lại (không lưu được ảnh thiếu vị trí)'}
          {position?.source === 'gps' && <>Ghim tại chỗ đang đứng lúc bấm chụp{position.acc != null && ` (±${Math.round(position.acc)} m)`}</>}
          {position?.source === 'exif' && 'Ghim theo vị trí lưu trong ảnh (lúc chụp)'}
          {position?.source === 'manual' && 'Ghim theo vị trí chọn trên bản đồ'}
          {zoneName && <span className="text-[#8E8E93]"> · {zoneName}</span>}
        </div>

        <div className="px-4 space-y-4">
          <section>
            <div className="text-[12px] font-semibold text-[#8E8E93] uppercase tracking-wide mb-1.5">Công ty treo bảng</div>
            {company && company.status !== 'osm' ? (
              <div className="flex items-center gap-2 rounded-xl bg-[#F2F2F7] px-3 py-2.5">
                <StatusDot status={company.status} />
                <div className="flex-1 min-w-0">
                  <div className="text-[15px] font-medium text-[#1D1D1F] truncate">{company.name}</div>
                  <div className="text-[11.5px] text-[#8E8E93]">{statusLabel(company, lookup)}</div>
                </div>
                <button onClick={() => setCompany(null)} className="w-8 h-8 rounded-full flex items-center justify-center text-[#8E8E93] hover:bg-black/5" aria-label="Bỏ chọn công ty"><X size={16} /></button>
              </div>
            ) : (
              <div className="space-y-2">
                {(company?.status === 'osm' || freeName) && (
                  <div className="rounded-xl bg-[#F2F2F7] px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-[15px] font-medium text-[#1D1D1F] truncate">{newName}</div>
                        <div className="text-[11.5px] text-[#8E8E93]">{company?.status === 'osm' ? 'Tên trên bản đồ OSM — chưa có trong hệ thống' : 'Công ty mới'}</div>
                      </div>
                      <button onClick={() => { setCompany(null); setFreeName(''); }} className="w-8 h-8 rounded-full flex items-center justify-center text-[#8E8E93] hover:bg-black/5" aria-label="Bỏ tên"><X size={16} /></button>
                    </div>
                    <label className="flex items-start gap-2 mt-2 text-[13px] text-[#1D1D1F]">
                      <input type="checkbox" checked={addToMarket} onChange={e => setAddToMarket(e.target.checked)} className="mt-0.5 w-4 h-4 accent-[#0A84FF]" />
                      <span>Thêm vào Thị trường → Công ty/Dự án, ghim tại chỗ chụp{zoneName ? ` (KCN ${zoneName.replace(/^KCN\s+/i, '')})` : ''}</span>
                    </label>
                    {addToMarket && (
                      <DuplicateCompanyNotice dup={dup} onUseName={name => {
                        const hit = allCompanies.find(c => c.status !== 'osm' && c.name === name);
                        if (hit) pickCompany(hit);
                        else { setCompany(null); setFreeName(name); setAddToMarket(false); }
                      }} />
                    )}
                    {addToMarket && dup.blocked && (
                      <div className="mt-1 text-[11.5px] text-[#8E8E93]">Chưa xác nhận nên sẽ KHÔNG thêm mới — ảnh vẫn lưu với tên này.</div>
                    )}
                  </div>
                )}

                {!freeName && company?.status !== 'osm' && suggestions.length > 0 && (
                  <div className="rounded-xl border border-black/5 divide-y divide-black/5 overflow-hidden">
                    <div className="px-3 py-1.5 text-[11px] text-[#8E8E93] bg-[#FAFAFA]">Gần chỗ chụp</div>
                    {suggestions.slice(0, 6).map(n => (
                      <button key={n.company.key} onClick={() => pickCompany(n.company)}
                        className="w-full flex items-center gap-2 px-3 py-2.5 text-left active:bg-black/5">
                        <StatusDot status={n.company.status} />
                        <span className="flex-1 min-w-0 text-[14px] text-[#1D1D1F] truncate">{n.company.name}</span>
                        <span className="text-[11.5px] text-[#8E8E93] shrink-0">{fmtDistance(n.dist)}</span>
                      </button>
                    ))}
                  </div>
                )}

                {!freeName && company?.status !== 'osm' && (
                  <div>
                    <div className="relative">
                      <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8E8E93]" />
                      <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Tìm hoặc gõ tên công ty trên bảng" className={`${input} pl-9`} />
                    </div>
                    {query.trim().length >= 2 && (
                      <div className="mt-1.5 rounded-xl border border-black/5 divide-y divide-black/5 overflow-hidden">
                        {results.map(c => (
                          <button key={c.key} onClick={() => pickCompany(c)} className="w-full flex items-center gap-2 px-3 py-2.5 text-left active:bg-black/5">
                            <StatusDot status={c.status} />
                            <span className="flex-1 min-w-0 text-[14px] text-[#1D1D1F] truncate">{c.name}</span>
                            <span className="text-[11px] text-[#8E8E93] shrink-0">{statusLabel(c, lookup)}</span>
                          </button>
                        ))}
                        <button onClick={useFreeName} className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-[14px] text-[#0A84FF] active:bg-black/5">
                          <Check size={15} /> Dùng tên mới: “{query.trim()}”
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>

          <section className="space-y-2.5">
            <div className="text-[12px] font-semibold text-[#8E8E93] uppercase tracking-wide">Nội dung bảng tuyển (không bắt buộc)</div>
            <input value={positions} onChange={e => setPositions(e.target.value)} placeholder="Vị trí tuyển — VD: Công nhân may, QC, kho" className={input} />
            <div className="grid grid-cols-2 gap-2">
              <input value={headcount} onChange={e => setHeadcount(e.target.value.replace(/[^\d]/g, ''))} inputMode="numeric" placeholder="Số lượng" className={input} />
              <input value={wage} onChange={e => setWage(e.target.value)} placeholder="Lương — VD: 8–10tr" className={input} />
            </div>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} placeholder="Ghi chú — VD: tuyển gấp, có xe đưa đón, phỏng vấn 7h30 thứ 2–7"
              className="w-full px-3 py-2.5 rounded-xl bg-[#F2F2F7] text-[15px] text-[#1D1D1F] outline-none focus:ring-2 focus:ring-[#0A84FF]/40 placeholder:text-[#8E8E93] resize-none" />
          </section>
        </div>
      </div>
    </div>
  );
}
