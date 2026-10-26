// Chữ cái đầu cho avatar chi nhánh khi chưa có ảnh.
// Tên chi nhánh thường bắt đầu bằng "LGV - " nên cắt phần tiền tố này đi, nếu không mọi dòng đều là "LG".

const PREFIX = /^(?:LGV|LG|Let'?s\s*Go(?:\s*VN)?)\s*[-–—:]\s*/i;

export function branchInitials(name: string | null | undefined, shortName?: string | null): string {
  let base = (shortName?.trim() || name?.trim() || '').normalize('NFC');
  const stripped = base.replace(PREFIX, '').trim();
  if (stripped) base = stripped;
  // "Biên Hoà - Ms Thương" → chỉ lấy phần đầu trước dấu gạch
  base = base.split(/\s[-–—]\s/)[0].replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').trim();
  const words = base.split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  const chars = (w: string) => Array.from(w);
  const letters = words.length >= 2 ? [chars(words[0])[0], chars(words[1])[0]] : chars(words[0]).slice(0, 2);
  return letters.join('').toLocaleUpperCase('vi');
}
