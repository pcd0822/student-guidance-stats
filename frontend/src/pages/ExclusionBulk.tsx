import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { useApp } from '@/context'
import { api, ApiError } from '@/lib/api'
import { cn, normalizeId } from '@/lib/format'
import { schoolMonths } from '@/lib/months'
import type { Counts, Item } from '@/lib/types'
import { ITEM_LABEL, ITEMS } from '@/lib/types'
import { Field, Spinner, Toggle } from '@/components/ui'

interface Stu {
  student_id: string
  name: string
  records: Record<string, Counts>
  found: boolean
}

const ZERO: Counts = { abs: 0, late: 0, leave: 0, result: 0 }

/** 붙여 넣은 글에서 학번(4~5자리 숫자)만 골라낸다. 엑셀에서 학번·이름 열을 통째로 복사해도 된다 */
export function parseIds(text: string): string[] {
  const out: string[] = []
  for (const m of text.match(/\d+/g) || []) {
    if (m.length < 4 || m.length > 5) continue
    const id = normalizeId(m)
    if (!out.includes(id)) out.push(id)
  }
  return out
}

export default function ExclusionBulk({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { state, year, toast } = useApp()
  const start = state!.settings.rules.start_month
  const reasons = state!.settings.recent_reasons
  const [text, setText] = useState('')
  const [studs, setStuds] = useState<Stu[]>([])
  const [loading, setLoading] = useState(false)
  const [allPeriod, setAllPeriod] = useState(false)
  const [reason, setReason] = useState('')
  const [mode, setMode] = useState<'all' | 'documented'>('all')
  const [months, setMonths] = useState<number[]>([])
  const [note, setNote] = useState('')
  const [counts, setCounts] = useState<Record<string, Record<string, Counts>>>({})
  const [errors, setErrors] = useState<{ student_id: string; name: string; message: string }[]>([])
  const [saving, setSaving] = useState(false)

  // 붙여 넣은 학번을 찾아 이름·달별 기록을 불러온다
  useEffect(() => {
    const ids = parseIds(text)
    const t = setTimeout(async () => {
      const keep = studs.filter((s) => ids.includes(s.student_id))
      const need = ids.filter((id) => !keep.some((s) => s.student_id === id))
      if (!need.length) {
        setStuds(ids.map((id) => keep.find((s) => s.student_id === id)!))
        return
      }
      setLoading(true)
      const got = await Promise.all(
        need.map((id) =>
          api
            .get<{ name: string; records: Record<string, Counts> }>(`/students/${id}`, { school_year: year })
            .then((r) => ({ student_id: id, name: r.name, records: r.records || {}, found: Object.keys(r.records || {}).length > 0 }))
            .catch(() => ({ student_id: id, name: '', records: {}, found: false }))
        )
      )
      setLoading(false)
      const all = [...keep, ...got]
      setStuds(ids.map((id) => all.find((s) => s.student_id === id)!))
    }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, year])

  const sortedMonths = useMemo(() => schoolMonths(start).filter((m) => months.includes(m)), [months, start])
  const getC = (sid: string, m: number) => counts[sid]?.[String(m)] || ZERO
  const setC = (sid: string, m: number, k: Item, v: number) =>
    setCounts((c) => ({ ...c, [sid]: { ...(c[sid] || {}), [String(m)]: { ...(c[sid]?.[String(m)] || ZERO), [k]: Math.max(0, v || 0) } } }))

  // 서류 횟수가 기록보다 많은 칸
  const over = (s: Stu, m: number, k: Item) => {
    const rec = s.records[String(m)]
    return !!rec && getC(s.student_id, m)[k] > rec[k]
  }
  const anyOver = mode === 'documented' && !allPeriod && studs.some((s) => sortedMonths.some((m) => ITEMS.some((k) => over(s, m, k))))
  const notFound = studs.filter((s) => !s.found)
  const canSave = studs.length > 0 && reason.trim() && (allPeriod || months.length > 0) && !anyOver && !saving

  const save = async () => {
    setSaving(true)
    setErrors([])
    try {
      const r = await api.post<{ saved: number; unknown: string[]; new_alerts: number }>('/exclusions/bulk', {
        school_year: year,
        student_ids: studs.map((s) => s.student_id),
        reason: reason.trim(),
        all_period: allPeriod,
        mode,
        months,
        note,
        counts: mode === 'documented' ? counts : undefined,
      })
      toast(`${r.saved}명에게 제외를 더했습니다${r.new_alerts ? ` · 서류에 없는 내역 ${r.new_alerts}건` : ''}`, r.new_alerts ? 'warn' : 'ok')
      onSaved()
    } catch (e) {
      const err = e as ApiError
      if (err.data?.errors) setErrors(err.data.errors)
      toast(err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <datalist id="bulk-reason-list">
        {reasons.map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-5">
        <Field label="학번 목록" hint="줄마다, 쉼표로, 또는 엑셀에서 학번·이름 열을 복사해 붙여 넣으십시오. 학번(5자리)만 골라 씁니다">
          <textarea className="field num h-48" value={text} onChange={(e) => setText(e.target.value)} placeholder={'30101\n30102\n30215 홍길동'} autoFocus />
        </Field>
        <div className="flex flex-col gap-1">
          <span className="label">
            학생 {studs.length}명 {loading && <Spinner className="ml-1 inline" />}
          </span>
          <div className="h-48 overflow-auto rounded-lg border border-line">
            {studs.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted">왼쪽에 학번을 넣으면 여기에 이름이 나옵니다.</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {studs.map((s) => (
                  <li key={s.student_id} className="flex items-center gap-3 px-3 py-1.5">
                    <span className="num text-xs text-muted">{s.student_id}</span>
                    <span className={cn('font-medium', s.found ? 'text-ink-strong' : 'text-late-ink')}>{s.name || '이름 모름'}</span>
                    {!s.found && <span className="text-xs text-late-ink">이 학년도 자료에 없음</span>}
                    <button
                      className="btn btn-ghost btn-icon ml-auto h-6 w-6"
                      aria-label={`${s.student_id} 빼기`}
                      onClick={() => setText(studs.filter((x) => x.student_id !== s.student_id).map((x) => x.student_id).join('\n'))}
                    >
                      <X size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-5">
        <Field label="사유 (모두 같게)">
          <input className="field w-56" list="bulk-reason-list" value={reason} aria-invalid={!reason.trim()} onChange={(e) => setReason(e.target.value)} placeholder="학원 수강, 숙려제 …" />
        </Field>
        <div className="flex h-9 items-center">
          <Toggle checked={allPeriod} onChange={setAllPeriod} label="전체 기간(자퇴 등)" />
        </div>
        {!allPeriod && (
          <fieldset className="flex h-9 items-center gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" checked={mode === 'all'} onChange={() => setMode('all')} />그 달 전체 제외
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" checked={mode === 'documented'} onChange={() => setMode('documented')} />
              서류 확인 횟수만큼 제외
            </label>
          </fieldset>
        )}
      </div>

      {!allPeriod && (
        <div>
          <p className="label mb-2">제외할 달</p>
          <div className="flex flex-wrap gap-2">
            {schoolMonths(start).map((m) => {
              const on = months.includes(m)
              return (
                <button
                  key={m}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setMonths(on ? months.filter((x) => x !== m) : [...months, m])}
                  className={cn(
                    'h-7 min-w-[44px] rounded-md border px-2 text-xs font-medium num transition-colors duration-150',
                    on ? 'border-accent bg-[color-mix(in_srgb,var(--accent)_8%,#fff)] text-accent-ink' : 'border-line bg-surface text-ink hover:bg-raised'
                  )}
                >
                  {m}월
                </button>
              )
            })}
          </div>
        </div>
      )}

      {!allPeriod && mode === 'documented' && studs.length > 0 && sortedMonths.length > 0 && (
        <div className="max-h-[420px] overflow-auto rounded-lg border border-line">
          <table className="tbl">
            <thead>
              <tr>
                <th>학번</th>
                <th>이름</th>
                <th>달</th>
                {ITEMS.map((k) => (
                  <th key={k}>{ITEM_LABEL[k]} 서류 횟수</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {studs.flatMap((s) =>
                sortedMonths.map((m, mi) => {
                  const rec = s.records[String(m)]
                  return (
                    <tr key={s.student_id + m}>
                      <td className="num text-xs text-muted">{mi === 0 ? s.student_id : ''}</td>
                      <td className="font-medium text-ink-strong">{mi === 0 ? s.name : ''}</td>
                      <td className="num">{m}월</td>
                      {ITEMS.map((k) => (
                        <td key={k}>
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min={0}
                              className="field field-sm w-16 num"
                              aria-invalid={over(s, m, k)}
                              value={getC(s.student_id, m)[k]}
                              onChange={(e) => setC(s.student_id, m, k, Number(e.target.value))}
                            />
                            <span className={cn('text-xs num', over(s, m, k) ? 'text-absent' : 'text-muted')}>{rec ? `기록 ${rec[k]}` : '자료 없음'}</span>
                          </div>
                        </td>
                      ))}
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      <Field label="증빙 메모 (모두 같게, 선택)">
        <input className="field" value={note} onChange={(e) => setNote(e.target.value)} placeholder="예: 10/31 학원 확인서 일괄 제출" />
      </Field>

      {errors.length > 0 && (
        <div className="rounded-lg border px-4 py-3 text-sm" style={{ borderColor: 'color-mix(in srgb, var(--absent) 35%, #fff)' }}>
          <p className="mb-1 flex items-center gap-2 font-medium text-absent">
            <AlertTriangle size={16} /> 아래 학생 때문에 아무것도 저장하지 않았습니다
          </p>
          <ul className="list-disc pl-5 text-ink">
            {errors.map((e) => (
              <li key={e.student_id}>
                {e.student_id} {e.name}: {e.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted">
          이미 제외가 등록된 학생은 기존 내용에 더합니다. 같은 달에 같은 사유가 있으면 새 값으로 바꿉니다.
          {notFound.length > 0 && <span className="text-late-ink"> 자료에 없는 학번 {notFound.length}개도 등록됩니다.</span>}
        </p>
        <div className="flex items-center gap-2">
          {anyOver && <span className="text-sm text-absent">서류 횟수가 기록보다 많은 칸이 있습니다</span>}
          <button className="btn btn-secondary" onClick={onClose}>
            닫기
          </button>
          <button className="btn btn-primary" disabled={!canSave} onClick={save}>
            {saving && <Spinner className="text-white" />} {studs.length}명에게 한 번에 추가
          </button>
        </div>
      </div>
    </div>
  )
}
