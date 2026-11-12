import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ClipboardPaste, Contact, Plus, Search, Trash2 } from 'lucide-react'
import { useApp } from '@/context'
import { api } from '@/lib/api'
import { cn, normalizeId } from '@/lib/format'
import type { RosterStudent } from '@/lib/types'
import { Card, Empty, Field, Loading, Modal, PageTitle, SaveButton, StatusBadge, Toggle } from '@/components/ui'

interface RosterRes {
  students: RosterStudent[]
  statuses: string[]
  leaving: string[]
}

interface Form {
  student_id: string
  name: string
  status: string
  status_date: string
  crisis: boolean
  note: string
  apply_exclusion: boolean
}

const blank: Form = { student_id: '', name: '', status: '재학', status_date: '', crisis: false, note: '', apply_exclusion: false }

export default function Students() {
  const { state, year, readonly, toast, confirm, bump, go, version } = useApp()
  const grades = state!.settings.grades
  const [grade, setGrade] = useState<number>(grades[0] ?? 3)
  const [data, setData] = useState<RosterRes | null>(null)
  const [cls, setCls] = useState<number>(0)
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [edit, setEdit] = useState<{ form: Form; base: string; isNew: boolean; source?: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [paste, setPaste] = useState<string | null>(null)

  useEffect(() => {
    setData(null)
    api
      .get<RosterRes>('/roster', { school_year: year, grade })
      .then(setData)
      .catch((e) => toast(e.message, 'error'))
  }, [year, grade, version, toast])

  const classes = useMemo(() => Array.from(new Set((data?.students || []).map((s) => s.class))).sort((a, b) => a - b), [data])
  const rows = useMemo(() => {
    let r = data?.students || []
    if (cls) r = r.filter((s) => s.class === cls)
    if (statusFilter === '특이') r = r.filter((s) => s.status !== '재학' || s.crisis)
    else if (statusFilter) r = r.filter((s) => s.status === statusFilter)
    const t = q.trim()
    if (t) r = r.filter((s) => s.student_id.includes(t) || (s.name || '').includes(t))
    return r
  }, [data, cls, q, statusFilter])
  const special = (data?.students || []).filter((s) => s.status !== '재학' || s.crisis).length

  const open = (s?: RosterStudent) => {
    const form: Form = s
      ? { student_id: s.student_id, name: s.name || '', status: s.status, status_date: s.status_date || '', crisis: s.crisis, note: s.note || '', apply_exclusion: false }
      : { ...blank, student_id: '' }
    setEdit({ form, base: JSON.stringify(form), isNew: !s, source: s?.source })
    setSavedAt(null)
  }
  const dirty = !!edit && JSON.stringify(edit.form) !== edit.base
  const leaving = !!edit && (data?.leaving || []).includes(edit.form.status)

  const save = async () => {
    if (!edit) return
    setSaving(true)
    try {
      const body = { ...edit.form, student_id: normalizeId(edit.form.student_id), school_year: year, status_date: edit.form.status_date || null }
      const r = edit.isNew
        ? await api.post<{ exclusion: any }>('/roster', body)
        : await api.put<{ exclusion: any }>(`/roster/${body.student_id}`, body)
      const f = { ...edit.form, student_id: body.student_id, apply_exclusion: false }
      setEdit({ ...edit, form: f, base: JSON.stringify(f), isNew: false })
      setSavedAt(Date.now())
      toast(r.exclusion ? `학적 정보를 저장하고 제외 처리에도 등록했습니다` : '학적 정보를 저장했습니다')
      bump()
    } catch (e: any) {
      toast(e.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!edit) return
    const ok = await confirm({ title: '명단에서 지울까요', body: `${edit.form.student_id} ${edit.form.name} 학생을 직접 추가한 명단에서 지웁니다.`, ok: '지우기', danger: true })
    if (!ok) return
    try {
      await api.del(`/roster/${edit.form.student_id}?school_year=${year}`)
      setEdit(null)
      bump()
    } catch (e: any) {
      toast(e.message, 'error')
    }
  }

  const doPaste = async () => {
    if (paste === null) return
    setSaving(true)
    try {
      const r = await api.post<{ added: number; updated: number; skipped: number; errors: string[] }>('/roster/import', { text: paste, school_year: year })
      toast(`새로 ${r.added}명 · 고침 ${r.updated}명${r.skipped ? ` · 건너뜀 ${r.skipped}줄` : ''}${r.errors.length ? ` · 오류 ${r.errors.length}줄` : ''}`, r.errors.length ? 'warn' : 'ok')
      if (r.errors.length) toast(r.errors.slice(0, 3).join(' / '), 'error')
      else setPaste(null)
      bump()
    } catch (e: any) {
      toast(e.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const set = (patch: Partial<Form>) => edit && setEdit({ ...edit, form: { ...edit.form, ...patch } })

  return (
    <div className="flex flex-col gap-6">
      <PageTitle
        icon={Contact}
        title="학생 관리"
        sub="올린 나이스 자료로 명단을 만들고, 학적 상태·위기관리학생·비고를 적습니다"
        right={
          !readonly && (
            <div className="flex gap-2">
              <button className="btn btn-secondary" onClick={() => setPaste('')}>
                <ClipboardPaste size={16} /> 붙여넣기 등록
              </button>
              <button className="btn btn-primary" onClick={() => open()}>
                <Plus size={16} /> 직접 추가
              </button>
            </div>
          )
        }
      />

      <Card
        pad={false}
        title={
          <span className="flex items-center gap-3">
            {grade}학년 명단
            {data && <span className="num text-sm font-medium text-muted">{data.students.length}명 · 특이 {special}명</span>}
          </span>
        }
        right={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-line bg-surface p-0.5" role="tablist" aria-label="학년">
              {grades.map((g) => (
                <button
                  key={g}
                  role="tab"
                  aria-selected={g === grade}
                  onClick={() => {
                    setGrade(g)
                    setCls(0)
                  }}
                  className={cn('h-7 rounded-md px-3 text-sm font-medium transition-colors duration-150', g === grade ? 'bg-raised text-ink-strong' : 'text-muted hover:text-ink-strong')}
                >
                  {g}학년
                </button>
              ))}
            </div>
            <select className="field field-sm" value={cls} onChange={(e) => setCls(Number(e.target.value))} aria-label="반">
              <option value={0}>전체 반</option>
              {classes.map((c) => (
                <option key={c} value={c}>
                  {c}반
                </option>
              ))}
            </select>
            <select className="field field-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="학적">
              <option value="">모든 학적</option>
              <option value="특이">재학 아님·위기관리만</option>
              {(data?.statuses || []).map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-2 top-[7px] text-faint" />
              <input className="field field-sm w-40 pl-7" placeholder="학번·이름" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </div>
        }
      >
        {!data ? (
          <Loading />
        ) : data.students.length === 0 ? (
          <Empty icon={Contact} title={`${grade}학년 명단이 없습니다`} sub="자료 올리기에서 나이스 파일을 올리면 명단이 자동으로 만들어집니다. 전입생처럼 자료에 없는 학생은 「직접 추가」로 넣으십시오." />
        ) : (
          <div className="max-h-[640px] overflow-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>학번</th>
                  <th>반</th>
                  <th>번호</th>
                  <th>이름</th>
                  <th>학적</th>
                  <th>변동일</th>
                  <th className="r">누적</th>
                  <th className="r">생활지도</th>
                  <th>제외·알림</th>
                  <th>비고</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.student_id} className="cursor-pointer" onClick={() => open(s)}>
                    <td className="num text-xs text-muted">{s.student_id}</td>
                    <td className="num">{s.class}</td>
                    <td className="num">{s.number}</td>
                    <td className="font-medium text-ink-strong">
                      {s.name}
                      {s.source === 'manual' && <span className="ml-1 text-xs text-muted">(직접 추가)</span>}
                    </td>
                    <td>
                      {s.status === '재학' ? <span className="text-muted">재학</span> : <StatusBadge status={s.status} />}
                      <StatusBadge crisis={s.crisis} />
                    </td>
                    <td className="num text-xs text-muted">{s.status_date || '–'}</td>
                    <td className={cn('r num', s.is_target ? 'font-medium text-absent' : 'text-ink-strong')}>
                      {s.score === null ? <span className="text-faint">자료 없음</span> : `${s.score}점`}
                    </td>
                    <td className="r num">{s.guidance_count ? `${s.guidance_count}회` : <span className="text-faint">–</span>}</td>
                    <td className="text-xs">
                      {s.has_exclusion && <span className="mr-2 text-accent-ink">제외 등록</span>}
                      {s.alerts > 0 && (
                        <span className="inline-flex items-center gap-1 text-late-ink">
                          <AlertTriangle size={12} /> 알림 {s.alerts}
                        </span>
                      )}
                    </td>
                    <td className="max-w-[200px] truncate text-xs text-muted" title={s.note || ''}>
                      {s.note}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={10} className="py-8 text-center text-sm text-muted">
                      조건에 맞는 학생이 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.isNew ? '학생 직접 추가' : `${edit?.form.student_id} ${edit?.form.name} 학적 정보`}
        width={600}
        footer={
          <>
            {edit && !edit.isNew && edit.source === 'manual' && !readonly && (
              <button className="btn btn-danger mr-auto" onClick={remove}>
                <Trash2 size={16} /> 명단에서 지우기
              </button>
            )}
            {edit && !edit.isNew && (
              <button className="btn btn-ghost" onClick={() => go('personal', { sid: edit.form.student_id })}>
                개인별 통계 보기
              </button>
            )}
            <button className="btn btn-secondary" onClick={() => setEdit(null)}>
              닫기
            </button>
            <SaveButton
              dirty={dirty || !!edit?.isNew}
              saving={saving}
              savedAt={savedAt}
              onClick={save}
              disabled={readonly || !edit?.form.student_id || (edit?.isNew && !edit.form.name.trim()) || (edit?.form.apply_exclusion && !edit.form.status_date)}
            />
          </>
        }
      >
        {edit && (
          <fieldset disabled={readonly} className="grid grid-cols-2 gap-4">
            <Field label="학번">
              <input className="field num" value={edit.form.student_id} disabled={!edit.isNew} onChange={(e) => set({ student_id: e.target.value })} placeholder="30315" autoFocus={edit.isNew} />
            </Field>
            <Field label="이름" hint={!edit.isNew && edit.source === 'upload' ? '나이스 자료의 이름입니다. 다음 업로드 때 다시 맞춰집니다' : undefined}>
              <input className="field" value={edit.form.name} onChange={(e) => set({ name: e.target.value })} />
            </Field>
            <Field label="학적 상태">
              <select className="field" value={edit.form.status} onChange={(e) => set({ status: e.target.value, apply_exclusion: false })}>
                {(data?.statuses || ['재학']).map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="변동일">
              <input type="date" className="field num" value={edit.form.status_date} onChange={(e) => set({ status_date: e.target.value })} />
            </Field>
            <div className="col-span-2 flex flex-col gap-3">
              <Toggle checked={edit.form.crisis} onChange={(v) => set({ crisis: v })} label="위기관리학생 — 회의록을 만들 때 지도 구분을 「위기관리학생」으로 자동 선택합니다" />
              {leaving && (
                <label className="flex items-start gap-2 rounded-lg bg-raised px-3 py-2 text-sm">
                  <input type="checkbox" className="mt-0.5" checked={edit.form.apply_exclusion} onChange={(e) => set({ apply_exclusion: e.target.checked })} />
                  <span>
                    제외 처리에도 등록 — 변동일이 속한 달부터 학년도 끝까지 「그 달 전체 제외」(사유: {edit.form.status}). 아직 자료가 없는 달도 미리 막습니다.
                    {edit.form.apply_exclusion && !edit.form.status_date && <span className="block text-absent">변동일을 입력하십시오</span>}
                  </span>
                </label>
              )}
            </div>
            <Field label="비고" className="col-span-2" hint="학생 개인정보입니다. 업무에 꼭 필요한 내용만 적으십시오">
              <textarea className="field h-20" value={edit.form.note} onChange={(e) => set({ note: e.target.value })} />
            </Field>
          </fieldset>
        )}
      </Modal>

      <Modal
        open={paste !== null}
        onClose={() => setPaste(null)}
        title="붙여넣기로 학적 정보 등록"
        width={680}
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setPaste(null)}>
              닫기
            </button>
            <button className="btn btn-primary" onClick={doPaste} disabled={saving || !paste?.trim()}>
              등록
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm text-ink">엑셀에서 아래 순서의 열을 복사해 붙여 넣으십시오. 뒤쪽 열은 비워도 됩니다.</p>
          <p className="rounded-lg bg-raised px-3 py-2 text-xs text-ink">
            학번 · 이름 · 학적 상태({(data?.statuses || []).join('/')}) · 변동일(2026-10-15) · 위기관리(O) · 비고
          </p>
          <textarea className="field num h-56 font-mono text-xs" value={paste || ''} onChange={(e) => setPaste(e.target.value)} placeholder={'30315\t전입생\t재학\n30207\t홍길동\t전출\t2026-11-03\n30110\t김철수\t재학\t\tO'} />
          <p className="text-xs text-muted">명단에 있는 학생은 붙여 넣은 칸만 고치고, 없는 학생은 새로 추가합니다. 머리행처럼 학번이 없는 줄은 건너뜁니다.</p>
        </div>
      </Modal>
    </div>
  )
}
