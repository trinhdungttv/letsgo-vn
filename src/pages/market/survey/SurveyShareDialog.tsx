// Chia sẻ Khảo sát KCN cho người ngoài: chọn tỉnh / KCN được xem, thời hạn → hệ thống tự sinh mã 4 số + soạn sẵn tin nhắn Zalo.
// Người nhận mở link, nhập mã (kiểu mở khoá iPhone) là xem được — chỉ xem. Mã chỉ lưu dạng băm nên không xem lại được:
// quên thì "Đặt mã mới & soạn tin" ở danh sách link đã chia sẻ.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Copy, Home, KeyRound, Link2, Loader2, Search, Shuffle, Trash2, X } from 'lucide-react';
import {
  buildShareMessage, createSurveyShare, DEFAULT_EXPIRY_DAYS, EXPIRY_OPTIONS, fmtVnDate, groupZonesByProvince, listSurveyShares, provincesOf, randomPin,
  revokeSurveyShare, shareState, surveyShareUrl, updateSurveyShare, type ShareZone, type SurveyShareRow,
} from '../../../lib/kcnSurvey/share';
import { fold } from './surveyData';

async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* thử cách cũ */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
}

interface Issued { url: string; pin: string; zoneNames: string[]; provinces: string[]; expiresAt: string | null; recipient: string; title: string; lodgings: boolean }

export default function SurveyShareDialog({ zones, unzonedLodgings = 0, token, onClose, say }: {
  /** KCN đã có dữ liệu khảo sát (có ảnh, chuyến hoặc nhà trọ) */
  zones: ShareZone[];
  /** Số nhà trọ chưa gắn KCN — không vào được link (link chia theo KCN) */
  unzonedLodgings?: number;
  token: string | null;
  onClose: () => void;
  say: (m: string) => void;
}) {
  const [tab, setTab] = useState<'new' | 'list'>('new');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [days, setDays] = useState<number | null>(DEFAULT_EXPIRY_DAYS);
  const [recipient, setRecipient] = useState('');
  const [pin, setPin] = useState(() => randomPin());
  // Kèm nhà trọ (migration 222): mặc định bật khi đã có nhà trọ; SĐT chủ nhà mặc định ẩn
  const [withLodgings, setWithLodgings] = useState(() => zones.some(z => (z.lodgings ?? 0) > 0));
  const [showLandlord, setShowLandlord] = useState(false);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [message, setMessage] = useState('');
  const [copied, setCopied] = useState<'msg' | 'link' | null>(null);
  const [shares, setShares] = useState<SurveyShareRow[] | null>(null);
  const [listErr, setListErr] = useState<string | null>(null);

  const groups = useMemo(() => groupZonesByProvince(zones), [zones]);
  const zoneById = useMemo(() => new Map(zones.map(z => [z.id, z])), [zones]);
  const needle = fold(q.trim());
  const visibleGroups = useMemo(() => groups
    .map(g => ({ ...g, zones: needle ? g.zones.filter(z => fold(`${z.name} ${g.label}`).includes(needle)) : g.zones }))
    .filter(g => g.zones.length), [groups, needle]);

  const toggleZone = (id: string) => setSelected(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleGroup = (ids: string[]) => setSelected(s => {
    const n = new Set(s);
    const all = ids.every(i => n.has(i));
    ids.forEach(i => (all ? n.delete(i) : n.add(i)));
    return n;
  });

  const loadList = useCallback(async () => {
    if (!token) return;
    setListErr(null);
    try { setShares(await listSurveyShares(token)); } catch (e) { setListErr((e as Error).message); setShares([]); }
  }, [token]);
  useEffect(() => { if (tab === 'list' && shares === null) void loadList(); }, [tab, shares, loadList]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const showIssued = (i: Issued) => {
    setIssued(i);
    setMessage(buildShareMessage({ url: i.url, pin: i.pin, zoneNames: i.zoneNames, provinces: i.provinces, expiresAt: i.expiresAt, recipient: i.recipient, lodgings: i.lodgings }));
    setCopied(null);
  };

  const create = async () => {
    if (!token) { setErr('Cần đăng nhập để tạo link chia sẻ'); return; }
    if (!selected.size) { setErr('Chọn ít nhất 1 KCN để chia sẻ'); return; }
    setBusy(true); setErr(null);
    try {
      const chosen = zones.filter(z => selected.has(z.id));
      const provinces = provincesOf(zones, selected);
      const r = await createSurveyShare(token, { label: recipient.trim(), zoneIds: chosen.map(z => z.id), provinces, pin, days, lodgings: withLodgings, showLandlord: withLodgings && showLandlord });
      showIssued({ url: surveyShareUrl(r.code), pin, zoneNames: chosen.map(z => z.name), provinces, expiresAt: r.expires_at, recipient: recipient.trim(), title: recipient.trim(), lodgings: withLodgings });
      setShares(null);
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  const doCopy = async (what: 'msg' | 'link') => {
    if (!issued) return;
    if (await copyText(what === 'msg' ? message : issued.url)) { setCopied(what); setTimeout(() => setCopied(null), 1800); }
    else say('Không copy được — bôi đen nội dung và copy thủ công');
  };

  const resend = async (s: SurveyShareRow) => {
    if (!token) return;
    const state = shareState(s);
    const extend = state !== 'active';
    if (!window.confirm(`Đặt mã mới cho link${s.label ? ` “${s.label}”` : ''}?\n\nMã cũ ngừng dùng ngay${extend ? `; link đang ${state === 'expired' ? 'hết hạn' : 'bị thu hồi'} sẽ được mở lại ${DEFAULT_EXPIRY_DAYS} ngày` : ''}. Người nhận cần mã mới trong tin nhắn bên dưới.`)) return;
    const newPin = randomPin();
    setBusy(true);
    try {
      const r = await updateSurveyShare(token, s.id, newPin, { setExpiry: extend, days: DEFAULT_EXPIRY_DAYS });
      const names = s.zone_ids.map(id => zoneById.get(id)?.name).filter((n): n is string => !!n);
      showIssued({ url: surveyShareUrl(r.code), pin: newPin, zoneNames: names.length ? names : [`${s.zone_ids.length} KCN`], provinces: s.provinces, expiresAt: r.expires_at, recipient: s.label, title: s.label, lodgings: !!s.include_lodgings });
      setShares(null);
    } catch (e) { say((e as Error).message); }
    setBusy(false);
  };
  const revoke = async (s: SurveyShareRow) => {
    if (!token) return;
    if (!window.confirm(`Thu hồi link${s.label ? ` “${s.label}”` : ''}? Người đang giữ link sẽ không mở được nữa (dữ liệu khảo sát vẫn còn nguyên).`)) return;
    try { await revokeSurveyShare(token, s.id); say('Đã thu hồi link'); await loadList(); } catch (e) { say((e as Error).message); }
  };

  const chosenZones = zones.filter(z => selected.has(z.id));
  const totalPhotos = chosenZones.reduce((n, z) => n + z.photos, 0);
  const totalLodgings = chosenZones.reduce((n, z) => n + (z.lodgings ?? 0), 0);

  return (
    <div className="fixed inset-0 z-[80] bg-black/40 backdrop-blur-[2px] flex items-end md:items-center justify-center md:p-4" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white w-full md:max-w-lg rounded-t-2xl md:rounded-2xl shadow-[0_24px_80px_rgba(0,0,0,0.28)] max-h-[92vh] flex flex-col text-[#111]">
        <div className="flex items-start justify-between px-5 pt-4 pb-2">
          <div>
            <div className="text-[17px] font-semibold tracking-tight">Chia sẻ khảo sát</div>
            <div className="text-[12px] text-[#888] mt-0.5">Người ngoài mở link + nhập mã 4 số là xem được, không cần tài khoản</div>
          </div>
          <button onClick={onClose} className="w-8 h-8 -mr-2 rounded-full flex items-center justify-center text-[#666] hover:bg-[#F3F3F0]" aria-label="Đóng"><X size={17} /></button>
        </div>

        {issued ? (
          <div className="p-5 pt-2 space-y-3 overflow-y-auto">
            <div className="rounded-xl bg-[#F5F5F7] p-3.5 space-y-2.5">
              <div className="flex items-center gap-1.5 text-[13px] font-medium text-[#1d8a3b]"><Check size={15} /> Đã tạo link{issued.title ? ` cho ${issued.title}` : ''}</div>
              <div className="flex items-center gap-4 text-[13px]">
                <span>Mã xem <b className="font-mono text-[22px] tracking-[0.3em] ml-1">{issued.pin}</b></span>
                <span className="text-[#888]">{issued.expiresAt ? `đến hết ${fmtVnDate(new Date(issued.expiresAt))}` : 'không hết hạn'}</span>
              </div>
              <div className="text-[11.5px] text-[#888]">Mã đã tự điền vào tin nhắn. Mã chỉ hiện lúc này — gửi ngay hoặc đặt mã mới sau.</div>
            </div>
            <label className="block">
              <span className="block text-[11px] font-medium text-[#666] mb-1">Tin nhắn soạn sẵn (sửa được trước khi copy)</span>
              <textarea value={message} onChange={e => setMessage(e.target.value)} rows={9}
                className="w-full rounded-xl border border-[#E8E7E2] px-3 py-2.5 text-[13px] leading-relaxed outline-none focus:border-[#0A84FF] resize-y" />
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <button onClick={() => doCopy('msg')} className="flex-1 h-11 rounded-full bg-[#0A84FF] text-white text-[14px] font-semibold inline-flex items-center justify-center gap-1.5 active:scale-95 transition">
                {copied === 'msg' ? <><Check size={16} /> Đã copy — dán vào Zalo</> : <><Copy size={16} /> Copy tin nhắn để gửi Zalo</>}
              </button>
              <button onClick={() => doCopy('link')} className="h-11 px-4 rounded-full border border-[#D8D6D0] text-[13px] font-medium inline-flex items-center justify-center gap-1.5 hover:bg-[#F9F9F7]">
                {copied === 'link' ? <Check size={15} className="text-[#1d8a3b]" /> : <Link2 size={15} />} Chỉ link
              </button>
            </div>
            <button onClick={() => { setIssued(null); setTab('new'); setSelected(new Set()); setRecipient(''); setPin(randomPin()); }} className="text-[13px] font-medium text-[#0A84FF]">Tạo link khác</button>
          </div>
        ) : (
          <>
            <div className="px-5 flex gap-1.5">
              {([['new', 'Tạo link mới'], ['list', 'Link đã chia sẻ']] as const).map(([id, label]) => (
                <button key={id} onClick={() => setTab(id)}
                  className={`px-3 py-1.5 rounded-lg text-[12px] font-medium border transition ${tab === id ? 'bg-[#111] border-[#111] text-white' : 'bg-white border-[#E8E7E2] text-[#666]'}`}>{label}</button>
              ))}
            </div>

            {tab === 'new' ? (
              <div className="p-5 pt-3 space-y-4 overflow-y-auto">
                <label className="block">
                  <span className="block text-[11px] font-medium text-[#666] mb-1">Gửi cho ai <span className="text-[#aaa]">· tuỳ chọn, để nhớ và gọi tên trong tin nhắn</span></span>
                  <input value={recipient} onChange={e => setRecipient(e.target.value)} maxLength={60} placeholder="vd: anh Nam – Công ty ABC"
                    className="w-full h-10 px-3 rounded-lg border border-[#E8E7E2] text-[13px] outline-none focus:border-[#0A84FF]" />
                </label>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[11px] font-medium text-[#666]">Cho xem khu vực nào <span className="text-[#aaa]">· chạm tên tỉnh để chọn cả tỉnh</span></span>
                    <span className="text-[11px] text-[#888]">{selected.size ? `${selected.size} KCN · ${totalPhotos} ảnh${withLodgings && totalLodgings ? ` · ${totalLodgings} trọ` : ''}` : 'chưa chọn'}</span>
                  </div>
                  {zones.length === 0 ? (
                    <div className="text-[12.5px] text-[#888] rounded-lg bg-[#F9F9F7] p-3">Chưa có KCN nào có dữ liệu khảo sát để chia sẻ.</div>
                  ) : (
                    <>
                      <div className="relative mb-2">
                        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#aaa]" />
                        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Tìm tỉnh / KCN…" className="w-full h-9 pl-8 pr-2.5 rounded-lg border border-[#E8E7E2] text-[12.5px] outline-none focus:border-[#0A84FF]" />
                      </div>
                      <div className="flex items-center gap-3 text-[12px] mb-1.5">
                        <button type="button" onClick={() => setSelected(new Set(zones.map(z => z.id)))} className="text-[#0A84FF] font-medium">Chọn tất cả</button>
                        <button type="button" onClick={() => setSelected(new Set())} className="text-[#888]">Bỏ chọn</button>
                      </div>
                      <div className="rounded-xl border border-[#E8E7E2] max-h-[34vh] overflow-y-auto divide-y divide-[#F0EFEA]">
                        {visibleGroups.map(g => {
                          const ids = g.zones.map(z => z.id);
                          const n = ids.filter(i => selected.has(i)).length;
                          return (
                            <div key={g.key || 'none'}>
                              <button type="button" onClick={() => toggleGroup(ids)} className="w-full flex items-center gap-2 px-3 py-2 bg-[#FAFAF8] text-left">
                                <Box state={n === 0 ? 'off' : n === ids.length ? 'on' : 'part'} />
                                <span className="text-[12.5px] font-semibold flex-1">{g.label}</span>
                                <span className="text-[11px] text-[#888]">{n}/{ids.length} KCN</span>
                              </button>
                              {g.zones.map(z => (
                                <button type="button" key={z.id} onClick={() => toggleZone(z.id)} className="w-full flex items-center gap-2 pl-8 pr-3 py-1.5 text-left hover:bg-[#FAFAF8]">
                                  <Box state={selected.has(z.id) ? 'on' : 'off'} />
                                  <span className="text-[12.5px] flex-1 min-w-0 truncate">{z.name}</span>
                                  <span className="text-[11px] text-[#999] shrink-0">{z.photos} ảnh · {z.trips} chuyến{z.lodgings ? ` · ${z.lodgings} trọ` : ''}</span>
                                </button>
                              ))}
                            </div>
                          );
                        })}
                        {!visibleGroups.length && <div className="p-3 text-[12.5px] text-[#888]">Không có KCN khớp.</div>}
                      </div>
                    </>
                  )}
                  <div className="text-[11px] text-[#999] mt-1.5">Link chỉ gồm các KCN bạn chọn lúc này; KCN khảo sát thêm sau không tự vào link.</div>
                </div>

                <div>
                  <span className="block text-[11px] font-medium text-[#666] mb-1.5">Kèm theo</span>
                  <div className="rounded-xl border border-[#E8E7E2] divide-y divide-[#F0EFEA]">
                    <button type="button" onClick={() => setWithLodgings(v => !v)} className="w-full flex items-start gap-2.5 px-3 py-2.5 text-left hover:bg-[#FAFAF8]">
                      <span className="mt-0.5"><Box state={withLodgings ? 'on' : 'off'} /></span>
                      <span className="flex-1 min-w-0">
                        <span className="flex items-center gap-1.5 text-[12.5px] font-semibold"><Home size={13} className="text-[#FF9500]" /> Khảo sát nhà trọ</span>
                        <span className="block text-[11px] text-[#888] leading-snug mt-0.5">Ảnh, số phòng, giá, tiện ích, khoảng cách xe máy / đi bộ tới công ty gần đó</span>
                      </span>
                      <span className="text-[11px] text-[#999] shrink-0 mt-0.5">{selected.size ? `${totalLodgings} nhà trọ` : ''}</span>
                    </button>
                    {withLodgings && (
                      <button type="button" onClick={() => setShowLandlord(v => !v)} className="w-full flex items-start gap-2.5 pl-9 pr-3 py-2 text-left hover:bg-[#FAFAF8]">
                        <span className="mt-0.5"><Box state={showLandlord ? 'on' : 'off'} /></span>
                        <span className="flex-1 min-w-0">
                          <span className="block text-[12.5px]">Hiện tên & SĐT chủ nhà</span>
                          <span className="block text-[11px] text-[#888] leading-snug mt-0.5">{showLandlord ? 'Người xem gọi / nhắn Zalo thẳng cho chủ nhà được' : 'Đang ẩn — người xem thấy "liên hệ Let\'s Go VN để được giới thiệu"'}</span>
                        </span>
                      </button>
                    )}
                  </div>
                  {withLodgings && unzonedLodgings > 0 && (
                    <div className="text-[11px] text-[#999] mt-1.5">{unzonedLodgings} nhà trọ chưa gắn KCN nên không có trong link.</div>
                  )}
                </div>

                <div>
                  <span className="block text-[11px] font-medium text-[#666] mb-1.5">Xem được trong bao lâu</span>
                  <div className="flex flex-wrap gap-1.5">
                    {EXPIRY_OPTIONS.map(o => (
                      <button key={String(o.days)} type="button" onClick={() => setDays(o.days)}
                        className={`h-9 px-3 rounded-lg text-[12.5px] font-medium border transition ${days === o.days ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-[#E8E7E2] text-[#666]'}`}>{o.label}</button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-3 rounded-xl bg-[#F5F5F7] px-3.5 py-2.5">
                  <KeyRound size={16} className="text-[#666] shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] text-[#888]">Mã 4 số (tự tạo, tự điền vào tin nhắn)</div>
                    <div className="font-mono text-[22px] font-semibold tracking-[0.35em] leading-tight">{pin}</div>
                  </div>
                  <button type="button" onClick={() => setPin(randomPin())} className="h-8 px-2.5 rounded-lg bg-white border border-[#E8E7E2] text-[12px] text-[#333] inline-flex items-center gap-1"><Shuffle size={12} /> Đổi</button>
                </div>

                {err && <div className="text-[12.5px] text-[#b3140a] bg-[#fff1f0] rounded-lg px-3 py-2">{err}</div>}
                <button onClick={create} disabled={busy || !selected.size}
                  className="w-full h-11 rounded-full bg-[#0A84FF] text-white text-[14px] font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-40 active:scale-95 transition">
                  {busy && <Loader2 size={15} className="animate-spin" />} Tạo link & soạn tin nhắn Zalo
                </button>
                <p className="text-[11px] text-[#999] leading-relaxed">
                  Người xem chỉ thấy ảnh chỉ tiêu (công ty, vị trí, số lượng, lương, ghi chú), các chuyến{withLodgings ? ' và nhà trọ' : ''} của KCN đã chọn — không thấy ghi âm, tên nhân viên đi khảo sát{withLodgings && !showLandlord ? ', SĐT chủ nhà' : ''} hay KCN khác.
                  Nhập sai mã 5 lần thì link tự khoá 15 phút.
                </p>
              </div>
            ) : (
              <div className="p-5 pt-3 space-y-2 overflow-y-auto">
                {shares === null && <div className="py-8 text-center text-[#888]"><Loader2 className="animate-spin inline" size={18} /></div>}
                {listErr && <div className="text-[12.5px] text-[#b3140a] bg-[#fff1f0] rounded-lg px-3 py-2">{listErr}</div>}
                {shares && !shares.length && !listErr && <div className="py-8 text-center text-[13px] text-[#888]">Chưa có link nào được chia sẻ.</div>}
                {shares?.map(s => {
                  const st = shareState(s);
                  const locked = s.locked_until && new Date(s.locked_until) > new Date();
                  return (
                    <div key={s.id} className="rounded-xl border border-[#E8E7E2] p-3 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 min-w-0 text-[13px] font-semibold truncate">{s.label || 'Link không đặt tên'}</div>
                        <span className={`text-[10.5px] font-semibold px-2 py-0.5 rounded-full ${st === 'active' ? 'bg-[#e8f8ed] text-[#1d8a3b]' : st === 'expired' ? 'bg-[#fff4e0] text-[#b25e00]' : 'bg-[#f0f0f2] text-[#6e6e73]'}`}>
                          {st === 'active' ? 'Đang mở' : st === 'expired' ? 'Hết hạn' : 'Đã thu hồi'}
                        </span>
                      </div>
                      <div className="text-[11.5px] text-[#888] leading-snug">
                        {s.zone_ids.length} KCN{s.provinces.length ? ` · ${s.provinces.join(', ')}` : ''}{s.include_lodgings ? ` · kèm nhà trọ${s.show_landlord ? ' (có SĐT chủ nhà)' : ''}` : ''} · {s.expires_at ? `hạn ${fmtVnDate(new Date(s.expires_at))}` : 'không hết hạn'}
                        <br />Đã mở {s.open_count} lần{s.last_opened_at ? `, gần nhất ${fmtVnDate(new Date(s.last_opened_at))}` : ''} · tạo {fmtVnDate(new Date(s.created_at))}{s.created_by_name ? ` bởi ${s.created_by_name}` : ''}
                        {locked && <span className="text-[#d70015] font-medium"> · đang khoá do nhập sai mã</span>}
                      </div>
                      <div className="flex items-center gap-3 pt-0.5">
                        <button disabled={busy} onClick={() => resend(s)} className="text-[12.5px] font-medium text-[#0A84FF] disabled:opacity-40">Đặt mã mới & soạn tin</button>
                        {st !== 'revoked' && <button onClick={() => revoke(s)} className="text-[12.5px] font-medium text-[#d70015] inline-flex items-center gap-1"><Trash2 size={12} /> Thu hồi</button>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Box({ state }: { state: 'on' | 'off' | 'part' }) {
  return (
    <span className={`w-[18px] h-[18px] rounded-[5px] border flex items-center justify-center shrink-0 ${state === 'off' ? 'border-[#C9C8C2] bg-white' : 'border-[#0A84FF] bg-[#0A84FF]'}`}>
      {state === 'on' && <Check size={12} className="text-white" strokeWidth={3} />}
      {state === 'part' && <span className="w-2 h-[2px] bg-white rounded" />}
    </span>
  );
}
