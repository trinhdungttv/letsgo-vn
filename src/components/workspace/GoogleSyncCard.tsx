// Thanh ket noi Google Calendar (mirror 2 chieu, khong dung Google Tasks) — hien trong feed "Viec cua toi".
// Chua ket noi: nut "Ket noi Google". Da ket noi: email + chon lich Calendar + Dong bo ngay / Ngat.
import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Link2, Unlink, CalendarDays, Settings } from 'lucide-react'
import { useAuth } from '../../lib/auth'
import {
  getGoogleSyncStatus, startGoogleConnect, disconnectGoogle, syncGoogleNow, pulledChanges,
  listGoogleCalendars, setGoogleCalendar,
  type GoogleSyncStatus, type GoogleCalendarOption,
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
  // Chon lich Google Calendar de do viec vao
  const [calOptions, setCalOptions] = useState<GoogleCalendarOption[] | null>(null)
  const [calLoading, setCalLoading] = useState(false)
  const [calPicking, setCalPicking] = useState(false)

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
      toast('Đã kết nối Google Calendar — đang đồng bộ lần đầu...')
      refresh()
      if (token) syncGoogleNow(token).then(res => {
        const n = pulledChanges(res?.summary)
        if (n > 0) onPulled?.(n)
        refresh()
      })
    } else if (result === 'denied') {
      toast('Bạn đã từ chối cấp quyền Google Calendar')
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
    if (!res.connected) { toast('Chưa kết nối Google Calendar'); refresh(); return }
    const s = res.summary
    const n = pulledChanges(s)
    if (n > 0) onPulled?.(n)
    if (s?.calendarError) {
      toast('Lỗi Google Calendar — thử Ngắt kết nối rồi kết nối lại để cấp thêm quyền lịch')
    } else {
      const pushed = (s?.pushedCreated || 0) + (s?.pushedUpdated || 0) + (s?.pushedDeleted || 0)
      toast(pushed + n > 0 ? `Đồng bộ xong: đẩy ${pushed}, nhận ${n} thay đổi` : 'Đồng bộ xong — không có thay đổi')
    }
    refresh()
  }

  // Mo khung chon lich: tai danh sach lich tu Google roi hien <select>
  async function openCalendarPicker() {
    if (!token || calLoading) return
    setCalPicking(true)
    if (!calOptions) {
      setCalLoading(true)
      const cals = await listGoogleCalendars(token)
      setCalLoading(false)
      if (!cals) {
        toast('Không tải được danh sách lịch — thử Ngắt kết nối rồi kết nối lại để cấp quyền lịch')
        setCalPicking(false)
        return
      }
      setCalOptions(cals)
    }
  }

  async function handlePickCalendar(calId: string) {
    if (!token || busy) return
    const cal = (calOptions || []).find(c => c.id === calId)
    setBusy(true)
    const ok = await setGoogleCalendar(token, calId, cal?.summary || '')
    setBusy(false)
    setCalPicking(false)
    if (!ok) { toast('Lưu lựa chọn lịch thất bại'); return }
    if (calId) {
      toast(`Việc sẽ hiện trên lịch "${cal?.summary || calId}" — đang đồng bộ...`)
      handleSyncNow()   // day event len lich moi ngay
    } else {
      toast('Đã tắt hiển thị việc trên Google Calendar')
      refresh()
    }
  }

  async function handleDisconnect() {
    if (!token || busy) return
    if (!window.confirm('Ngắt kết nối Google Calendar? Task hai bên giữ nguyên, chỉ ngừng đồng bộ.')) return
    setBusy(true)
    const ok = await disconnectGoogle(token)
    setBusy(false)
    toast(ok ? 'Đã ngắt kết nối Google Calendar' : 'Ngắt kết nối thất bại')
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
            <span className="font-bold text-[#0c2340]">Google Calendar</span>
            <span className="mx-1 text-[#bbb]">·</span>
            <span className="truncate">{status.email || 'đã kết nối'}</span>
            {status.lastSyncedAt && (
              <span className="text-[#999]"> — sync {new Date(status.lastSyncedAt).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}</span>
            )}
          </div>
          {calPicking && calOptions ? (
            <select
              autoFocus
              defaultValue={status.calendarId || ''}
              onChange={e => handlePickCalendar(e.target.value)}
              onBlur={() => setCalPicking(false)}
              className="text-[10.5px] px-2 py-1 rounded-md border border-[#E8E7E2] bg-white text-[#0c2340] focus:outline-none focus:border-blue-400 max-w-[220px]"
            >
              <option value="">— Không hiện trên Calendar —</option>
              {calOptions.map(c => (
                <option key={c.id} value={c.id}>{c.summary}{c.primary ? ' (lịch chính)' : ''}</option>
              ))}
            </select>
          ) : status.calendarSummary ? (
            <div className="flex items-center gap-1 text-[10.5px] text-[#777]">
              <CalendarDays size={11} />
              <span className="truncate max-w-[150px]">Lịch: {status.calendarSummary}</span>
              <button onClick={openCalendarPicker} disabled={busy || calLoading} title="Đổi lịch Google Calendar"
                className="flex items-center justify-center w-5 h-5 rounded-md border border-[#E8E7E2] bg-white text-[#999] hover:text-[#0c2340] hover:border-blue-300 transition disabled:opacity-40">
                <Settings size={10} className={calLoading ? 'animate-spin' : ''} />
              </button>
            </div>
          ) : (
            <button onClick={openCalendarPicker} disabled={busy || calLoading}
              title="Chọn lịch Google Calendar để hiện việc"
              className="flex items-center gap-1 text-[10.5px] font-bold px-2.5 py-1 rounded-md border border-[#E8E7E2] bg-white text-[#0c2340] hover:border-blue-300 transition disabled:opacity-40 max-w-[190px]">
              <CalendarDays size={11} className={calLoading ? 'animate-pulse' : ''} />
              <span className="truncate">Chọn lịch Calendar</span>
            </button>
          )}
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
            Đồng bộ việc với <span className="font-bold text-[#0c2340]">Google Calendar</span> — tạo/sửa/xoá 2 chiều, hiện trên lịch bạn chọn
          </div>
          <button onClick={handleConnect} disabled={busy}
            className="flex items-center gap-1.5 text-[10.5px] font-bold px-3 py-1 rounded-md bg-[#0c2340] text-white hover:bg-[#16345c] transition disabled:opacity-40">
            <Link2 size={11} /> Kết nối Google
          </button>
        </>
      )}
    </div>
  )
}
