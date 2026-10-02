import type { LinkHealthInfo } from '../lib/linkCheck';

/** Chấm trạng thái link: xanh = sống, đỏ = chết, xám = chưa rõ / đang kiểm tra. */
export function LinkHealthDot({ info }: { info?: LinkHealthInfo }) {
  const st = info?.status ?? 'checking';
  const cls = st === 'live' ? 'bg-emerald-500' : st === 'dead' ? 'bg-red-500' : st === 'checking' ? 'bg-gray-300 animate-pulse' : 'bg-gray-400';
  return <span className={`inline-block w-1.5 h-1.5 rounded-full flex-none ${cls}`} />;
}

export const linkHealthCls = (info?: LinkHealthInfo) =>
  info?.status === 'live' ? 'bg-emerald-50 border-emerald-200 hover:border-emerald-400'
  : info?.status === 'dead' ? 'bg-red-50 border-red-200 hover:border-red-400'
  : 'bg-[#F9F9F7] border-[#E8E7E2] hover:border-blue-300';

export const linkHealthTitle = (info?: LinkHealthInfo) =>
  !info || info.status === 'checking' ? 'Đang kiểm tra link…'
  : info.status === 'live' ? 'Link hoạt động'
  : info.status === 'dead' ? `Link chết${info.reason ? ` — ${info.reason}` : ''}`
  : `Chưa xác định được${info.reason ? ` — ${info.reason}` : ''}`;
