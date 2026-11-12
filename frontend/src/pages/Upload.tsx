import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, FileSpreadsheet, FileUp, Trash2 } from 'lucide-react'
import { useApp } from '@/context'
import { api, ApiError } from '@/lib/api'
import { cn } from '@/lib/format'
import { schoolMonths, schoolOrder } from '@/lib/months'
import type { Upload as U } from '@/lib/types'
import { Card, Field, PageTitle, Spinner } from '@/components/ui'

interface Preview {
  token: string
  file_name: string
  period_from: string | null
  period_to: string | null
  school_name: string
  months: number[]
  suggested_month: number | null
  school_year: number | null
  grades: { grade: number; count: number; with_unexcused: number }[]
  existing: Record<string, number[]>
}

export default function Upload() {
  const { state, year, readonly, toast, confirm, bump, go, version } = useApp()
  const start = state!.settings.rules.start_month
  const [pv, setPv] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const [grades, setGrades] = useState<number[]>([])
  const [month, setMonth] = useState<number | null>(null)
  const [sy, setSy] = useState<number>(year)
  const [done, setDone] = useState<{ saved: Record<string, number>; new_alerts: number; month: number } | null>(null)
  const [list, setList] = useState<U[]>([])
  const [drag, setDrag] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const load = () => api.get<U[]>('/uploads', { school_year: year }).then(setList)
  useEffect(() => {
    load().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, version])

  const pick = async (f: File | undefined) => {
    if (!f) return
    setBusy(true)
    setDone(null)
    try {
      const p = await api.upload<Preview>('/upload/preview', f)
      setPv(p)
      const present = p.grades.map((g) => g.grade)
      const mine = state!.settings.grades.filter((g) => present.includes(g))
      setGrades(mine.length ? mine : present)
      setMonth(p.suggested_month)
      setSy(p.school_year ?? year)
    } catch (e: any) {
      toast(e.message, 'error')
      setPv(null)
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  const commit = async (overwrite = false): Promise<void> => {
    if (!pv || !month) return
    setBusy(true)
    try {
      const r = await api.post<{ saved: Record<string, number>; new_alerts: number }>('/upload/commit', { token: pv.token, grades, month, school_year: sy, overwrite })
      setDone({ ...r, month })
      setPv(null)
      const n = Object.values(r.saved).reduce((a, b) => a + b, 0)
      toast(`${month}월 자료 ${n}명을 저장했습니다${r.new_alerts ? ` · 이번 업로드로 서류에 없는 내역 ${r.new_alerts}건` : ''}`, r.new_alerts ? 'warn' : 'ok')
      bump()
    } catch (e) {
      const err = e as ApiError
      if (err.status === 409) {
        setBusy(false)
        const ok = await confirm({
          title: '이미 올린 달입니다',
          body: (
            <div className="flex flex-col gap-2">
              <p>{err.message}</p>
              <p className="text-muted">새 파일로 덮어씁니다. 그 달 기록만 바뀌고 다른 달·제외·생활지도 이력은 그대로입니다.</p>
            </div>
          ),
          ok: '덮어쓰기',
        })
        if (ok) return commit(true)
        return
      }
      toast(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (u: U) => {
    const ok = await confirm({ title: '업로드를 지울까요', body: `${u.school_year}학년도 ${u.grade}학년 ${u.month}월 기록 ${u.student_count}명을 지웁니다.`, ok: '지우기', danger: true })
    if (!ok) return
    try {
      await api.del(`/uploads/${u.id}`)
      toast('지웠습니다')
      bump()
    } catch (e: any) {
      toast(e.message, 'error')
    }
  }

  const monthChoices = pv?.months.length ? pv.months : schoolMonths(start)
  const existsFor = (pv && month && pv.existing[String(month)]) || []

  return (
    <div className="flex flex-col gap-6">
      <PageTitle icon={FileUp} title="자료 올리기" sub="나이스에서 내려받은 「결석자 조회」 파일을 정제하지 않고 그대로 올립니다" />

      <Card title="1. 파일 고르기">
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDrag(true)
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDrag(false)
            if (!readonly) pick(e.dataTransfer.files?.[0])
          }}
          className={cn(
            'flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center transition-colors duration-150',
            drag ? 'border-accent bg-[color-mix(in_srgb,var(--accent)_5%,#fff)]' : 'border-line'
          )}
        >
          <FileSpreadsheet size={28} className="text-muted" />
          <p className="text-sm text-ink">.xlsx · .xls 파일을 여기에 끌어 놓거나</p>
          <button className="btn btn-secondary" disabled={busy || readonly} onClick={() => input.current?.click()}>
            {busy ? <Spinner /> : <FileUp size={16} />} 파일 고르기
          </button>
          <input ref={input} type="file" accept=".xlsx,.xls,.html,.htm" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
          <p className="text-xs text-muted">페이지마다 반복되는 머리·쪽 번호·합계 행은 알아서 걸러 냅니다. 전 학년 파일을 올려도 됩니다.</p>
        </div>
      </Card>

      {pv && (
        <Card title="2. 미리 읽기 결과 확인">
          <div className="flex flex-col gap-5">
            <dl className="grid grid-cols-4 gap-4 text-sm">
              <div>
                <dt className="label">파일</dt>
                <dd className="truncate text-ink-strong" title={pv.file_name}>
                  {pv.file_name}
                </dd>
              </div>
              <div>
                <dt className="label">감지한 기간</dt>
                <dd className="num text-ink-strong">{pv.period_from ? `${pv.period_from} ~ ${pv.period_to}` : '찾지 못함'}</dd>
              </div>
              <div>
                <dt className="label">학교</dt>
                <dd className="text-ink-strong">{pv.school_name || '–'}</dd>
              </div>
              <div>
                <dt className="label">인원</dt>
                <dd className="num text-ink-strong">{pv.grades.reduce((a, g) => a + g.count, 0)}명</dd>
              </div>
            </dl>

            <div>
              <p className="label mb-2">분석할 학년</p>
              <table className="tbl max-w-xl rounded-lg border border-line">
                <thead>
                  <tr>
                    <th className="w-10" />
                    <th>학년</th>
                    <th className="r">인원</th>
                    <th className="r">미인정 있는 학생</th>
                  </tr>
                </thead>
                <tbody>
                  {pv.grades.map((g) => (
                    <tr key={g.grade}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`${g.grade}학년`}
                          checked={grades.includes(g.grade)}
                          onChange={(e) => setGrades(e.target.checked ? [...grades, g.grade].sort() : grades.filter((x) => x !== g.grade))}
                        />
                      </td>
                      <td className="font-medium text-ink-strong">{g.grade}학년</td>
                      <td className="r num">{g.count}명</td>
                      <td className="r num">{g.with_unexcused}명</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-end gap-4">
              <Field label={pv.months.length > 1 ? '월 (기간이 여러 달에 걸칩니다 — 고르십시오)' : '월'}>
                <div className="flex flex-wrap gap-2">
                  {[...monthChoices]
                    .sort((a, b) => schoolOrder(a, start) - schoolOrder(b, start))
                    .map((m) => (
                      <button
                        key={m}
                        type="button"
                        aria-pressed={month === m}
                        onClick={() => setMonth(m)}
                        className={cn(
                          'h-8 min-w-[52px] rounded-md border px-2 text-sm font-medium num transition-colors duration-150',
                          month === m ? 'border-accent bg-[color-mix(in_srgb,var(--accent)_8%,#fff)] text-accent-ink' : 'border-line bg-surface text-ink hover:bg-raised'
                        )}
                      >
                        {m}월
                      </button>
                    ))}
                </div>
              </Field>
              <Field label="학년도">
                <input type="number" className="field w-28 num" value={sy} onChange={(e) => setSy(Number(e.target.value))} />
              </Field>
            </div>

            {existsFor.length > 0 && (
              <p className="flex items-center gap-2 text-sm text-late-ink">
                <AlertTriangle size={16} /> {existsFor.map((g) => `${g}학년`).join(', ')} {month}월 자료가 이미 있습니다. 분석하면 덮어쓰기를 확인합니다.
              </p>
            )}
            {sy !== state!.settings.current_year && (
              <p className="text-sm text-late-ink">현재 학년도({state!.settings.current_year})가 아닌 자료는 저장할 수 없습니다. 설정에서 학년도를 바꾸십시오.</p>
            )}

            <div className="flex gap-2">
              <button className="btn btn-primary" disabled={busy || !grades.length || !month || readonly} onClick={() => commit(false)}>
                {busy && <Spinner className="text-white" />} 분석
              </button>
              <button className="btn btn-ghost" onClick={() => setPv(null)}>
                취소
              </button>
            </div>
          </div>
        </Card>
      )}

      {done && (
        <Card title="저장했습니다">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm text-ink">
              {Object.entries(done.saved)
                .map(([g, n]) => `${g}학년 ${n}명`)
                .join(', ')}{' '}
              · {done.month}월
              {done.new_alerts > 0 && <span className="ml-2 text-late-ink">· 이번 업로드로 서류에 없는 내역 {done.new_alerts}건</span>}
            </p>
            <div className="flex gap-2">
              {done.new_alerts > 0 && (
                <button className="btn btn-secondary" onClick={() => go('exclusions')}>
                  알림 보기
                </button>
              )}
              <button className="btn btn-primary" onClick={() => go('dashboard')}>
                대시보드로
              </button>
            </div>
          </div>
        </Card>
      )}

      <Card title={`올린 자료 (${year}학년도)`} pad={false}>
        {list.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted">아직 올린 자료가 없습니다.</p>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>학년</th>
                <th>월</th>
                <th>기간</th>
                <th>파일</th>
                <th className="r">인원</th>
                <th>올린 때</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((u) => (
                <tr key={u.id}>
                  <td>{u.grade}학년</td>
                  <td className="num font-medium text-ink-strong">{u.month}월</td>
                  <td className="num text-xs text-muted">
                    {u.period_from} ~ {u.period_to}
                  </td>
                  <td className="max-w-[260px] truncate text-muted" title={u.file_name}>
                    {u.file_name}
                  </td>
                  <td className="r num">{u.student_count}명</td>
                  <td className="num text-xs text-muted">{u.uploaded_at}</td>
                  <td className="r">
                    {!readonly && (
                      <button className="btn btn-ghost btn-icon" aria-label="지우기" onClick={() => remove(u)}>
                        <Trash2 size={16} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  )
}
