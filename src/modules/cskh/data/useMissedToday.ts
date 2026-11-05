// Người đã bấm "Khách chưa nghe máy" hôm nay (migration 206) — nạp lại mỗi khi CSKH báo dữ liệu đổi.
import { useEffect, useState } from 'react';
import { onCskhDataChanged } from '../../../lib/cskh/events';
import { loadMissedOn } from '../../../lib/voiceRec/missed';

const EMPTY: ReadonlySet<string> = new Set();

export function useMissedToday(today: string): ReadonlySet<string> {
  const [ids, setIds] = useState<ReadonlySet<string>>(EMPTY);
  useEffect(() => {
    let alive = true;
    const load = () => { loadMissedOn(today).then(s => { if (alive) setIds(s.size ? s : EMPTY); }).catch(() => {}); };
    load();
    const off = onCskhDataChanged(load);
    return () => { alive = false; off(); };
  }, [today]);
  return ids;
}
