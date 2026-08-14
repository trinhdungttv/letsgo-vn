// ─────────────────────────────────────────────────────────────────────────────
// Tra cứu tên chi nhánh cho các màn hình CHỈ HIỂN THỊ.
//
// Nhiều nơi chỉ cần in ra tên chi nhánh của một khách hàng, không sửa gì.
// useBranchData() thì mỗi lần gọi lại bắn một request riêng — dùng ở 5-6 chỗ là
// thừa 5-6 request cho một bảng 14 dòng gần như không đổi. Hook này nạp một lần
// rồi chia sẻ cho mọi nơi; nơi nào cần THÊM/SỬA chi nhánh thì vẫn dùng
// useBranchData() như cũ.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { Branch } from '../lib/types'
import { branchOf, branchLabel } from '../lib/branchRef'

let cache: Branch[] | null = null
let inflight: Promise<Branch[]> | null = null
const subscribers = new Set<(b: Branch[]) => void>()

function load(): Promise<Branch[]> {
  if (cache) return Promise.resolve(cache)
  if (!inflight) {
    inflight = (async () => {
      const { data } = await supabase.from('branches').select('*').order('name')
      cache = (data ?? []) as Branch[]
      inflight = null
      subscribers.forEach(fn => fn(cache!))
      return cache
    })()
  }
  return inflight
}

/** Buộc nạp lại ở lần dùng kế tiếp — gọi sau khi thêm/sửa/xoá chi nhánh. */
export function invalidateBranchLookup() {
  cache = null
}

export function useBranchLookup() {
  const [branches, setBranches] = useState<Branch[]>(cache ?? [])

  useEffect(() => {
    let alive = true
    load().then(b => { if (alive) setBranches(b) })
    const fn = (b: Branch[]) => { if (alive) setBranches(b) }
    subscribers.add(fn)
    return () => { alive = false; subscribers.delete(fn) }
  }, [])

  return {
    branches,
    /** Tên chi nhánh của một bản ghi, sẵn sàng in ra màn hình. */
    labelOf: (row: { branch_id?: string | null; region?: string | null } | null | undefined) =>
      branchLabel(branchOf(row, branches)),
  }
}
