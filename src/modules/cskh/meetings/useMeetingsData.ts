// Dữ liệu tab Đi họp: thành viên + lịch họp (1 lượt qua meeting_rpc 'bootstrap').
// Tải khi mở tab; ghi xong gọi reload(). Chưa chạy migration 217 → missing = true (hiện hướng dẫn, không báo lỗi đỏ).
import { useCallback, useEffect, useState } from 'react';
import { loadMeetings, MeetingError } from '../../../lib/meetings/api';
import type { MeetingBootstrap } from '../../../lib/meetings/types';

export function useMeetingsData() {
  const [data, setData] = useState<MeetingBootstrap | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  const reload = useCallback(async () => {
    try {
      const r = await loadMeetings();
      setData(r);
      setError(null);
      setMissing(false);
    } catch (e) {
      setMissing(e instanceof MeetingError && e.missingMigration);
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  }, []);

  useEffect(() => { void reload(); }, [reload]);
  return { data, loading, error, missing, reload };
}
