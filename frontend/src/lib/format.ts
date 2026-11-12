import type { Counts, Item } from './types'
import { ITEM_LABEL, ITEMS } from './types'

/** "조퇴 10 (서류 7)" 처럼 원래 값과 제외 값을 함께 */
export function withDoc(raw: number, doc: number) {
  return doc ? `${raw} (서류 ${doc})` : `${raw}`
}

export function countsText(c: Counts, items: Item[] = ITEMS) {
  const parts = items.filter((k) => c[k]).map((k) => `${ITEM_LABEL[k]} ${c[k]}`)
  return parts.length ? parts.join(' · ') : '없음'
}

export function sum(c: Counts) {
  return ITEMS.reduce((a, k) => a + (c[k] || 0), 0)
}

export function today() {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function cn(...xs: (string | false | null | undefined)[]) {
  return xs.filter(Boolean).join(' ')
}

export function normalizeId(v: string) {
  const s = (v || '').replace(/\D/g, '')
  return s ? s.padStart(5, '0') : ''
}
