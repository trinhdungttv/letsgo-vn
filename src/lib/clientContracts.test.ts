import { describe, it, expect } from 'vitest'
import { summarizeContracts, contractState, type ClientContract } from './clientContracts'

const k = (p: Partial<ClientContract>): ClientContract => ({
  id: Math.random().toString(), client_id: 'c', name: '', scope: '', start_date: null, end_date: null,
  terminated_at: null, renewed_from: null, notes: '', ...p,
})

describe('Olam: A thanh lý, B giữ, A ký lại', () => {
  const A = k({ scope: 'A', start_date: '2025-01-01', end_date: '2026-12-31', terminated_at: '2026-05-31' })
  const B = k({ scope: 'B', start_date: '2025-01-01', end_date: '2026-12-31' })
  const A2 = k({ scope: 'A', start_date: '2026-09-20', end_date: '2026-12-31', renewed_from: A.id })
  it('chỉ tính HĐ chưa thanh lý', () => {
    expect(summarizeContracts([A, B, A2])).toEqual({ contract_start: '2025-01-01', contract_end: '2026-12-31' })
  })
  it('B hết hạn sớm hơn A2 → hạn công ty = A2', () => {
    const B2 = { ...B, end_date: '2026-10-31' }
    expect(summarizeContracts([A, B2, A2]).contract_end).toBe('2026-12-31')
  })
  it('tất cả thanh lý → lấy ngày thanh lý muộn nhất', () => {
    expect(summarizeContracts([A, { ...B, terminated_at: '2026-06-30' }]).contract_end).toBe('2026-06-30')
  })
  it('không còn HĐ → null', () => {
    expect(summarizeContracts([])).toEqual({ contract_start: null, contract_end: null })
  })
  it('trạng thái', () => {
    expect(contractState(A, '2026-11-05')).toBe('terminated')
    expect(contractState(B, '2026-11-05')).toBe('expiring')
    expect(contractState({ end_date: '2026-01-01', terminated_at: null }, '2026-11-05')).toBe('expired')
  })
})
