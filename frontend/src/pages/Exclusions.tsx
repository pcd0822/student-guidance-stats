import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, ChevronDown, ChevronRight, Download, Plus, ShieldMinus, Trash2, Users, X } from 'lucide-react'
import { useApp } from '@/context'
import { api, download } from '@/lib/api'
import { cn, normalizeId } from '@/lib/format'
import { schoolMonths } from '@/lib/months'
import type { Alert, Counts, ExEntry, Exclusion, Item } from '@/lib/types'
import { ITEM_LABEL, ITEMS } from '@/lib/types'
import { Card, Empty, Field, Loading, PageTitle, SaveButton, Toggle } from '@/components/ui'
import ExclusionBulk from './ExclusionBulk'

const ZERO: Counts = { abs: 0, late: 0, leave: 0, result: 0 }

function entryTitle(m: string, e: ExEntry) {
  if (e.mode === 'all') return `${m}월 · ${e.reason || '사유 없음'} · 그 달 전체 제외`
  const c = ITEMS.filter((k) => e.counts?.[k]).map((k) => `${ITEM_LABEL[k]} 서류 ${e.counts![k]}회`)
  return `${m}월 · ${e.reason || '사유 없음'} · ${c.join(', ') || '서류 0회'}`
}

export default function Exclusions() {
  const { state, year, readonly, toast, confirm, bump, version } = useApp()
  const [list, setList] = useState<Exclusion[] | null>(null)
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [showAck, setShowAck] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [focusMonth, setFocusMonth] = useState<number | null>(null)
  const [jump, setJump] = useState(0)
  const [focusItem, setFocusItem] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [bulk, setBulk] = useState(false)

  const load = async () => {
    const [l, a] = await Promise.all([api.get<Exclusion[]>('/exclusions', { school_year: year }), api.get<Alert[]>('/alerts', { school_year: year })])
    setList(l)
    setAlerts(a)
  }
  useEffect(() => {
    load().catch((e) => toast(e.message, 'error'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, version])

  // 알림의 「서류 횟수 수정」을 누르면 그 학생 칸을 펼치고 그 달 입력 칸으로 바로 옮겨 간다
  useEffect(() => {
    if (!jump || !open) return
    const t = setTimeout(() => {
      const el = document.getElementById(`ex-month-${open}-${focusMonth}`) || document.getElementById(`ex-student-${open}`)
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      const input = ((focusItem && el?.querySelector(`input[data-item="${focusItem}"]`)) || el?.querySelector('input')) as HTMLInputElement | null
      input?.focus({ preventScroll: true })
    }, 60)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jump])

  const openAlerts = alerts.filter((a) => a.status === 'open')
  const shown = showAck ? alerts : openAlerts

  const ack = async (a: Alert, reopen = false) => {
    try {
      await api.post(`/alerts/${a.id}/ack`, { reopen })
      bump()
    } catch (e: any) {
      toast(e.message, 'error')
    }
  }

  const exportXlsx = async () => {
    try {
      const p = await download(`/alerts/export.xlsx?school_year=${year}`, '서류에_없는_내역.xlsx')
      if (p) toast(`저장했습니다: ${p}`)
    } catch (e: any) {
      toast(e.message, 'error')
    }
  }

  const remove = async (e: Exclusion) => {
    if (!(await confirm({ title: '제외 등록을 지울까요', body: `${e.student_id} ${e.name} 학생의 모든 달 제외 사유를 지웁니다. 지우면 그 기록이 다시 누적에 들어갑니다.`, ok: '지우기', danger: true }))) return
    try {
      await api.del(`/exclusions/${e.id}`)
      toast('지웠습니다')
      setOpen(null)
      bump()
    } catch (err: any) {
      toast(err.message, 'error')
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageTitle
        icon={ShieldMinus}
        title="제외 처리"
        sub="증빙 서류에 적힌 횟수만 입력합니다. 서류에 없는 미인정은 앱이 알려 드립니다"
        right={
          !readonly && (
            <div className="flex gap-2">
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setAdding(true)
                  setBulk(false)
                  setOpen(null)
                }}
              >
                <Plus size={16} /> 학생 한 명 추가
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  setBulk(true)
                  setAdding(false)
                  setOpen(null)
                }}
              >
                <Users size={16} /> 여러 학생 한 번에 추가
              </button>
            </div>
          )
        }
      />

      <Card
        title={
          <span className="flex items-center gap-2">
            서류에 없는 내역
            <span className="num text-sm font-medium text-late-ink">{openAlerts.length}건</span>
          </span>
        }
        right={
          <div className="flex items-center gap-4">
            <Toggle checked={showAck} onChange={setShowAck} label="확인한 알림도 보기" />
            <button className="btn btn-secondary btn-sm" onClick={exportXlsx} disabled={!openAlerts.length}>
              <Download size={14} /> 반별 엑셀로 내보내기
            </button>
          </div>
        }
        pad={false}
      >
        {!list ? (
          <Loading />
        ) : shown.length === 0 ? (
          <p className="px-5 py-6 text-center text-sm text-muted">서류에 없는 내역이 없습니다.</p>
        ) : (
          <ul className="max-h-[360px] divide-y divide-line overflow-auto">
            {shown.map((a) => (
              <li key={a.id} className={cn('flex items-center gap-3 px-5 py-3', a.status !== 'open' && 'opacity-60')}>
                <AlertTriangle size={16} className={a.status === 'open' ? 'text-late-ink' : 'text-faint'} />
                <span className="num text-xs text-muted">{a.class}반</span>
                <span className="min-w-0 flex-1 text-sm text-ink">
                  {a.text}
                  {a.reason && <span className="ml-1 text-muted">({a.reason})</span>}
                </span>
                {!!a.became_target && (
                  <span className="inline-flex h-6 items-center rounded-md px-2 text-xs font-medium text-absent" style={{ background: 'color-mix(in srgb, var(--absent) 10%, #fff)' }}>
                    대상자 됨
                  </span>
                )}
                {!readonly && (
                  <>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        setOpen(a.student_id)
                        setFocusMonth(a.month)
                        setFocusItem(a.item)
                        setAdding(false)
                        setBulk(false)
                        setJump((n) => n + 1)
                      }}
                    >
                      서류 횟수 수정
                    </button>
                    {a.status === 'open' ? (
                      <button className="btn btn-ghost btn-sm" onClick={() => ack(a)} title="서류에 없는 것이 맞음 — 누적에 그대로 반영하고 알림을 닫습니다">
                        <Check size={14} /> 확인함
                      </button>
                    ) : (
                      <button className="btn btn-ghost btn-sm" onClick={() => ack(a, true)}>
                        다시 열기
                      </button>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {bulk && (
        <Card title="여러 학생 한 번에 추가">
          <ExclusionBulk
            onClose={() => setBulk(false)}
            onSaved={() => {
              setBulk(false)
              bump()
            }}
          />
        </Card>
      )}

      {adding && (
        <Card title="새 제외 등록">
          <ExclusionEditor
            initial={{ student_id: '', name: '', all_period: false, all_reason: '', months: {} }}
            isNew
            onCancel={() => setAdding(false)}
            onSaved={(sid) => {
              setAdding(false)
              setOpen(sid)
              bump()
            }}
          />
        </Card>
      )}

      <Card title={`제외 명단 (${list?.length ?? 0}명)`} pad={false}>
        {!list ? (
          <Loading />
        ) : list.length === 0 ? (
          <Empty icon={ShieldMinus} title="제외 등록이 없습니다" sub="자퇴·숙려제·학원 수강처럼 서류로 확인된 미인정을 학생 × 달 단위로 뺍니다." />
        ) : (
          <ul className="divide-y divide-line">
            {list.map((e) => {
              const isOpen = open === e.student_id
              return (
                <li key={e.student_id} id={`ex-student-${e.student_id}`} className="scroll-mt-4">
                  <button className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-[color-mix(in_srgb,var(--raised)_50%,transparent)]" onClick={() => setOpen(isOpen ? null : e.student_id)}>
                    {isOpen ? <ChevronDown size={16} className="text-muted" /> : <ChevronRight size={16} className="text-muted" />}
                    <span className="num w-14 text-xs text-muted">{e.student_id}</span>
                    <span className="w-20 font-medium text-ink-strong">{e.name}</span>
                    <MonthDots e={e} start={state!.settings.rules.start_month} />
                    {e.all_period && (
                      <span className="ml-2 inline-flex h-6 items-center rounded-md bg-raised px-2 text-xs font-medium text-ink">전체 기간 · {e.all_reason}</span>
                    )}
                  </button>
                  {isOpen && (
                    <div className="border-t border-line bg-paper px-5 py-5">
                      <ExclusionEditor
                        key={e.student_id}
                        initial={e}
                        focusMonth={focusMonth}
                        onCancel={() => setOpen(null)}
                        onSaved={() => bump()}
                        onDelete={() => remove(e)}
                      />
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </div>
  )
}

function MonthDots({ e, start }: { e: Exclusion; start: number }) {
  return (
    <span className="flex flex-wrap gap-1">
      {schoolMonths(start).map((m) => {
        const ents = e.all_period ? (e.records?.[String(m)] ? [{ reason: e.all_reason, mode: 'all' as const }] : []) : e.months[String(m)] || []
        const has = ents.length > 0
        return (
          <span
            key={m}
            title={has ? ents.map((x) => entryTitle(String(m), x)).join('\n') : `${m}월`}
            className={cn(
              'grid h-7 w-11 place-items-center rounded-md border text-xs num',
              has ? 'border-accent bg-[color-mix(in_srgb,var(--accent)_8%,#fff)] text-accent-ink' : 'border-line text-faint'
            )}
          >
            {has ? `${m}·${(ents[0].reason || '?').slice(0, 1)}` : `${m}월`}
          </span>
        )
      })}
    </span>
  )
}

function ExclusionEditor({
  initial,
  isNew = false,
  focusMonth,
  onCancel,
  onSaved,
  onDelete,
}: {
  initial: Exclusion
  isNew?: boolean
  focusMonth?: number | null
  onCancel: () => void
  onSaved: (sid: string) => void
  onDelete?: () => void
}) {
  const { state, year, readonly, toast } = useApp()
  const start = state!.settings.rules.start_month
  const reasons = state!.settings.recent_reasons
  const [e, setE] = useState<Exclusion>(() => JSON.parse(JSON.stringify(initial)))
  const [records, setRecords] = useState<Record<string, Counts>>(initial.records || {})
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [lookupMsg, setLookupMsg] = useState('')
  const [base, setBase] = useState(() => JSON.stringify(initial))
  const dirty = isNew || JSON.stringify(e) !== base

  // 다른 곳(여러 명 추가 등)에서 이 학생 제외가 바뀌었고, 여기서 고친 게 없으면 새 내용으로 맞춘다
  const initialKey = JSON.stringify(initial)
  useEffect(() => {
    if (!dirty && initialKey !== base) {
      setE(JSON.parse(initialKey))
      setRecords(initial.records || {})
      setBase(initialKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialKey])

  const lookup = async (raw: string) => {
    const sid = normalizeId(raw)
    if (!sid) return
    setE((x) => ({ ...x, student_id: sid }))
    try {
      const r = await api.get<{ name: string; records: Record<string, Counts> }>(`/students/${sid}`, { school_year: year })
      setE((x) => ({ ...x, student_id: sid, name: r.name }))
      setRecords(r.records)
      setLookupMsg('')
    } catch {
      setLookupMsg('이 학년도 자료에 없는 학번입니다. 이름을 직접 적으십시오')
    }
  }

  const setMonth = (m: string, ents: ExEntry[] | null) =>
    setE((x) => {
      const months = { ...x.months }
      if (ents && ents.length) months[m] = ents
      else delete months[m]
      return { ...x, months }
    })

  // 같은 항목 서류 횟수 합이 기록 값을 넘는지
  const over = useMemo(() => {
    const out: Record<string, Partial<Record<Item, number>>> = {}
    for (const [m, ents] of Object.entries(e.months)) {
      const rec = records[m]
      if (!rec) continue
      for (const k of ITEMS) {
        const tot = ents.filter((x) => x.mode === 'documented').reduce((a, x) => a + (x.counts?.[k] || 0), 0)
        if (tot > rec[k]) (out[m] = out[m] || {})[k] = rec[k]
      }
    }
    return out
  }, [e.months, records])
  const hasOver = Object.keys(over).length > 0
  const missingReason = !e.all_period && Object.values(e.months).some((ents) => ents.some((x) => !x.reason.trim()))

  const save = async () => {
    setSaving(true)
    try {
      const r = await api.put<{ new_alerts: number }>('/exclusions', { ...e, school_year: year })
      toast(`${e.student_id} ${e.name} 제외 내용을 저장했습니다${r.new_alerts ? ` · 서류에 없는 내역 ${r.new_alerts}건이 새로 생겼습니다` : ''}`, r.new_alerts ? 'warn' : 'ok')
      setBase(JSON.stringify(e))
      setSavedAt(Date.now())
      onSaved(e.student_id)
    } catch (err: any) {
      toast(err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <datalist id="reason-list">
        {reasons.map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>
      <div className="flex flex-wrap items-end gap-4">
        <Field label="학번" hint={lookupMsg}>
          <input
            className="field w-28 num"
            value={e.student_id}
            disabled={!isNew}
            onChange={(ev) => setE({ ...e, student_id: ev.target.value })}
            onBlur={(ev) => lookup(ev.target.value)}
            onKeyDown={(ev) => ev.key === 'Enter' && lookup((ev.target as HTMLInputElement).value)}
            placeholder="30206"
            autoFocus={isNew}
          />
        </Field>
        <Field label="이름">
          <input className="field w-32" value={e.name} onChange={(ev) => setE({ ...e, name: ev.target.value })} />
        </Field>
        <div className="flex h-9 items-center">
          <Toggle checked={e.all_period} onChange={(v) => setE({ ...e, all_period: v })} label="전체 기간" disabled={readonly} />
        </div>
        {e.all_period && (
          <Field label="전체 기간 사유" hint="자료가 있는 모든 달을 「그 달 전체 제외」로 칩니다. 새 달 자료에도 자동 적용합니다">
            <input className="field w-56" list="reason-list" value={e.all_reason} onChange={(ev) => setE({ ...e, all_reason: ev.target.value })} placeholder="예: 자퇴" />
          </Field>
        )}
      </div>

      {!e.all_period && (
        <>
          <div>
            <p className="label mb-2">제외할 달 (체크하면 그 달 칸이 펼쳐집니다)</p>
            <div className="flex flex-wrap gap-2">
              {schoolMonths(start).map((m) => {
                const k = String(m)
                const on = !!e.months[k]
                const rec = records[k]
                const hasU = !!rec && ITEMS.some((i) => rec[i] > 0)
                return (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={on}
                    disabled={readonly || (!on && !hasU)}
                    onClick={() => setMonth(k, on ? null : [{ reason: '', mode: 'all' }])}
                    title={!rec ? `${m}월 자료 없음` : !hasU ? `${m}월 미인정 없음` : `기록: ${ITEMS.map((i) => `${ITEM_LABEL[i]} ${rec[i]}`).join(' · ')}`}
                    className={cn(
                      'h-7 min-w-[44px] rounded-md border px-2 text-xs font-medium num transition-colors duration-150',
                      on ? 'border-accent bg-[color-mix(in_srgb,var(--accent)_8%,#fff)] text-accent-ink' : hasU ? 'border-line bg-surface text-ink hover:bg-raised' : 'cursor-not-allowed border-line bg-paper text-faint'
                    )}
                  >
                    {m}월
                  </button>
                )
              })}
            </div>
          </div>
          {Object.keys(e.months)
            .map(Number)
            .sort((a, b) => schoolMonths(start).indexOf(a) - schoolMonths(start).indexOf(b))
            .map((m) => (
              <MonthPanel key={m} sid={e.student_id} m={m} ents={e.months[String(m)]} rec={records[String(m)]} over={over[String(m)] || {}} onChange={(ents) => setMonth(String(m), ents)} focused={focusMonth === m} />
            ))}
        </>
      )}

      <div className="flex items-center justify-between">
        <div>
          {onDelete && !readonly && (
            <button className="btn btn-danger" onClick={onDelete}>
              <Trash2 size={16} /> 제외 등록 지우기
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {hasOver && <span className="text-sm text-absent">서류 횟수가 기록보다 많은 칸이 있습니다</span>}
          {missingReason && <span className="text-sm text-absent">사유를 입력하십시오</span>}
          <button className="btn btn-secondary" onClick={onCancel}>
            닫기
          </button>
          <SaveButton
            dirty={dirty}
            saving={saving}
            savedAt={savedAt}
            onClick={save}
            disabled={readonly || hasOver || missingReason || !e.student_id || (e.all_period ? !e.all_reason.trim() : !Object.keys(e.months).length)}
          />
        </div>
      </div>
    </div>
  )
}

function MonthPanel({
  sid,
  m,
  ents,
  rec,
  over,
  onChange,
  focused,
}: {
  sid: string
  m: number
  ents: ExEntry[]
  rec?: Counts
  over: Partial<Record<Item, number>>
  onChange: (e: ExEntry[]) => void
  focused: boolean
}) {
  const set = (i: number, patch: Partial<ExEntry>) => onChange(ents.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  return (
    <div id={`ex-month-${sid}-${m}`} className={cn('rounded-xl border bg-surface p-4', focused ? 'border-accent' : 'border-line')}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-ink-strong">{m}월</p>
        <p className="num text-xs text-muted">
          {rec ? `기록 — ${ITEMS.map((k) => `${ITEM_LABEL[k]} ${rec[k]}`).join(' · ')}` : '이 달 자료가 아직 없습니다(올리면 기록과 대조합니다)'}
        </p>
      </div>
      <div className="flex flex-col gap-3">
        {ents.map((x, i) => (
          <div key={i} className="flex flex-col gap-3 rounded-lg bg-paper p-3">
            <div className="flex flex-wrap items-end gap-3">
              <Field label="사유">
                <input className="field w-48" list="reason-list" value={x.reason} aria-invalid={!x.reason.trim()} onChange={(ev) => set(i, { reason: ev.target.value })} placeholder="학원 수강, 숙려제 …" />
              </Field>
              <fieldset className="flex h-9 items-center gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <input type="radio" checked={x.mode === 'all'} onChange={() => set(i, { mode: 'all', counts: undefined })} />그 달 전체 제외
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" checked={x.mode === 'documented'} onChange={() => set(i, { mode: 'documented', counts: x.counts || { ...ZERO } })} />
                  서류 확인 횟수만큼 제외
                </label>
              </fieldset>
              <button className="btn btn-ghost btn-icon ml-auto" aria-label="이 사유 지우기" onClick={() => onChange(ents.filter((_, j) => j !== i))}>
                <X size={16} />
              </button>
            </div>
            {x.mode === 'documented' && (
              <div className="flex flex-wrap items-start gap-3">
                {ITEMS.map((k) => (
                  <Field key={k} label={`${ITEM_LABEL[k]} 서류 횟수`} hint={over[k] !== undefined ? <span className="text-absent">기록은 {over[k]}회입니다</span> : undefined}>
                    <input
                      type="number"
                      min={0}
                      data-item={k}
                      className="field w-28 num"
                      aria-invalid={over[k] !== undefined}
                      value={x.counts?.[k] ?? 0}
                      onChange={(ev) => set(i, { counts: { ...(x.counts || ZERO), [k]: Math.max(0, Number(ev.target.value) || 0) } })}
                    />
                  </Field>
                ))}
              </div>
            )}
            <Field label="증빙 메모 (서류 제출일, 비고)">
              <input className="field" value={x.note || ''} onChange={(ev) => set(i, { note: ev.target.value })} placeholder="예: 10/31 학원 확인서" />
            </Field>
          </div>
        ))}
        <button className="btn btn-ghost btn-sm self-start" onClick={() => onChange([...ents, { reason: '', mode: 'documented', counts: { ...ZERO } }])}>
          <Plus size={14} /> 사유 추가
        </button>
      </div>
    </div>
  )
}
