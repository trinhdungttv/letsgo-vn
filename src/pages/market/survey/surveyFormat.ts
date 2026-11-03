// Định dạng ngày giờ / thời lượng dùng chung cho các màn Khảo sát KCN.

export const fmtDateTime = (iso: string) => new Date(iso).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });

/** "1:05" — thời lượng ngắn kiểu máy ghi âm. */
export const fmtClock = (sec: number) => {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
