// 미인정 출결 현황(공유·내려받기). 서버 app/report.py 와 같은 규칙으로 고른다.
import type { Item } from './types'

export interface ReportMonth {
  raw: Record<Item, number>
  doc: Record<Item, number>
  all: boolean
  reasons: string[]
}

export interface ReportStudent {
  student_id: string
  name: string
  grade: number
  class: number
  number: number
  status?: string | null
  crisis?: boolean
  months: Record<string, ReportMonth>
}

export interface ReportData {
  school_name: string
  school_year: number
  generated_at: string
  start_month: number
  items: { key: Item; label: string }[]
  rules: { count: Record<Item, boolean>; mode: string; n: number }
  grades: Record<string, number[]>
  students: ReportStudent[]
}

export type Scope = 'student' | 'class' | 'all'

export interface Pick {
  scope: Scope
  grade: number // 0 = 모든 학년(전체에서만)
  cls: number
  sid: string
  months: number[] | null // null = 모든 달
}

export interface Group {
  grade: number
  cls: number
  months: number[]
  rows: ReportStudent[]
}

const order = (m: number, start: number) => (m - start + 12) % 12

export function sortM(ms: number[], start: number) {
  return [...ms].sort((a, b) => order(a, start) - order(b, start))
}

export function selectGroups(d: ReportData, p: Pick): Group[] {
  let rows = d.students
  if (p.scope === 'student') rows = rows.filter((r) => r.student_id === p.sid)
  else {
    if (p.grade) rows = rows.filter((r) => r.grade === p.grade)
    if (p.scope === 'class') rows = rows.filter((r) => r.class === p.cls)
  }
  const map = new Map<number, Group>()
  for (const r of rows) {
    const k = r.grade * 1000 + r.class
    let g = map.get(k)
    if (!g) {
      let ms = (d.grades[String(r.grade)] || []).map(Number)
      if (p.months) ms = ms.filter((m) => p.months!.includes(m))
      g = { grade: r.grade, cls: r.class, months: sortM(ms, d.start_month), rows: [] }
      map.set(k, g)
    }
    g.rows.push(r)
  }
  return [...map.keys()].sort((a, b) => a - b).map((k) => map.get(k)!)
}

export function sums(r: ReportStudent, months: number[], items: Item[]) {
  const raw = Object.fromEntries(items.map((k) => [k, 0])) as Record<Item, number>
  const doc = { ...raw }
  for (const m of months) {
    const pm = r.months[String(m)]
    if (!pm) continue
    for (const k of items) {
      raw[k] += pm.raw[k]
      doc[k] += pm.doc[k]
    }
  }
  return { raw, doc }
}

export function scoreText(d: ReportData, r: ReportStudent, months: number[]) {
  const items = d.items.map((i) => i.key)
  const { raw, doc } = sums(r, months, items)
  const c = (k: Item) => (d.rules.count[k] ? raw[k] - doc[k] : 0)
  let sc = 0
  let carry = 0
  if (d.rules.mode === 'simple') sc = c('abs') + c('late') + c('leave') + c('result')
  else {
    const o = c('late') + c('leave') + c('result')
    const n = d.rules.n || 3
    sc = c('abs') + Math.floor(o / n)
    carry = o % n
  }
  return `${sc}점${carry ? ` (이월 ${carry})` : ''}`
}

export function fileTitle(d: ReportData, p: Pick) {
  const y = d.school_year
  if (p.scope === 'student') {
    const r = d.students.find((x) => x.student_id === p.sid)
    return `${y}학년도_미인정출결_${p.sid}${r?.name ? `_${r.name}` : ''}`
  }
  if (p.scope === 'class') return `${y}학년도_미인정출결_${p.grade}-${p.cls}`
  return `${y}학년도_미인정출결_${p.grade ? `${p.grade}학년` : '전체'}`
}

export function pickQuery(p: Pick) {
  const q: Record<string, string> = { scope: p.scope }
  if (p.scope !== 'student' && p.grade) q.grade = String(p.grade)
  if (p.scope === 'class') q.cls = String(p.cls)
  if (p.scope === 'student') q.sid = p.sid
  if (p.months) q.months = p.months.join(',')
  return q
}
