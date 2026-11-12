export type Item = 'abs' | 'late' | 'leave' | 'result'
export const ITEMS: Item[] = ['abs', 'late', 'leave', 'result']
export const ITEM_LABEL: Record<Item, string> = { abs: '결석', late: '지각', leave: '조퇴', result: '결과' }
export const ITEM_COLOR: Record<Item, string> = {
  abs: 'var(--absent)',
  late: 'var(--late)',
  leave: 'var(--early)',
  result: 'var(--result)',
}
export type Counts = Record<Item, number>

export interface Rules {
  start_month: number
  count: Record<Item, boolean>
  conversion: { mode: 'weighted' | 'simple'; n: number }
  threshold: number
  reset: { enabled: boolean; scope: 'through' | 'before' }
  stages: { count: number; final_name: string; stage_name: string }
  measures: Record<string, Record<string, string>>
}

export interface MinutesDefault {
  place?: string
  chair?: string
  members?: string
  time_range?: string
}

export interface Settings {
  setup_done: boolean
  school_name: string
  current_year: number
  grades: number[]
  rules: Rules
  minutes_defaults: Record<string, MinutesDefault>
  recent_reasons: string[]
}

export interface RulesText {
  parts: Record<string, string>
  summary: string[]
}

export interface AppState {
  version: string
  settings: Settings
  school_year: number
  readonly: boolean
  school_years: number[]
  months_by_grade: Record<string, number[]>
  rules_text: RulesText
  missing_measures: string[]
}

export interface MonthRes {
  month: number
  raw: Counts
  eff: Counts
  doc: Counts
  all_excluded: boolean
  reasons: string[]
  counted: boolean
  cum_score?: number
  cum_carry?: number
  detail?: Record<string, any>
}

export interface LookupRow {
  student_id: string
  name: string
  class: number
  number: number
  totals: Counts
  raw: Counts
  doc: Counts
  score: number
  carry: number
  months: MonthRes[]
  has_exclusion: boolean
  status?: string | null
  crisis?: boolean
}

export interface Stage {
  index: number
  step: number
  final: boolean
  label: string
  short: string
  key: string
  measure: string
}

export interface Guidance {
  id: number
  school_year: number
  student_id: string
  name: string
  grade: number
  step: number
  month: number | null
  date: string
  measure: string
  meeting_id: number | null
  meeting_seq?: number | null
  note: string
}

export interface TargetRow {
  student_id: string
  name: string
  class: number
  totals: Counts
  raw: Counts
  doc: Counts
  score: number
  carry: number
  months: MonthRes[]
  stage: Stage
  guidance_count: number
  last_guidance: Guidance | null
  count_from: number
  alerts: number
  became_target: boolean
  status?: string | null
  crisis?: boolean
}

export interface Dashboard {
  lookup: LookupRow[]
  targets: TargetRow[]
  summary: { lookup: number; targets: number; excluded: number; alerts: number }
  data_months: number[]
}

export interface ExEntry {
  reason: string
  mode: 'all' | 'documented'
  counts?: Counts
  note?: string
}

export interface Exclusion {
  id?: number
  school_year?: number
  student_id: string
  name: string
  all_period: boolean
  all_reason: string
  months: Record<string, ExEntry[]>
  note?: string
  records?: Record<string, Counts>
}

export interface Alert {
  id: number
  student_id: string
  name: string
  class: number
  month: number
  item: Item
  recorded: number
  documented: number
  missing: number
  kind: 'over' | 'undocumented'
  reason: string
  became_target: number
  status: 'open' | 'acknowledged'
  text: string
}

export interface Upload {
  id: number
  school_year: number
  grade: number
  month: number
  period_from: string
  period_to: string
  file_name: string
  uploaded_at: string
  student_count: number
}

export interface MinutesMonth {
  month: number
  label: string
  abs: string
  others: string
}

export interface MinutesStudent {
  student_id: string
  name: string
  kind: 'guidance' | 'crisis'
  step: number
  stage_short: string
  stage_final: boolean
  measure_text: string
  months: MinutesMonth[]
  total_lines: string[]
  score: number
  carry: number
}

export interface MinutesPayload {
  school_year: number
  grade: number
  seq: number
  dept_name: string
  start_month: number
  date: string
  time_range: string
  place: string
  chair: string
  members: string
  basis_month: number
  guidance_month: number
  basis_date_text: string
  basis_phrase: string
  crisis_text: string
  include_year_total: boolean
  title: string
  agenda: string
  datetime_text: string
  referred_line: string
  students: MinutesStudent[]
}

export interface Meeting {
  id: number
  school_year: number
  grade: number
  seq: number
  date: string
  time_range: string
  status: 'draft' | 'final'
  created_at: string
  updated_at: string
  student_count?: number
  title?: string
  payload?: MinutesPayload
}

export interface Personal {
  student_id: string
  name: string
  grade: number
  class: number
  number: number
  months: MonthRes[]
  raw: Counts
  eff: Counts
  doc: Counts
  score: number
  carry: number
  raw_score: number
  raw_carry: number
  is_target: boolean
  next_stage: Stage
  guidance: Guidance[]
  exclusion: Exclusion | null
  count_from: number | null
  roster?: { status: string; status_date: string | null; crisis: boolean; note: string | null } | null
}

export interface RosterStudent {
  id: number
  student_id: string
  name: string
  grade: number
  class: number
  number: number
  status: string
  status_date: string | null
  crisis: boolean
  note: string | null
  source: 'upload' | 'manual'
  score: number | null
  carry: number | null
  months: number[]
  raw: Counts | null
  guidance_count: number
  has_exclusion: boolean
  alerts: number
  is_target: boolean
}
