import { Fragment, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowDownUp, Download, FileText, LayoutDashboard, Link2, Search } from 'lucide-react'
import { useApp } from '@/context'
import { api } from '@/lib/api'
import { cn } from '@/lib/format'
import { monthsLabel, sortMonths } from '@/lib/months'
import type { Dashboard as D, Item, LookupRow, MonthRes, TargetRow } from '@/lib/types'
import { ITEMS } from '@/lib/types'
import { DownloadModal, ShareModal } from '@/components/ReportShare'
import { Card, CountCell, Empty, Legend, Loading, MonthChips, PageTitle, Spinner, StageBadge, Stat, StatusBadge, Toggle } from '@/components/ui'

// 화면을 옮겨 다녀도 고른 달을 기억한다(이번 실행 동안만)
const memo: Record<string, { lookup?: number[]; target?: number[]; expand?: boolean; apply?: boolean }> = {}

type SortKey = 'student_id' | 'name' | Item | 'score'

export default function Dashboard() {
  const { state, year, go, toast, version } = useApp()
  const grades = state!.settings.grades
  const start = state!.settings.rules.start_month
  const [grade, setGrade] = useState<number>(grades[0] ?? 3)
  const avail = state!.months_by_grade[String(grade)] || []
  // 자료가 있는 달이 바뀌면(새 업로드) 기본 선택을 다시 정한다
  const key = `${year}-${grade}-${avail.join(',')}`
  const m = (memo[key] = memo[key] || {})
  const [lookupMonths, setLookupMonths] = useState<number[]>(m.lookup ?? avail.slice(-1))
  const [targetMonths, setTargetMonths] = useState<number[]>(m.target ?? avail)
  const [expand, setExpand] = useState(!!m.expand)
  const [apply, setApply] = useState(!!m.apply)
  const [data, setData] = useState<D | null>(null)
  const [loading, setLoading] = useState(false)
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<{ k: SortKey; desc: boolean }>({ k: 'student_id', desc: false })
  const [picked, setPicked] = useState<string[]>([])
  const [shareOpen, setShareOpen] = useState(false)
  const [dlOpen, setDlOpen] = useState(false)

  // 학년·학년도가 바뀌면 고른 달 다시 정하기
  useEffect(() => {
    const mm = memo[key] || {}
    setLookupMonths(mm.lookup ?? avail.slice(-1))
    setTargetMonths(mm.target ?? avail)
    setPicked([])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  useEffect(() => {
    memo[key] = { lookup: lookupMonths, target: targetMonths, expand, apply }
  }, [key, lookupMonths, targetMonths, expand, apply])

  useEffect(() => {
    let alive = true
    setLoading(true)
    api
      .get<D>('/dashboard', { grade, lookup_months: lookupMonths.join(','), target_months: targetMonths.join(',') || '0', apply: apply ? 1 : 0, school_year: year })
      .then((d) => alive && setData(d))
      .catch((e) => toast(e.message, 'error'))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [grade, lookupMonths, targetMonths, apply, year, version, toast])

  const rows = useMemo(() => {
    let r = data?.lookup || []
    const s = q.trim()
    if (s) r = r.filter((x) => x.student_id.includes(s) || x.name.includes(s))
    const val = (x: LookupRow) => (sort.k === 'student_id' || sort.k === 'name' ? x[sort.k] : sort.k === 'score' ? x.score * 100 + x.carry : x.totals[sort.k])
    return [...r].sort((a, b) => {
      const va = val(a)
      const vb = val(b)
      const c = typeof va === 'number' ? (va as number) - (vb as number) : String(va).localeCompare(String(vb))
      return sort.desc ? -c : c
    })
  }, [data, q, sort])

  const th = (k: SortKey, label: string, right = false) => (
    <th className={right ? 'r' : ''}>
      <button className="inline-flex items-center gap-1 hover:text-ink-strong" onClick={() => setSort({ k, desc: sort.k === k ? !sort.desc : k !== 'student_id' && k !== 'name' })}>
        {label}
        {sort.k === k && <ArrowDownUp size={12} />}
      </button>
    </th>
  )

  const targets = data?.targets || []
  const pickedTargets = targets.filter((t) => picked.includes(t.student_id))
  const basis = sortMonths(targetMonths, start).slice(-1)[0]

  return (
    <div className="flex flex-col gap-6">
      <ShareModal open={shareOpen} onClose={() => setShareOpen(false)} />
      <DownloadModal open={dlOpen} onClose={() => setDlOpen(false)} defaultGrade={grade} />
      <PageTitle
        icon={LayoutDashboard}
        title="대시보드"
        sub={`${year}학년도 · 월별 미인정 내역과 생활지도 대상자를 봅니다`}
        right={
          <div className="flex items-center gap-3">
            <button className="btn btn-secondary" onClick={() => setShareOpen(true)}>
              <Link2 size={16} /> 링크 공유
            </button>
            <button className="btn btn-secondary" onClick={() => setDlOpen(true)}>
              <Download size={16} /> 다운로드
            </button>
            {data && data.summary.alerts > 0 && (
              <button
                className="btn btn-secondary"
                style={{ borderColor: 'color-mix(in srgb, var(--late) 50%, #fff)', color: 'var(--late-ink)' }}
                onClick={() => go('exclusions')}
              >
                <AlertTriangle size={16} /> 서류에 없는 내역 {data.summary.alerts}건
              </button>
            )}
            <div className="flex rounded-lg border border-line bg-surface p-0.5" role="tablist" aria-label="학년">
              {grades.map((g) => (
                <button
                  key={g}
                  role="tab"
                  aria-selected={g === grade}
                  onClick={() => setGrade(g)}
                  className={cn('h-8 rounded-md px-3 text-sm font-medium transition-colors duration-150', g === grade ? 'bg-raised text-ink-strong' : 'text-muted hover:text-ink-strong')}
                >
                  {g}학년
                </button>
              ))}
            </div>
          </div>
        }
      />

      {!avail.length ? (
        <div className="card">
          <Empty
            icon={LayoutDashboard}
            title={`${grade}학년 자료가 아직 없습니다`}
            sub="나이스에서 내려받은 「결석자 조회」 파일을 그대로 올리면 됩니다."
            action={
              <button className="btn btn-primary" onClick={() => go('upload')}>
                자료 올리기
              </button>
            }
          />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-4">
            <Stat label={`조회 (${monthsLabel(lookupMonths, start)})`} value={`${data?.summary.lookup ?? '–'}명`} />
            <Stat label={`대상자 (${monthsLabel(targetMonths, start)})`} value={`${data?.summary.targets ?? '–'}명`} tone={data?.summary.targets ? 'absent' : undefined} />
            <Stat label="제외 등록" value={`${data?.summary.excluded ?? '–'}명`} />
          </div>

          <Card
            title="① 월별 미인정 내역 조회"
            right={
              <div className="flex items-center gap-4">
                {loading && <Spinner />}
                <Legend />
              </div>
            }
            pad={false}
          >
            <div className="flex flex-col gap-3 border-b border-line px-5 py-4">
              <MonthChips start={start} value={lookupMonths} onChange={setLookupMonths} available={avail} label="더할 달" />
              <div className="flex flex-wrap items-center gap-5">
                <div className="relative">
                  <Search size={16} className="pointer-events-none absolute left-3 top-2.5 text-faint" />
                  <input className="field w-56 pl-9" placeholder="학번·이름 검색" value={q} onChange={(e) => setQ(e.target.value)} />
                </div>
                <Toggle checked={expand} onChange={setExpand} label="달별로 펼쳐 보기" />
                <Toggle checked={apply} onChange={setApply} label="제외 반영해서 보기" />
                <span className="text-xs text-muted">{apply ? '제외·초기화를 적용한 값입니다' : '원자료 그대로입니다. 제외·초기화는 대상자 명단에만 적용합니다'}</span>
              </div>
            </div>
            {!data ? (
              <Loading />
            ) : !lookupMonths.length ? (
              <p className="px-5 py-8 text-center text-sm text-muted">위에서 더할 달을 고르십시오.</p>
            ) : rows.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted">{monthsLabel(lookupMonths, start)}에 미인정이 있는 학생이 없습니다.</p>
            ) : (
              <div className="max-h-[560px] overflow-auto">
                <table className="tbl">
                  <thead>
                    <tr>
                      {th('student_id', '학번')}
                      {th('name', '이름')}
                      {th('abs', '미인정 결석')}
                      {th('late', '미인정 지각')}
                      {th('leave', '미인정 조퇴')}
                      {th('result', '미인정 결과')}
                      {th('score', '환산 점수', true)}
                      <th className="r">이월</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <Fragment key={r.student_id}>
                        <tr>
                          <td className="num text-xs text-muted">
                            <button className="hover:text-accent-ink" onClick={() => go('personal', { sid: r.student_id })}>
                              {r.student_id}
                            </button>
                          </td>
                          <td className="font-medium text-ink-strong">
                            <button className="hover:text-accent-ink" onClick={() => go('personal', { sid: r.student_id })}>
                              {r.name}
                            </button>
                            <StatusBadge status={r.status} crisis={r.crisis} />
                          </td>
                          {ITEMS.map((k) => (
                            <td key={k}>
                              <CountCell item={k} value={apply ? r.totals[k] : r.raw[k]} doc={apply ? 0 : r.doc[k]} />
                            </td>
                          ))}
                          <td className="r num text-base font-medium text-ink-strong">{r.score}</td>
                          <td className="r num text-muted">{r.carry ? `이월 ${r.carry}회` : '–'}</td>
                        </tr>
                        {expand &&
                          r.months
                            .filter((pm) => ITEMS.some((k) => pm.raw[k]))
                            .map((pm) => <MonthSubRow key={pm.month} pm={pm} apply={apply} />)}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card
            title="③ 생활지도 및 학생선도위원회 대상자 명단"
            right={
              <button
                className="btn btn-primary"
                disabled={!pickedTargets.length}
                onClick={() => go('minutes', { draft: { grade, student_ids: pickedTargets.map((t) => t.student_id), basis_month: basis } })}
              >
                <FileText size={16} /> 회의록 만들기{pickedTargets.length ? ` (${pickedTargets.length}명)` : ''}
              </button>
            }
            pad={false}
          >
            <div className="flex flex-col gap-2 border-b border-line px-5 py-4">
              <MonthChips start={start} value={targetMonths} onChange={setTargetMonths} available={avail} label="집계할 달" />
              <p className="text-xs text-muted">
                학생마다 마지막 생활지도 다음 달부터 체크한 달까지 제외·이월 규칙을 적용해 셉니다. 기준 {state!.settings.rules.threshold}점 이상.
              </p>
            </div>
            {!data ? (
              <Loading />
            ) : targets.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted">대상자가 없습니다.</p>
            ) : (
              <div className="max-h-[560px] overflow-auto">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th className="w-10">
                        <input
                          type="checkbox"
                          aria-label="모두 고르기"
                          checked={picked.length === targets.length}
                          onChange={(e) => setPicked(e.target.checked ? targets.map((t) => t.student_id) : [])}
                        />
                      </th>
                      <th>학번</th>
                      <th>이름</th>
                      <th>센 기간</th>
                      <th>결석</th>
                      <th>지각</th>
                      <th>조퇴</th>
                      <th>결과</th>
                      <th className="r">누적</th>
                      <th className="r">이월</th>
                      <th>해당 단계</th>
                      <th>지도 방안</th>
                    </tr>
                  </thead>
                  <tbody>
                    {targets.map((t) => (
                      <TargetTr key={t.student_id} t={t} picked={picked.includes(t.student_id)} onPick={(v) => setPicked(v ? [...picked, t.student_id] : picked.filter((x) => x !== t.student_id))} onOpen={() => go('personal', { sid: t.student_id })} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  )
}

function MonthSubRow({ pm, apply }: { pm: MonthRes; apply: boolean }) {
  const excluded = apply && !pm.counted
  return (
    <tr className="bg-paper">
      <td />
      <td className="text-xs text-muted">
        <span className={cn(excluded && 'text-excused line-through')}>{pm.month}월</span>
        {pm.all_excluded && <span className="ml-1 text-excused">전체 제외 · {pm.reasons.join(', ')}</span>}
        {!pm.all_excluded && pm.reasons.length > 0 && <span className="ml-1">· {pm.reasons.join(', ')}</span>}
        {apply && !pm.counted && <span className="ml-1">· 초기화됨</span>}
      </td>
      {ITEMS.map((k) => (
        <td key={k}>
          <CountCell item={k} value={pm.raw[k]} doc={pm.all_excluded ? 0 : pm.doc[k]} excluded={pm.all_excluded || excluded} />
        </td>
      ))}
      <td />
      <td />
    </tr>
  )
}

function TargetTr({ t, picked, onPick, onOpen }: { t: TargetRow; picked: boolean; onPick: (v: boolean) => void; onOpen: () => void }) {
  const counted = t.months.filter((pm) => pm.counted).map((pm) => pm.month)
  return (
    <tr className={picked ? 'bg-[color-mix(in_srgb,var(--accent)_5%,#fff)]' : ''}>
      <td>
        <input type="checkbox" aria-label={`${t.name} 고르기`} checked={picked} onChange={(e) => onPick(e.target.checked)} />
      </td>
      <td className="num text-xs text-muted">{t.student_id}</td>
      <td className="font-medium text-ink-strong">
        <button className="hover:text-accent-ink" onClick={onOpen}>
          {t.name}
        </button>
        <StatusBadge status={t.status} crisis={t.crisis} />
        {t.alerts > 0 && (
          <span
            className="ml-2 inline-flex h-5 items-center gap-1 rounded px-1.5 align-middle text-xs font-medium text-late-ink"
            style={{ background: 'color-mix(in srgb, var(--late) 14%, #fff)' }}
            title={`서류에 없는 내역 ${t.alerts}건${t.became_target ? ' — 이 때문에 대상자가 됨' : ''}`}
          >
            <AlertTriangle size={12} />
            {t.became_target ? '대상자 됨' : `서류 ${t.alerts}`}
          </span>
        )}
      </td>
      <td className="text-xs text-muted num">{counted.length ? monthsLabel(counted) : '–'}</td>
      {ITEMS.map((k) => (
        <td key={k}>
          <CountCell item={k} value={t.totals[k]} />
        </td>
      ))}
      <td className="r num text-base font-medium text-ink-strong">{t.score}</td>
      <td className="r num text-muted">{t.carry ? `${t.carry}회` : '–'}</td>
      <td>
        <StageBadge stage={t.stage} />
      </td>
      <td className="text-sm text-ink">{t.stage.measure || <span className="text-faint">설정에서 입력</span>}</td>
    </tr>
  )
}
