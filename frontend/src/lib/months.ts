export function schoolOrder(m: number, start = 3) {
  return (m - start + 12) % 12
}
export function schoolMonths(start = 3): number[] {
  return Array.from({ length: 12 }, (_, i) => ((start - 1 + i) % 12) + 1)
}
export function sortMonths(ms: Iterable<number>, start = 3): number[] {
  return Array.from(new Set(ms)).sort((a, b) => schoolOrder(a, start) - schoolOrder(b, start))
}
export function monthsLabel(ms: number[], start = 3): string {
  const s = sortMonths(ms, start)
  if (!s.length) return '선택한 달 없음'
  if (s.length === 1) return `${s[0]}월`
  // 이어진 달이면 3~5월
  const all = schoolMonths(start)
  const a = all.indexOf(s[0])
  const contiguous = s.every((m, i) => all[a + i] === m)
  return contiguous ? `${s[0]}~${s[s.length - 1]}월` : s.map((m) => `${m}월`).join('·')
}
