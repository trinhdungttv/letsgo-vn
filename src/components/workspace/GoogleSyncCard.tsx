// Thanh ket noi Google Tasks — hien trong feed "Viec cua toi".
// Chua ket noi: nut "Ket noi Google Tasks". Da ket noi: email + lan sync cuoi + nut Dong bo ngay / Ngat.
// Luu y: Google Calendar tu hien Google Tasks kem nut tick hoan thanh (bat "Tasks" trong sidebar Calendar)
// nen khong can tao rieng event/lich — chi can dong bo Google Tasks la du hien tren ca Calendar.
import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Link2, Unlink } from 'lucide-react'
import { useAuth } from '../../lib/auth'
import {
  getGoogleSyncStatus, startGoogleConnect, disconnectGoogle, syncGoogleNow, pulledChanges,
  type GoogleSyncStatus,
} from '../../lib/googleSync'

interface Props {
  toast: (msg: string) => void
  /** goi khi sync keo ve thay doi tu Google -> parent reload danh sach task */
  onPulled?: (n: number) => void
}

export function GoogleSyncCard({ toast, onPulled }: Props) {
  const { token } = useAuth()
  const [status, setStatus] = useState<GoogleSyncStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [checked, setChecked] = useState(false)

  const refresh = useCallback(async () => {
    if (!token) return
    const s = await getGoogleSyncStatus(token)
    setStatus(s)
    setChecked(true)
  }, [token])

  useEffect(() => { refresh() }, [refresh])

  // Xu ly redirect quay ve tu Google (?google=connected|denied|error|expired)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const result = params.get('google')
    if (!result) return
    params.delete('google')
    const qs = params.toString()
    window.history.replaceState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`)
    if (result === 'connected') {
      toast('Đã kết nối Google Tasks — đang đồng bộ lần đầu...')
      refresh()
      if (token) syncGoogleNow(token).then(res => {
        const n = pulledChanges(res?.summary)
        if (n > 0) onPulled?.(n)
        refresh()
      })
    } else if (result === 'denied') {
      toast('Bạn đã từ chối cấp quyền Google Tasks')
    } else if (result === 'expired') {
      toast('Phiên kết nối hết hạn — vui lòng thử lại')
    } else {
      toast('Kết nối Google thất bại — vui lòng thử lại')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleConnect() {
    if (!token || busy) return
    setBusy(true)
    const err = await startGoogleConnect(token)   // thanh cong thi ca trang chuyen sang Google
    if (err) { toast(err); setBusy(false) }
  }

  async function handleSyncNow() {
    if (!token || busy) return
    setBusy(true)
    const res = await syncGoogleNow(token)
    setBusy(false)
    if (!res) { toast('Không gọi được máy chủ đồng bộ'); return }
    if (!res.connected) { toast('Chưa kết nối Google Tasks'); refresh(); return }
    const s = res.summary
    const n = pulledChanges(s)
    if (n > 0) onPulled?.(n)
    const pushed = (s?.pushedCreated || 0) + (s?.pushedUpdated || 0) + (s?.pushedDeleted || 0)
    toast(pushed + n > 0 ? `Đồng bộ xong: đẩy ${pushed}, nhận ${n} thay đổi` : 'Đồng bộ xong — không có thay đổi')
    refresh()
  }

  async function handleDisconnect() {
    if (!token || busy) return
    if (!window.confirm('Ngắt kết nối Google Tasks? Task hai bên giữ nguyên, chỉ ngừng đồng bộ.')) return
    setBusy(true)
    const ok = await disconnectGoogle(token)
    setBusy(false)
    toast(ok ? 'Đã ngắt kết nối Google Tasks' : 'Ngắt kết nối thất bại')
    refresh()
  }

  // Chua goi xong lan dau -> khong chiem cho
  if (!checked) return null

  return (
    <div className="mx-4 mb-2.5 flex items-center gap-2 rounded-[10px] border border-[#E8E7E2] bg-[#FBFAF7] px-3 py-1.5 flex-wrap">
      <span className="text-[13px]">🗓️</span>
      {status?.connected ? (
        <>
          <div className="min-w-0 flex-1 text-[11px] text-[#555]">
            <span className="font-bold text-[#0c2340]">Google Tasks</span>
            <span className="mx-1 text-[#bbb]">·</span>
            <span className="truncate">{status.email || 'đã kết nối'}</span>
            {status.lastSyncedAt && (
              <span className="text-[#999]"> — sync {new Date(status.lastSyncedAt).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}</span>
            )}
          </div>
          <button onClick={handleSyncNow} disabled={busy}
            className="flex items-center gap-1 text-[10.5px] font-bold px-2.5 py-1 rounded-md border border-[#E8E7E2] bg-white text-[#0c2340] hover:border-blue-300 transition disabled:opacity-40">
            <RefreshCw size={11} className={busy ? 'animate-spin' : ''} /> Đồng bộ ngay
          </button>
          <button onClick={handleDisconnect} disabled={busy} title="Ngắt kết nối"
            className="flex items-center gap-1 text-[10.5px] px-2 py-1 rounded-md border border-[#E8E7E2] bg-white text-[#999] hover:text-red-600 hover:border-red-300 transition disabled:opacity-40">
            <Unlink size={11} />
          </button>
        </>
      ) : (
        <>
          <div className="min-w-0 flex-1 text-[11px] text-[#777]">
            Đồng bộ việc với <span className="font-bold text-[#0c2340]">Google Tasks</span> — tạo/sửa/hoàn thành 2 chiều, tự hiện trên Google Calendar
          </div>
          <button onClick={handleConnect} disabled={busy}
            className="flex items-center gap-1.5 text-[10.5px] font-bold px-3 py-1 rounded-md bg-[#0c2340] text-white hover:bg-[#16345c] transition disabled:opacity-40">
            <Link2 size={11} /> Kết nối Google Tasks
          </button>
        </>
      )}
    </div>
  )
}
