import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, FileSpreadsheet, FileUp, Trash2, X } from 'lucide-react'
import { useApp } from '@/context'
import { api, ApiError } from '@/lib/api'
import { cn } from '@/lib/format'
import { schoolMonths, schoolOrder } from '@/lib/months'
import type { Upload as U } from '@/lib/types'
import { Card, Loading, PageTitle, Spinner } from '@/components/ui'

interface Preview {
  ok: boolean
  error?: string
  token?: string
  file_name: string
  period_from?: string | null
  period_to?: string | null
  school_name?: string
  months?: number[]
  multi_month?: boolean
  school_year?: number | null
  grades?: { grade: number; count: number; with_unexcused: number }[]
  existing?: Record<string, number[]>
}

interface Item extends Preview {
  month: number | null // 기간을 못 찾은 파일만 직접 고른다
}

interface Done {
  files: { file_name: string; month: number; school_year: number; saved: Record<string, number> }[]
  new_alerts: number
}

export default function Upload() {
  const { state, year, readonly, toast, confirm, bump, go, version } = useApp()
  const start = state!.settings.rules.start_month
  const [items, setItems] = useState<Item[]>([])
  const [busy, setBusy] = useState(false)
  const [grades, setGrades] = useState<number[]>([])
  const [done, setDone] = useState<Done | null>(null)
  const [list, setList] = useState<U[] | null>(null)
  const [drag, setDrag] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const load = () => api.get<U[]>('/uploads', { school_year: year }).then(setList)
  useEffect(() => {
    load().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, version])

  const pick = async (files: File[]) => {
    if (!files.length) return
    setBusy(true)
    setDone(null)
    try {
      const res = await api.uploadMany<Preview[]>('/upload/preview-many', files)
      // 앞서 고른 파일에 더한다(같은 이름은 새 것으로)
      const names = new Set(res.map((r) => r.file_name))
      const next: Item[] = [...items.filter((i) => !names.has(i.file_name)), ...res.map((r) => ({ ...r, month: r.months?.length === 1 ? r.months[0] : null }))]
      next.sort((a, b) => schoolOrder(a.months?.[0] ?? a.month ?? start, start) - schoolOrder(b.months?.[0] ?? b.month ?? start, start))
      setItems(next)
      const present = Array.from(new Set(next.flatMap((i) => (i.grades || []).map((g) => g.grade)))).sort()
      const mine = state!.settings.grades.filter((g) => present.includes(g))
      setGrades(mine.length ? mine : present)
    } catch (e: any) {
      toast(e.message, 'error')
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  const usable = items.filter((i) => i.ok && i.token && i.month)
  const problems = items.filter((i) => !i.ok)
  const needMonth = items.filter((i) => i.ok && !i.month)
  const monthsUsed = usable.map((i) => i.month!)
  const dupMonths = monthsUsed.filter((m, k) => monthsUsed.indexOf(m) !== k)
  const allGrades = Array.from(new Set(items.flatMap((i) => (i.grades || []).map((g) => g.grade)))).sort()
  const wrongYear = usable.filter((i) => i.school_year && i.school_year !== state!.settings.current_year)

  const commit = async (overwrite = false): Promise<void> => {
    if (!usable.length) return
    setBusy(true)
    try {
      const r = await api.post<Done>('/upload/commit-many', { grades, overwrite, items: usable.map((i) => ({ token: i.token, month: i.month })) })
      setDone(r)
      setItems([])
      const n = r.files.length
      toast(`${n}개 파일(${r.files.map((f) => `${f.month}월`).join(', ')})을 저장했습니다${r.new_alerts ? ` · 서류에 없는 내역 ${r.new_alerts}건` : ''}`, r.new_alerts ? 'warn' : 'ok')
      bump()
    } catch (e) {
      const err = e as ApiError
      if (err.status === 409) {
        setBusy(false)
        const ok = await confirm({
          title: '이미 올린 달이 있습니다',
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

  return (
    <div className="flex flex-col gap-6">
      <PageTitle icon={FileUp} title="자료 올리기" sub="나이스 「결석자 조회」 파일을 정제하지 않고 그대로 올립니다. 달마다 한 파일씩, 여러 달을 한 번에 올릴 수 있습니다" />

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
            if (!readonly) pick(Array.from(e.dataTransfer.files || []))
          }}
          className={cn(
            'flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center transition-colors duration-150',
            drag ? 'border-accent bg-[color-mix(in_srgb,var(--accent)_5%,#fff)]' : 'border-line'
          )}
        >
          <FileSpreadsheet size={28} className="text-muted" />
          <p className="text-sm text-ink">.xlsx · .xls 파일을 여기에 끌어 놓거나 (여러 개 가능)</p>
          <button className="btn btn-secondary" disabled={busy || readonly} onClick={() => input.current?.click()}>
            {busy ? <Spinner /> : <FileUp size={16} />} 파일 고르기
          </button>
          <input ref={input} type="file" multiple accept=".xlsx,.xls,.html,.htm" className="hidden" onChange={(e) => pick(Array.from(e.target.files || []))} />
          <p className="max-w-xl text-xs text-muted">
            나이스에서 기간을 <span className="text-ink">한 달씩</span>(예: 3/1~3/31, 4/1~4/30 …) 나눠 내려받으십시오. 여러 달을 한 기간으로 받은 파일은 학생별 합계만 있어 달별로 나눌 수 없으므로 올리지
            않습니다. 페이지마다 반복되는 머리·쪽 번호·합계 행은 알아서 걸러 냅니다.
          </p>
        </div>
      </Card>

      {items.length > 0 && (
        <Card
          title={`2. 미리 읽기 결과 확인 (${items.length}개 파일)`}
          right={
            <button className="btn btn-ghost btn-sm" onClick={() => setItems([])}>
              모두 비우기
            </button>
          }
          pad={false}
        >
          <table className="tbl">
            <thead>
              <tr>
                <th>파일</th>
                <th>기간</th>
                <th>월</th>
                {allGrades.map((g) => (
                  <th key={g} className="r">
                    {g}학년
                  </th>
                ))}
                <th>상태</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((it, k) => {
                const exist = it.month ? it.existing?.[String(it.month)] || [] : []
                const dup = it.month && dupMonths.includes(it.month)
                return (
                  <tr key={it.file_name + k} className={!it.ok ? 'bg-[color-mix(in_srgb,var(--absent)_4%,#fff)]' : ''}>
                    <td className="max-w-[220px] truncate font-medium text-ink-strong" title={it.file_name}>
                      {it.file_name}
                    </td>
                    <td className="num text-xs text-muted">{it.period_from ? `${it.period_from} ~ ${it.period_to}` : '–'}</td>
                    <td className="num">
                      {it.ok && it.months?.length === 1 && <span className="font-medium text-ink-strong">{it.month}월</span>}
                      {it.ok && !it.months?.length && (
                        <select
                          className="field field-sm"
                          aria-invalid={!it.month}
                          value={it.month ?? ''}
                          onChange={(e) => setItems(items.map((x, j) => (j === k ? { ...x, month: Number(e.target.value) || null } : x)))}
                        >
                          <option value="">기간 없음 — 월 고르기</option>
                          {schoolMonths(start).map((m) => (
                            <option key={m} value={m}>
                              {m}월
                            </option>
                          ))}
                        </select>
                      )}
                      {it.multi_month && <span className="text-absent">{it.months![0]}~{it.months![it.months!.length - 1]}월 합계</span>}
                    </td>
                    {allGrades.map((g) => {
                      const gg = it.grades?.find((x) => x.grade === g)
                      return (
                        <td key={g} className="r num text-xs">
                          {gg ? (
                            <>
                              {gg.count}명<span className="text-muted"> · 미인정 {gg.with_unexcused}</span>
                            </>
                          ) : (
                            <span className="text-faint">–</span>
                          )}
                        </td>
                      )
                    })}
                    <td className="text-xs">
                      {!it.ok ? (
                        <span className="flex items-start gap-1 text-absent">
                          <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {it.error}
                        </span>
                      ) : dup ? (
                        <span className="text-absent">같은 달 파일이 두 개입니다</span>
                      ) : exist.filter((g) => grades.includes(g)).length ? (
                        <span className="text-late-ink">이미 있음 — 덮어씀</span>
                      ) : it.month ? (
                        <span className="inline-flex items-center gap-1 text-accent-ink">
                          <CheckCircle2 size={14} /> 새로 저장
                        </span>
                      ) : (
                        <span className="text-late-ink">월을 고르십시오</span>
                      )}
                    </td>
                    <td className="r">
                      <button className="btn btn-ghost btn-icon" aria-label="이 파일 빼기" onClick={() => setItems(items.filter((_, j) => j !== k))}>
                        <X size={16} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="flex flex-col gap-4 border-t border-line px-5 py-4">
            <div className="flex flex-wrap items-center gap-4">
              <span className="label">분석할 학년</span>
              {allGrades.map((g) => (
                <label key={g} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={grades.includes(g)} onChange={(e) => setGrades(e.target.checked ? [...grades, g].sort() : grades.filter((x) => x !== g))} />
                  {g}학년
                </label>
              ))}
              <span className="text-xs text-muted">고른 학년만 모든 파일에서 저장합니다</span>
            </div>
            {problems.length > 0 && (
              <p className="text-sm text-absent">
                올릴 수 없는 파일 {problems.length}개는 빼고 저장합니다. 여러 달 합계 파일은 나이스에서 한 달씩 나눠 다시 받으십시오.
              </p>
            )}
            {wrongYear.length > 0 && (
              <p className="text-sm text-late-ink">현재 학년도({state!.settings.current_year})가 아닌 파일이 있습니다. 설정에서 학년도를 바꾸거나 그 파일을 빼십시오.</p>
            )}
            <div className="flex items-center gap-3">
              <button
                className="btn btn-primary"
                disabled={busy || readonly || !grades.length || !usable.length || needMonth.length > 0 || dupMonths.length > 0 || wrongYear.length > 0}
                onClick={() => commit(false)}
              >
                {busy && <Spinner className="text-white" />} {usable.length}개 파일 분석
                {usable.length > 0 && ` (${usable.map((i) => `${i.month}월`).join(', ')})`}
              </button>
              <button className="btn btn-secondary" disabled={busy || readonly} onClick={() => input.current?.click()}>
                파일 더 고르기
              </button>
            </div>
          </div>
        </Card>
      )}

      {done && (
        <Card title="저장했습니다">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="text-sm text-ink">
              {done.files.map((f) => (
                <p key={f.file_name}>
                  {f.month}월 —{' '}
                  {Object.entries(f.saved)
                    .map(([g, n]) => `${g}학년 ${n}명`)
                    .join(', ')}
                  <span className="text-muted"> ({f.file_name})</span>
                </p>
              ))}
              {done.new_alerts > 0 && <p className="mt-1 text-late-ink">이번 업로드로 서류에 없는 내역 {done.new_alerts}건</p>}
            </div>
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
        {!list ? (
          <Loading />
        ) : list.length === 0 ? (
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
