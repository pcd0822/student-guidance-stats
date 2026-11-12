import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, CheckCircle2, Download, FilePlus2, FileText, RefreshCw, Trash2, Undo2, X } from 'lucide-react'
import { useApp } from '@/context'
import { api, download } from '@/lib/api'
import { normalizeId, today } from '@/lib/format'
import type { Dashboard, Meeting, MinutesPayload, MinutesStudent, TargetRow } from '@/lib/types'
import { Card, Empty, Field, Loading, Modal, PageTitle, SaveButton, Spinner, StageBadge, Toggle } from '@/components/ui'

const WEEK = '일월화수목금토'

/** 내용에 맞춰 높이가 늘어나는 글상자(미리보기 칸에서 글자가 잘리지 않게) */
function AutoText({ value, onChange, className = '' }: { value: string; onChange: (v: string) => void; className?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${el.scrollHeight}px`
  }, [value])
  return <textarea ref={ref} rows={1} className={`edit block overflow-hidden ${className}`} value={value} onChange={(e) => onChange(e.target.value)} />
}
const PER_TABLE = 3

type Manual = Partial<Record<'title' | 'agenda' | 'datetime_text' | 'referred_line' | 'basis_date_text' | 'basis_phrase', boolean>>
type Draft = MinutesPayload & { _manual?: Manual }

function koreanDate(iso: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '')
  if (!m) return iso
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEK[d.getDay()]})`
}

/** 서버 fill_auto_texts 와 같은 규칙. 손으로 고친 칸은 그대로 둔다 */
function autoTexts(p: Draft): Draft {
  const man = p._manual || {}
  const dept = p.dept_name || `${p.grade}학년부`
  const cy = p.basis_month >= (p.start_month || 3) ? p.school_year : p.school_year + 1
  const last = new Date(cy, p.basis_month, 0).getDate()
  const out = { ...p }
  if (!man.title) out.title = `${p.school_year} 제${p.seq}차 ${dept} 학생선도 소위원회 회의록`
  if (!man.agenda) out.agenda = `${p.school_year}학년도 ${p.seq}차 ${dept} 학생선도 소위원회 회부 학생에 대한 회의`
  if (!man.datetime_text) out.datetime_text = `${koreanDate(p.date)} ${p.time_range || ''}`.trim()
  if (!man.basis_date_text) out.basis_date_text = `${cy}. ${p.basis_month}. ${last}.`
  if (!man.basis_phrase) out.basis_phrase = `${p.basis_month}월 미인정 결석 누적합 기준 초과`
  if (!man.referred_line) out.referred_line = `${out.basis_phrase}: ${p.students.map((s) => `${s.student_id} ${s.name}`).join(', ')}`
  return out
}

export default function MinutesPage() {
  const { params, year, readonly, toast, confirm, bump, version, go } = useApp()
  const [list, setList] = useState<Meeting[] | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [meeting, setMeeting] = useState<Meeting | null>(null)
  const [picker, setPicker] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    api.get<Meeting[]>('/meetings', { school_year: year }).then(setList).catch((e) => toast(e.message, 'error'))
  }, [year, version, toast])

  const startDraft = async (grade: number, ids: string[], basis?: number) => {
    setLoading(true)
    try {
      const d = await api.post<MinutesPayload>('/meetings/draft', { school_year: year, grade, student_ids: ids, basis_month: basis, opts: { date: today() } })
      setDraft({ ...d, _manual: {} })
      setMeeting(null)
    } catch (e: any) {
      toast(e.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  const openMeeting = async (id: number) => {
    setLoading(true)
    try {
      const m = await api.get<Meeting>(`/meetings/${id}`)
      setMeeting(m)
      setDraft({ _manual: {}, ...(m.payload as Draft) })
    } catch (e: any) {
      toast(e.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (params.draft) startDraft(params.draft.grade, params.draft.student_ids, params.draft.basis_month)
    else if (params.meetingId) openMeeting(params.meetingId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])

  const removeMeeting = async (m: Meeting) => {
    const ok = await confirm({
      title: '회의록을 지울까요',
      body: m.status === 'final' ? '확정한 회의록입니다. 지우면 이 회의록으로 쌓인 생활지도 이력도 함께 지웁니다.' : '초안을 지웁니다.',
      ok: '지우기',
      danger: true,
    })
    if (!ok) return
    try {
      await api.del(`/meetings/${m.id}`)
      bump()
    } catch (e: any) {
      toast(e.message, 'error')
    }
  }

  if (loading)
    return (
      <div className="grid h-64 place-items-center">
        <Spinner />
      </div>
    )

  if (draft)
    return (
      <Editor
        draft={draft}
        setDraft={setDraft}
        meeting={meeting}
        setMeeting={setMeeting}
        onBack={() => {
          setDraft(null)
          setMeeting(null)
          go('minutes')
        }}
      />
    )

  return (
    <div className="flex flex-col gap-6">
      <PageTitle
        icon={FileText}
        title="회의록"
        sub="학생선도 소위원회 회의록을 첨부 양식(hwpx) 그대로 만듭니다"
        right={
          !readonly && (
            <button className="btn btn-primary" onClick={() => setPicker(true)}>
              <FilePlus2 size={16} /> 새 회의록
            </button>
          )
        }
      />
      <Card title={`${year}학년도 회의록`} pad={false}>
        {!list ? (
          <Loading />
        ) : list.length === 0 ? (
          <Empty icon={FileText} title="회의록이 없습니다" sub="대시보드 대상자 명단에서 학생을 체크해 「회의록 만들기」를 누르거나, 위의 「새 회의록」으로 시작하십시오." />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>학년</th>
                <th>회차</th>
                <th>제목</th>
                <th>일시</th>
                <th className="r">학생</th>
                <th>상태</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((m) => (
                <tr key={m.id}>
                  <td>{m.grade}학년</td>
                  <td className="num font-medium text-ink-strong">제{m.seq}차</td>
                  <td>
                    <button className="text-left hover:text-accent-ink" onClick={() => openMeeting(m.id)}>
                      {m.title}
                    </button>
                  </td>
                  <td className="num text-xs text-muted">
                    {m.date} {m.time_range}
                  </td>
                  <td className="r num">{m.student_count}명</td>
                  <td>
                    {m.status === 'final' ? (
                      <span className="inline-flex h-6 items-center gap-1 rounded-md px-2 text-xs font-medium text-accent-ink" style={{ background: 'color-mix(in srgb, var(--accent) 12%, #fff)' }}>
                        <CheckCircle2 size={12} /> 확정
                      </span>
                    ) : (
                      <span className="inline-flex h-6 items-center rounded-md bg-raised px-2 text-xs font-medium text-muted">초안</span>
                    )}
                  </td>
                  <td className="r whitespace-nowrap">
                    <button className="btn btn-ghost btn-sm" onClick={() => openMeeting(m.id)}>
                      열기
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() =>
                        download(`/meetings/${m.id}/hwpx`, 'minutes.hwpx')
                          .then((p) => p && toast(`저장했습니다: ${p}`))
                          .catch((e) => toast(e.message, 'error'))
                      }
                    >
                      <Download size={14} /> hwpx
                    </button>
                    {!readonly && (
                      <button className="btn btn-ghost btn-icon" aria-label="지우기" onClick={() => removeMeeting(m)}>
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
      <StudentPicker
        open={picker}
        onClose={() => setPicker(false)}
        onPick={(g, ids, basis) => {
          setPicker(false)
          startDraft(g, ids, basis)
        }}
      />
    </div>
  )
}

/* ---------------------------------------------------------------- 학생 고르기 */

function StudentPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (grade: number, ids: string[], basis?: number) => void }) {
  const { state, year, toast } = useApp()
  const grades = state!.settings.grades
  const [grade, setGrade] = useState(grades[0] ?? 3)
  const [targets, setTargets] = useState<TargetRow[]>([])
  const [ids, setIds] = useState<string[]>([])
  const [extra, setExtra] = useState('')
  const avail = state!.months_by_grade[String(grade)] || []

  useEffect(() => {
    if (!open) return
    api
      .get<Dashboard>('/dashboard', { grade, lookup_months: '0', school_year: year })
      .then((d) => {
        setTargets(d.targets)
        setIds([])
      })
      .catch((e) => toast(e.message, 'error'))
  }, [open, grade, year, toast])

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="회의록에 넣을 학생"
      width={640}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            취소
          </button>
          <button className="btn btn-primary" disabled={!ids.length} onClick={() => onPick(grade, ids, avail[avail.length - 1])}>
            {ids.length}명으로 시작
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <span className="label">학년</span>
          <select className="field field-sm" value={grade} onChange={(e) => setGrade(Number(e.target.value))}>
            {grades.map((g) => (
              <option key={g} value={g}>
                {g}학년
              </option>
            ))}
          </select>
          <span className="text-xs text-muted">자료가 있는 모든 달 기준 대상자입니다</span>
        </div>
        {targets.length === 0 ? (
          <p className="text-sm text-muted">대상자가 없습니다. 아래에 학번을 직접 넣을 수 있습니다.</p>
        ) : (
          <ul className="flex max-h-72 flex-col divide-y divide-line overflow-auto rounded-lg border border-line">
            {targets.map((t) => (
              <li key={t.student_id}>
                <label className="flex items-center gap-3 px-3 py-2 text-sm">
                  <input type="checkbox" checked={ids.includes(t.student_id)} onChange={(e) => setIds(e.target.checked ? [...ids, t.student_id] : ids.filter((x) => x !== t.student_id))} />
                  <span className="num text-xs text-muted">{t.student_id}</span>
                  <span className="font-medium text-ink-strong">{t.name}</span>
                  <span className="num text-muted">{t.score}점</span>
                  <StageBadge stage={t.stage} />
                </label>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-end gap-2">
          <Field label="학번으로 추가">
            <input className="field w-32 num" value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="30622" />
          </Field>
          <button
            className="btn btn-secondary"
            onClick={() => {
              const s = normalizeId(extra)
              if (s && !ids.includes(s)) setIds([...ids, s])
              setExtra('')
            }}
          >
            추가
          </button>
          {ids.filter((x) => !targets.some((t) => t.student_id === x)).map((x) => (
            <span key={x} className="num inline-flex h-7 items-center gap-1 rounded-md bg-raised px-2 text-xs">
              {x}
              <button aria-label="빼기" onClick={() => setIds(ids.filter((y) => y !== x))}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      </div>
    </Modal>
  )
}

/* ---------------------------------------------------------------- 편집기 + 미리보기 */

function Editor({
  draft,
  setDraft,
  meeting,
  setMeeting,
  onBack,
}: {
  draft: Draft
  setDraft: (d: Draft) => void
  meeting: Meeting | null
  setMeeting: (m: Meeting | null) => void
  onBack: () => void
}) {
  const { state, readonly, toast, confirm, bump } = useApp()
  const final = meeting?.status === 'final'
  const locked = readonly || final
  const p = draft
  const avail = state!.months_by_grade[String(p.grade)] || []
  const [busy, setBusy] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [addId, setAddId] = useState('')
  const [dirty, setDirty] = useState(!meeting)

  const update = (patch: Partial<Draft>, manualKey?: keyof Manual) => {
    const man = { ...(p._manual || {}) }
    if (manualKey) man[manualKey] = true
    setDraft(autoTexts({ ...p, ...patch, _manual: man }))
    setDirty(true)
  }
  const setStudent = (i: number, patch: Partial<MinutesStudent>) => update({ students: p.students.map((s, j) => (j === i ? { ...s, ...patch } : s)) })

  const crisisCount = p.students.filter((s) => s.kind === 'crisis').length
  const guideCount = p.students.length - crisisCount

  const recompute = async (patch: Partial<Draft> = {}) => {
    const next = { ...p, ...patch }
    setBusy(true)
    try {
      const blocks = await Promise.all(
        next.students.map((s) =>
          api.post<MinutesStudent>('/meetings/student-block', {
            school_year: next.school_year,
            grade: next.grade,
            student_id: s.student_id,
            basis_month: next.basis_month,
            include_year_total: next.include_year_total,
          })
        )
      )
      update({ ...patch, students: blocks.map((b, i) => ({ ...b, kind: next.students[i].kind })) })
      toast('기록에서 다시 계산했습니다')
    } catch (e: any) {
      toast(e.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const addStudent = async () => {
    const sid = normalizeId(addId)
    if (!sid || p.students.some((s) => s.student_id === sid)) return
    try {
      const b = await api.post<MinutesStudent>('/meetings/student-block', { school_year: p.school_year, grade: p.grade, student_id: sid, basis_month: p.basis_month, include_year_total: p.include_year_total })
      update({ students: [...p.students, b] })
      setAddId('')
    } catch (e: any) {
      toast(e.message, 'error')
    }
  }

  const save = async (): Promise<Meeting | null> => {
    setBusy(true)
    try {
      const m = meeting ? await api.put<Meeting>(`/meetings/${meeting.id}`, p) : await api.post<Meeting>('/meetings', p)
      setMeeting(m)
      setDirty(false)
      setSavedAt(Date.now())
      bump()
      return m
    } catch (e: any) {
      toast(e.message, 'error')
      return null
    } finally {
      setBusy(false)
    }
  }

  const downloadHwpx = async () => {
    const m = final || !dirty ? meeting : await save()
    if (!m) return
    try {
      const path = await download(`/meetings/${m.id}/hwpx`, 'minutes.hwpx')
      if (path) toast(`저장했습니다: ${path}`)
    } catch (e: any) {
      toast(e.message, 'error')
    }
  }

  const finalize = async () => {
    const guide = p.students.filter((s) => s.kind === 'guidance')
    const ok = await confirm({
      title: '회의록을 확정할까요',
      body: (
        <div className="flex flex-col gap-2">
          <p>
            생활지도 실시 학생 {guide.length}명({guide.map((s) => s.name).join(', ') || '없음'})에게 생활지도 이력을 기록합니다.
          </p>
          <p>
            이 학생들은 <span className="font-semibold text-ink-strong">{p.guidance_month}월까지</span>의 기록이 누적에서 빠지고 다음 차수로 넘어갑니다. 위기관리학생은 기록하지 않습니다.
          </p>
          <p className="text-muted">확정한 뒤에는 「확정 취소」로만 고칠 수 있습니다.</p>
        </div>
      ),
      ok: '확정',
    })
    if (!ok) return
    const m = dirty || !meeting ? await save() : meeting
    if (!m) return
    try {
      const r = await api.post<{ meeting: Meeting; guidance_added: number }>(`/meetings/${m.id}/finalize`)
      setMeeting(r.meeting)
      toast(`확정했습니다 · 생활지도 이력 ${r.guidance_added}건 기록`)
      bump()
    } catch (e: any) {
      toast(e.message, 'error')
    }
  }

  const unfinalize = async () => {
    if (!meeting) return
    const ok = await confirm({ title: '확정을 취소할까요', body: '이 회의록으로 쌓인 생활지도 이력을 지우고 초안으로 되돌립니다.', ok: '확정 취소', danger: true })
    if (!ok) return
    try {
      setMeeting(await api.post<Meeting>(`/meetings/${meeting.id}/unfinalize`))
      bump()
      toast('초안으로 되돌렸습니다')
    } catch (e: any) {
      toast(e.message, 'error')
    }
  }

  const chunks = useMemo(() => {
    const out: MinutesStudent[][] = []
    for (let i = 0; i < p.students.length; i += PER_TABLE) out.push(p.students.slice(i, i + PER_TABLE))
    return out
  }, [p.students])

  return (
    <div className="flex flex-col gap-6">
      <PageTitle
        icon={FileText}
        title={p.title}
        sub={final ? '확정한 회의록입니다. 고치려면 「확정 취소」를 누르십시오' : dirty ? '저장하지 않은 변경이 있습니다' : '초안으로 저장했습니다'}
        right={
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-ghost" onClick={onBack}>
              <ArrowLeft size={16} /> 목록
            </button>
            {!locked && (
              <SaveButton dirty={dirty} saving={busy} savedAt={savedAt} onClick={save} label="초안 저장" className="btn btn-secondary" />
            )}
            <button className="btn btn-secondary" onClick={downloadHwpx} disabled={busy || (readonly && !meeting)}>
              <Download size={16} /> hwpx 내려받기
            </button>
            {!readonly && (final ? (
              <button className="btn btn-danger" onClick={unfinalize}>
                <Undo2 size={16} /> 확정 취소
              </button>
            ) : (
              <button className="btn btn-primary" onClick={finalize} disabled={busy || !p.students.length}>
                <CheckCircle2 size={16} /> 확정
              </button>
            ))}
          </div>
        }
      />

      <Card title="입력" right={busy && <Spinner />}>
        <fieldset disabled={locked} className="flex flex-col gap-5">
          <div className="grid grid-cols-4 gap-4">
            <Field label="학년도 · 학년">
              <input className="field num" value={`${p.school_year}학년도 ${p.grade}학년`} readOnly />
            </Field>
            <Field label="회차">
              <input type="number" min={1} className="field num" value={p.seq} onChange={(e) => update({ seq: Number(e.target.value) || 1 })} />
            </Field>
            <Field label="날짜">
              <input type="date" className="field num" value={p.date} onChange={(e) => update({ date: e.target.value })} />
            </Field>
            <Field label="시간">
              <input className="field num" value={p.time_range} placeholder="12:00~12:20" onChange={(e) => update({ time_range: e.target.value })} />
            </Field>
            <Field label="장소">
              <input className="field" value={p.place} onChange={(e) => update({ place: e.target.value })} />
            </Field>
            <Field label="위원장">
              <input className="field" value={p.chair} onChange={(e) => update({ chair: e.target.value })} />
            </Field>
            <Field label="위원" className="col-span-2">
              <input className="field" value={p.members} onChange={(e) => update({ members: e.target.value })} />
            </Field>
            <Field label="기준 월" hint="표2·총합은 학생마다 마지막 생활지도 다음 달 ~ 기준 월">
              <select className="field" value={p.basis_month} onChange={(e) => recompute({ basis_month: Number(e.target.value), guidance_month: Number(e.target.value) })}>
                {avail.map((m) => (
                  <option key={m} value={m}>
                    {m}월
                  </option>
                ))}
              </select>
            </Field>
            <Field label="기준일">
              <input className="field num" value={p.basis_date_text} onChange={(e) => update({ basis_date_text: e.target.value }, 'basis_date_text')} />
            </Field>
            <Field label="기준 문구" className="col-span-2">
              <input className="field" value={p.basis_phrase} onChange={(e) => update({ basis_phrase: e.target.value }, 'basis_phrase')} />
            </Field>
            <Field label="생활지도 실시 월" hint="확정하면 이 달까지 누적을 초기화합니다">
              <select className="field" value={p.guidance_month} onChange={(e) => update({ guidance_month: Number(e.target.value) })}>
                {Array.from({ length: 12 }, (_, i) => ((p.start_month - 1 + i) % 12) + 1).map((m) => (
                  <option key={m} value={m}>
                    {m}월
                  </option>
                ))}
              </select>
            </Field>
            <Field label="위기관리학생 지도 방안" className="col-span-2">
              <input className="field" value={p.crisis_text} onChange={(e) => update({ crisis_text: e.target.value })} />
            </Field>
            <div className="flex items-end pb-2">
              <Toggle checked={p.include_year_total} onChange={(v) => recompute({ include_year_total: v })} label="학년도 전체 누적 함께 적기" disabled={locked} />
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="label">
                회부 학생 {p.students.length}명 · 생활지도 실시 {guideCount}명 · 위기관리학생 {crisisCount}명
              </p>
              <div className="flex items-center gap-2">
                <input className="field field-sm w-28 num" placeholder="학번 추가" value={addId} onChange={(e) => setAddId(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addStudent()} />
                <button type="button" className="btn btn-secondary btn-sm" onClick={addStudent}>
                  추가
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => recompute()} title="손으로 고친 표2·총합·생활지도 내역을 기록에서 다시 만듭니다">
                  <RefreshCw size={14} /> 기록에서 다시 계산
                </button>
              </div>
            </div>
            <table className="tbl rounded-lg border border-line">
              <thead>
                <tr>
                  <th>학번</th>
                  <th>이름</th>
                  <th>지도 구분</th>
                  <th>이번 차수</th>
                  <th>생활지도 내역</th>
                  <th className="r">환산</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {p.students.map((s, i) => (
                  <tr key={s.student_id}>
                    <td className="num text-xs text-muted">{s.student_id}</td>
                    <td className="font-medium text-ink-strong">{s.name}</td>
                    <td>
                      <select className="field field-sm" value={s.kind} onChange={(e) => {
                        const kind = e.target.value as MinutesStudent['kind']
                        const students = p.students.map((x, j) => (j === i ? { ...x, kind } : x))
                        const anyCrisis = students.some((x) => x.kind === 'crisis')
                        const defaults = ['생활지도 진행하지 않음', '해당 학생 없음']
                        update({ students, crisis_text: defaults.includes(p.crisis_text) ? (anyCrisis ? defaults[0] : defaults[1]) : p.crisis_text })
                      }}>
                        <option value="guidance">생활지도 실시</option>
                        <option value="crisis">위기관리학생(생활지도 미실시)</option>
                      </select>
                    </td>
                    <td>
                      <StageBadge stage={{ final: s.stage_final, index: s.step - 1, label: s.stage_short }} />
                    </td>
                    <td>
                      <input className="field field-sm w-full" value={s.measure_text} disabled={s.kind === 'crisis'} onChange={(e) => setStudent(i, { measure_text: e.target.value })} />
                    </td>
                    <td className="r num">{s.score}점</td>
                    <td className="r">
                      <button type="button" className="btn btn-ghost btn-icon" aria-label="빼기" onClick={() => update({ students: p.students.filter((_, j) => j !== i) })}>
                        <X size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </fieldset>
      </Card>

      <div className="overflow-auto">
        <p className="label mb-2">미리보기 — 글자를 눌러 바로 고칠 수 있습니다</p>
        <div className="paper-a4 mx-auto">
          <fieldset disabled={locked}>
            <input className="edit mb-6 text-center text-[20px] font-semibold leading-8" value={p.title} onChange={(e) => update({ title: e.target.value }, 'title')} />
            <table>
              <colgroup>
                <col style={{ width: '13.6%' }} />
                <col style={{ width: '9.1%' }} />
                <col />
              </colgroup>
              <tbody>
                <tr>
                  <td className="text-center" style={{ background: '#f2f2f2' }}>일시</td>
                  <td colSpan={2}>
                    <input className="edit" value={p.datetime_text} onChange={(e) => update({ datetime_text: e.target.value }, 'datetime_text')} />
                  </td>
                </tr>
                <tr>
                  <td className="text-center" style={{ background: '#f2f2f2' }}>장소</td>
                  <td colSpan={2}>
                    <input className="edit" value={p.place} onChange={(e) => update({ place: e.target.value })} />
                  </td>
                </tr>
                <tr>
                  <td rowSpan={2} className="text-center" style={{ background: '#f2f2f2' }}>
                    참석자
                  </td>
                  <td className="text-center">위원장</td>
                  <td>
                    <input className="edit" value={p.chair} onChange={(e) => update({ chair: e.target.value })} />
                  </td>
                </tr>
                <tr>
                  <td className="text-center">위원</td>
                  <td>
                    <input className="edit" value={p.members} onChange={(e) => update({ members: e.target.value })} />
                  </td>
                </tr>
                <tr>
                  <td className="text-center" style={{ background: '#f2f2f2' }}>심의 안건</td>
                  <td colSpan={2}>
                    <input className="edit" value={p.agenda} onChange={(e) => update({ agenda: e.target.value }, 'agenda')} />
                  </td>
                </tr>
                <tr>
                  <td colSpan={3} className="text-center" style={{ background: '#f2f2f2' }}>
                    심의 내용
                  </td>
                </tr>
                <tr>
                  <td colSpan={3} className="align-top" style={{ padding: '8px 10px 16px' }}>
                    <p>[안건1: {p.agenda}]</p>
                    <p>1. 학생선도 소위원회 회부 학생</p>
                    <p className="flex gap-1 pl-3">
                      <span className="shrink-0">1)</span>
                      <AutoText value={p.referred_line} onChange={(v) => update({ referred_line: v }, 'referred_line')} />
                    </p>
                    <p>2. 학생선도 소위원회 회부 학생 위반 사항({p.basis_date_text} 기준)</p>
                    {p.students.length === 0 && <p className="pl-3">해당 학생 없음</p>}
                    {chunks.map((chunk, ci) => (
                      <MonthTable key={ci} chunk={chunk} offset={ci * PER_TABLE} p={p} onCell={(i, patch) => setStudent(i, patch)} />
                    ))}
                    <p className="mt-4">3. 회부학생 지도 방안</p>
                    <p className="flex gap-1 pl-3">
                      <span className="shrink-0">1) 위기관리학생에 대한 생활지도 방안:</span>
                      <input className="edit" value={p.crisis_text} onChange={(e) => update({ crisis_text: e.target.value })} />
                    </p>
                    <p className="pl-3">2) {p.dept_name} 생활지도 운영 계획에 따른 생활지도 대상자</p>
                    {guideCount === 0 ? (
                      <p className="pl-6">해당 학생 없음</p>
                    ) : (
                      <table className="ml-6 mt-1" style={{ width: 'calc(100% - 24px)' }}>
                        <colgroup>
                          <col style={{ width: '19.7%' }} />
                          <col style={{ width: '19.7%' }} />
                          <col />
                        </colgroup>
                        <tbody>
                          <tr>
                            {['학번', '이름', '생활지도 내역'].map((h) => (
                              <td key={h} className="text-center" style={{ background: '#f2f2f2' }}>
                                {h}
                              </td>
                            ))}
                          </tr>
                          {p.students.map((s, i) =>
                            s.kind === 'guidance' ? (
                              <tr key={s.student_id}>
                                <td className="text-center num">{s.student_id}</td>
                                <td className="text-center">{s.name}</td>
                                <td>
                                  <input className="edit text-center" value={s.measure_text} onChange={(e) => setStudent(i, { measure_text: e.target.value })} />
                                </td>
                              </tr>
                            ) : null
                          )}
                        </tbody>
                      </table>
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </fieldset>
        </div>
      </div>
    </div>
  )
}

function MonthTable({ chunk, offset, p, onCell }: { chunk: MinutesStudent[]; offset: number; p: Draft; onCell: (i: number, patch: Partial<MinutesStudent>) => void }) {
  const start = p.start_month || 3
  const months = Array.from(new Set(chunk.flatMap((s) => s.months.map((m) => m.month)))).sort((a, b) => ((a - start + 12) % 12) - ((b - start + 12) % 12))
  const setMonth = (si: number, month: number, key: 'abs' | 'others', v: string) => {
    const s = chunk[si]
    onCell(offset + si, { months: s.months.map((m) => (m.month === month ? { ...m, [key]: v } : m)) })
  }
  return (
    <table className="my-2">
      <colgroup>
        <col style={{ width: '15%' }} />
        <col style={{ width: '23.5%' }} />
        {chunk.map((s) => (
          <col key={s.student_id} />
        ))}
      </colgroup>
      <tbody>
        <tr>
          <td colSpan={2} className="text-center" style={{ background: '#f2f2f2' }}>
            월별 미인정 내역
          </td>
          {chunk.map((s) => (
            <td key={s.student_id} className="text-center" style={{ background: '#f2f2f2' }}>
              {s.student_id} {s.name}
              {s.kind === 'crisis' && <span className="no-print ml-1 text-xs text-muted">(위기관리)</span>}
            </td>
          ))}
        </tr>
        {months.map((m) => (
          <MonthRows key={m} m={m} chunk={chunk} setMonth={setMonth} />
        ))}
        <tr>
          <td colSpan={2} className="text-center">
            총합
          </td>
          {chunk.map((s, si) => (
            <td key={s.student_id} className="text-center">
              <AutoText className="text-center" value={s.total_lines.join('\n')} onChange={(v) => onCell(offset + si, { total_lines: v.split('\n') })} />
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  )
}

function MonthRows({ m, chunk, setMonth }: { m: number; chunk: MinutesStudent[]; setMonth: (si: number, month: number, key: 'abs' | 'others', v: string) => void }) {
  const cell = (si: number, key: 'abs' | 'others') => {
    const x = chunk[si].months.find((mm) => mm.month === m)
    if (!x) return <span className="text-center">{key === 'abs' ? '-' : '- / - / -'}</span>
    return <AutoText className="text-center" value={x[key]} onChange={(v) => setMonth(si, m, key, v)} />
  }
  return (
    <>
      <tr>
        <td rowSpan={2} className="text-center">
          {m}월
        </td>
        <td className="text-center">결석</td>
        {chunk.map((s, si) => (
          <td key={s.student_id} className="text-center">
            {cell(si, 'abs')}
          </td>
        ))}
      </tr>
      <tr>
        <td className="text-center">지각/조퇴/결과</td>
        {chunk.map((s, si) => (
          <td key={s.student_id} className="text-center">
            {cell(si, 'others')}
          </td>
        ))}
      </tr>
    </>
  )
}
