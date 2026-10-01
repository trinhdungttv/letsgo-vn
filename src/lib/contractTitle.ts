export const CONTRACT_TYPES = ['Hợp đồng', 'Phụ lục'] as const
const PREFIX: Record<string, string> = { 'Hợp đồng': 'HĐ', 'Phụ lục': 'Phụ lục' }

/** Tiêu đề chuẩn cho việc Hợp đồng / Phụ lục: "Tên KH — HĐ <tên>" hoặc "Tên KH — Phụ lục <tên>". */
export function contractTitle(clientName: string | null | undefined, type: string, desc: string): string {
  const d = desc.trim()
  const p = PREFIX[type]
  const hasPrefix = p && new RegExp(`^(${p}|hợp đồng|phụ lục)\\b`, 'i').test(d)
  const body = p && !hasPrefix ? `${p} ${d}` : d
  return clientName ? `${clientName} — ${body}` : body
}
