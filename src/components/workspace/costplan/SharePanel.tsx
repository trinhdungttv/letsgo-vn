import { useState } from 'react';
import { Check, Copy, Shuffle, X } from 'lucide-react';
import { revokeShare, setShare, shareUrl } from '../../../lib/costPlan/api';
import type { CostPlanRow, SharedInfo } from '../../../lib/costPlan/types';
import { formatDate } from '../../../lib/format';
import { FONT, Select, Seg, btnGhost, btnPrimary, field, labelCls } from './ui';

const randomPin = () => {
  const b = new Uint32Array(1);
  crypto.getRandomValues(b);
  return String(b[0] % 10000).padStart(4, '0');
};

async function copy(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

/**
 * Chia sẻ phương án qua LINK NGẮN + MÃ 4 SỐ. Người nhận mở link, nhập mã (như mở khoá iPhone) là xem/chỉnh được,
 * không cần tài khoản. Mã chỉ lưu dạng băm nên KHÔNG xem lại được — đặt lại mã nếu quên.
 */
export default function SharePanel({ plan, token, onClose, onChanged, toast }: {
  plan: CostPlanRow;
  token: string;
  onClose: () => void;
  onChanged: (share: SharedInfo | null) => void;
  toast: (m: string) => void;
}) {
  const existing = plan.share && !plan.share.revoked ? plan.share : null;
  const [pin, setPin] = useState('');
  const [canEdit, setCanEdit] = useState(existing?.can_edit ?? true);
  const [days, setDays] = useState<number>(() => {
    if (!existing?.expires_at) return 0;
    const left = Math.ceil((new Date(existing.expires_at).getTime() - Date.now()) / 86400000);
    return [1, 7, 30].find(d => d >= left) ?? 30;
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ code: string; pin: string } | null>(null);
  const [copied, setCopied] = useState<'link' | 'msg' | null>(null);
  const [editing, setEditing] = useState(!existing);

  const run = async (newCode: boolean) => {
    if (!/^\d{4}$/.test(pin)) { setErr('Mã bảo mật phải gồm đúng 4 chữ số'); return; }
    setBusy(true); setErr(null);
    try {
      const r = await setShare(token, plan.id, pin, { canEdit, expiresDays: days || null, newCode });
      setIssued({ code: r.code, pin });
      onChanged({
        code: r.code, can_edit: r.can_edit, expires_at: r.expires_at, revoked: false,
        open_count: newCode ? 0 : existing?.open_count ?? 0, last_opened_at: newCode ? null : existing?.last_opened_at ?? null, locked_until: null,
      });
      setPin(''); setEditing(false);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };

  const revoke = async () => {
    if (!window.confirm('Thu hồi link? Những người đang giữ link sẽ không mở được nữa (phương án vẫn còn nguyên).')) return;
    setBusy(true);
    try {
      await revokeShare(token, plan.id);
      onChanged(plan.share ? { ...plan.share, revoked: true } : null);
      setIssued(null); setEditing(true);
      toast('Đã thu hồi link');
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };

  const live = plan.share && !plan.share.revoked;
  const code = issued?.code ?? (live ? plan.share!.code : null);
  const url = code ? shareUrl(code) : '';
  const message = issued ? `Phương án giá "${plan.title}"\nLink: ${url}\nMã bảo mật: ${issued.pin}` : '';
  const doCopy = async (what: 'link' | 'msg') => {
    if (await copy(what === 'link' ? url : message)) { setCopied(what); setTimeout(() => setCopied(null), 1600); }
    else toast('Không copy được — bôi đen và copy thủ công');
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/30 backdrop-blur-[2px] flex items-center justify-center p-4" style={{ fontFamily: FONT }} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-[0_24px_80px_rgba(0,0,0,0.28)] w-full max-w-md max-h-[90vh] overflow-y-auto text-[#1d1d1f]">
        <div className="flex items-start justify-between px-6 pt-5">
          <div>
            <div className="text-[19px] font-semibold tracking-tight">Chia sẻ phương án</div>
            <div className="text-[12.5px] text-[#86868b] mt-0.5">Gửi link ngắn + mã 4 số cho người cùng làm dự án</div>
          </div>
          <button onClick={onClose} className="w-8 h-8 -mr-2 rounded-full flex items-center justify-center text-[#6e6e73] hover:bg-[#f5f5f7]"><X size={17} /></button>
        </div>

        <div className="p-6 space-y-5">
          {code && (
            <div className="rounded-xl bg-[#f5f5f7] p-4 space-y-3">
              <div className="flex items-center gap-2">
                <input readOnly value={url} onFocus={e => e.target.select()} className="flex-1 min-w-0 h-9 px-3 rounded-lg bg-white text-[14px] font-mono font-medium outline-none ring-1 ring-black/5" />
                <button onClick={() => doCopy('link')} className={btnGhost + ' !bg-white ring-1 ring-black/5'}>{copied === 'link' ? <Check size={14} className="text-[#1d8a3b]" /> : <Copy size={14} />}{copied === 'link' ? 'Đã copy' : 'Copy'}</button>
              </div>
              {issued ? (
                <>
                  <div className="text-[13px]">Mã bảo mật <b className="font-mono text-[18px] tracking-[0.35em] ml-1">{issued.pin}</b></div>
                  <div className="text-[11.5px] text-[#86868b] -mt-1.5">Chỉ hiện lúc này — hãy gửi kèm link.</div>
                  <button onClick={() => doCopy('msg')} className={btnPrimary + ' w-full !h-9'}>{copied === 'msg' ? <Check size={14} /> : <Copy size={14} />}{copied === 'msg' ? 'Đã copy' : 'Copy cả link và mã để dán vào Zalo'}</button>
                </>
              ) : (
                <div className="text-[12px] text-[#6e6e73]">Mã đã đặt trước đó không xem lại được. Quên thì đặt mã mới bên dưới.</div>
              )}
              {live && (
                <div className="text-[11.5px] text-[#86868b] flex flex-wrap gap-x-3 gap-y-0.5">
                  <span>{plan.share!.can_edit ? 'Được chỉnh sửa' : 'Chỉ xem'}</span>
                  <span>Đã mở {plan.share!.open_count} lần{plan.share!.last_opened_at ? `, gần nhất ${formatDate(plan.share!.last_opened_at)}` : ''}</span>
                  <span>{plan.share!.expires_at ? `Hết hạn ${formatDate(plan.share!.expires_at)}` : 'Không hết hạn'}</span>
                  {plan.share!.locked_until && new Date(plan.share!.locked_until) > new Date() && <span className="text-[#d70015] font-medium">Đang khoá do nhập sai mã</span>}
                </div>
              )}
              {!editing && <button onClick={() => setEditing(true)} className="text-[13px] font-medium text-[#0071e3]">Đổi mã, quyền hoặc hạn dùng</button>}
            </div>
          )}

          {editing && (
            <div className="space-y-4">
              <div>
                <span className={labelCls}>Mã bảo mật 4 số</span>
                <div className="flex items-center gap-2">
                  <input value={pin} inputMode="numeric" maxLength={4} placeholder="••••" autoComplete="off" onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    className={`${field} !h-11 w-32 text-center !text-[20px] font-mono font-semibold tracking-[0.4em]`} />
                  <button type="button" onClick={() => setPin(randomPin())} className={btnGhost}><Shuffle size={13} />Ngẫu nhiên</button>
                </div>
              </div>
              <div>
                <span className={labelCls}>Quyền của người nhận</span>
                <Seg value={canEdit ? 'edit' : 'view'} onChange={v => setCanEdit(v === 'edit')} options={[{ value: 'edit', label: 'Xem và chỉnh sửa' }, { value: 'view', label: 'Chỉ xem' }]} />
              </div>
              <div>
                <span className={labelCls}>Hạn dùng link</span>
                <Select value={days} onChange={v => setDays(Number(v))}>
                  <option value={0}>Không hết hạn</option><option value={1}>1 ngày</option><option value={7}>7 ngày</option><option value={30}>30 ngày</option>
                </Select>
              </div>
              {err && <div className="text-[12.5px] text-[#b3140a] bg-[#fff1f0] rounded-lg px-3 py-2">{err}</div>}
              <div className="flex flex-wrap gap-2">
                <button disabled={busy || pin.length !== 4} onClick={() => run(false)} className={`${btnPrimary} !h-9`}>{live ? 'Cập nhật' : 'Tạo link'}</button>
                {live && <button disabled={busy || pin.length !== 4} onClick={() => run(true)} title="Đổi sang mã link mới — link cũ ngừng hoạt động" className={`${btnGhost} !h-9`}>Tạo link mới</button>}
              </div>
            </div>
          )}

          {live && (
            <div className="pt-1">
              <button disabled={busy} onClick={revoke} className="text-[13px] font-medium text-[#d70015] hover:underline disabled:opacity-40">Thu hồi link</button>
            </div>
          )}

          <p className="text-[11.5px] text-[#86868b] leading-relaxed">
            Nhập sai mã 5 lần là link tự khoá 15 phút. Người nhận thấy toàn bộ cơ cấu giá và lợi nhuận — chỉ gửi cho người cùng làm dự án.
            Mọi chỉnh sửa qua link đều ghi lại kèm tên người sửa.
          </p>
        </div>
      </div>
    </div>
  );
}
