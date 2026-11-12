import { useEffect, useMemo, useState } from 'react'
import { ClipboardPaste, History, Pencil, Plus, Trash2 } from 'lucide-react'
import { useApp } from '@/context'
import { api } from '@/lib/api'
import { normalizeId, today } from '@/lib/format'
import { schoolMonths } from '@/lib/months'
import type { Guidance } from '@/lib/types'
import { Card, Empty, Field, Loading, Modal, PageTitle, SaveButton, StageBadge } from '@/components/ui'

interface Form {
  id?: number
  student_id: string
  name: string
  step: number | ''
  month: number | ''
  date: string
  measure: string
  note: string
}

export default function GuidancePage() {
  const { state, year, readonly, toast, confirm, bump, go, version } = useApp()
  const rules = state!.settings.rules
  const [list, setList] = useState<Guidance[] | null>(null)
  const [grade, setGrade] = useState<number | 0>(0)
  const [form, setForm] = useState<Form | null>(null)
  const [formBase, setFormBase] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const openForm = (f: Form) => {
    setForm(f)
    setFormBase(JSON.stringify(f))
    setSavedAt(null)
  }
  const formDirty = !!form && (!form.id || JSON.stringify(form) !== formBase)
  const [paste, setPaste] = useState<{ kind: 'guidance' | 'exclusion'; text: string } | null>(null)

  useEffect(() => {
    api.get<Guidance[]>('/guidance', { school_year: year }).then(setList).catch((e) => toast(e.message, 'error'))
  }, [year, version, toast])

  const shown = useMemo(() => (!list ? [] : grade ? list.filter((g) => g.grade === grade) : list), [list, grade])
  const byStudent = useMemo(() => {
    const m = new Map<string, Guidance[]>()
    for (const g of shown) m.set(g.student_id, [...(m.get(g.student_id) || []), g])
    return [...m.entries()]
  }, [shown])

  const stageOf = (step: number) => {
    const n = rules.stages.count
    return step > n
      ? { final: true, index: n, label: rules.stages.final_name }
      : { final: false, index: step - 1, label: `${step}차` }
  }
  const measureFor = (sid: string, step: number) => {
    const key = step > rules.stages.count ? 'final' : String(step)
    const m = rules.measures[sid.slice(0, 1)]?.[key] || ''
    return m ? `(${step > rules.stages.count ? rules.stages.final_name : `${step}차`}) ${m}` : ''
  }

  const lookup = async (raw: string) => {
    const sid = normalizeId(raw)
    if (!sid || !form) return
    const count = (list || []).filter((g) => g.student_id === sid).length
    let name = form.name
    try {
      name = (await api.get<{ name: string }>(`/students/${sid}`, { school_year: year })).name
    } catch {
      /* 자료에 없는 학번 */
    }
    setForm((f) => (f ? { ...f, student_id: sid, name, step: f.id ? f.step : count + 1, measure: f.measure || measureFor(sid, count + 1) } : f))
  }

  const save = async () => {
    if (!form) return
    setSaving(true)
    try {
      const body = { ...form, school_year: year, step: form.step || undefined, month: form.month || null }
      if (form.id) {
        await api.put(`/guidance/${form.id}`, body)
        setFormBase(JSON.stringify(form))
        setSavedAt(Date.now())
        toast(`${form.student_id} ${form.name} 생활지도 기록을 고쳤습니다`)
      } else {
        await api.post('/guidance', body)
        toast(`${form.student_id} ${form.name} 생활지도 기록을 추가했습니다`)
        setForm(null)
      }
      bump()
    } catch (e: any) {
      toast(e.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (g: Guidance) => {
    const ok = await confirm({
      title: '생활지도 기록을 지울까요',
      body: `${g.student_id} ${g.name} · ${g.step}차 · ${g.month ?? '?'}월. 지우면 누적 초기화와 차수가 다시 계산됩니다.${g.meeting_id ? ' 회의록에서 만든 기록입니다(회의록은 그대로 남습니다).' : ''}`,
      ok: '지우기',
      danger: true,
    })
    if (!ok) return
    try {
      await api.del(`/guidance/${g.id}`)
      bump()
    } catch (e: any) {
      toast(e.message, 'error')
    }
  }

  const doPaste = async () => {
    if (!paste) return
    try {
      const r = await api.post<{ added: number; skipped: number }>('/import-paste', { ...paste, school_year: year })
      toast(`${r.added}건을 가져왔습니다${r.skipped ? ` · 건너뜀 ${r.skipped}건(머리행·중복)` : ''}`)
      setPaste(null)
      bump()
    } catch (e: any) {
      toast(e.message, 'error')
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageTitle
        icon={History}
        title="생활지도 이력"
        sub="회의록을 확정하면 지도 대상자에게 자동으로 쌓입니다. 마지막 지도 달까지는 누적에서 빠집니다"
        right={
          !readonly && (
            <div className="flex gap-2">
              <button className="btn btn-secondary" onClick={() => setPaste({ kind: 'guidance', text: '' })}>
                <ClipboardPaste size={16} /> 붙여넣기 가져오기
              </button>
              <button className="btn btn-primary" onClick={() => openForm({ student_id: '', name: '', step: '', month: '', date: today(), measure: '', note: '' })}>
                <Plus size={16} /> 기록 추가
              </button>
            </div>
          )
        }
      />
      <Card
        title={`지도 기록 (${shown.length}건 · ${byStudent.length}명)`}
        right={
          <select className="field field-sm" value={grade} onChange={(e) => setGrade(Number(e.target.value))}>
            <option value={0}>전 학년</option>
            {[1, 2, 3].map((g) => (
              <option key={g} value={g}>
                {g}학년
              </option>
            ))}
          </select>
        }
        pad={false}
      >
        {!list ? (
          <Loading />
        ) : shown.length === 0 ? (
          <Empty icon={History} title="생활지도 기록이 없습니다" sub="기존 시트의 4️⃣(S:X) 영역을 복사해 「붙여넣기 가져오기」로 옮겨 올 수 있습니다." />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>학번</th>
                <th>이름</th>
                <th>차수</th>
                <th>실시 월</th>
                <th>날짜</th>
                <th>지도 방안</th>
                <th>관련 회의록</th>
                <th>비고</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {byStudent.map(([sid, gs]) =>
                gs.map((g, i) => (
                  <tr key={g.id}>
                    <td className="num text-xs text-muted">{i === 0 ? sid : ''}</td>
                    <td className="font-medium text-ink-strong">
                      {i === 0 && (
                        <button className="hover:text-accent-ink" onClick={() => go('personal', { sid })}>
                          {g.name}
                        </button>
                      )}
                    </td>
                    <td>
                      <StageBadge stage={stageOf(g.step)} />
                    </td>
                    <td className="num">{g.month ? `${g.month}월` : <span className="text-absent">월 없음</span>}</td>
                    <td className="num text-xs text-muted">{g.date || '–'}</td>
                    <td>{g.measure || '–'}</td>
                    <td className="text-sm">
                      {g.meeting_id ? (
                        <button className="text-accent-ink hover:underline" onClick={() => go('minutes', { meetingId: g.meeting_id! })}>
                          제{g.meeting_seq}차 회의록
                        </button>
                      ) : (
                        <span className="text-faint">–</span>
                      )}
                    </td>
                    <td className="max-w-[220px] truncate text-xs text-muted" title={g.note}>
                      {g.note}
                    </td>
                    <td className="r whitespace-nowrap">
                      {!readonly && (
                        <>
                          <button
                            className="btn btn-ghost btn-icon"
                            aria-label="고치기"
                            onClick={() => openForm({ id: g.id, student_id: g.student_id, name: g.name, step: g.step, month: g.month ?? '', date: g.date || '', measure: g.measure || '', note: g.note || '' })}
                          >
                            <Pencil size={16} />
                          </button>
                          <button className="btn btn-ghost btn-icon" aria-label="지우기" onClick={() => remove(g)}>
                            <Trash2 size={16} />
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </Card>

      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title={form?.id ? '생활지도 기록 고치기' : '생활지도 기록 추가'}
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setForm(null)}>
              취소
            </button>
            <SaveButton dirty={formDirty} saving={saving} savedAt={savedAt} onClick={save} disabled={!form?.student_id || !form?.month} />
          </>
        }
      >
        {form && (
          <div className="grid grid-cols-2 gap-4">
            <Field label="학번">
              <input className="field num" value={form.student_id} onChange={(e) => setForm({ ...form, student_id: e.target.value })} onBlur={(e) => lookup(e.target.value)} autoFocus={!form.id} />
            </Field>
            <Field label="이름">
              <input className="field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="차수" hint={`${rules.stages.count + 1} 이상 = ${rules.stages.final_name}`}>
              <input type="number" min={1} className="field num" value={form.step} onChange={(e) => setForm({ ...form, step: Number(e.target.value) || '' })} />
            </Field>
            <Field label="실시 월 (누적 초기화 기준)">
              <select className="field" value={form.month} onChange={(e) => setForm({ ...form, month: Number(e.target.value) || '' })}>
                <option value="">고르십시오</option>
                {schoolMonths(rules.start_month).map((m) => (
                  <option key={m} value={m}>
                    {m}월
                  </option>
                ))}
              </select>
            </Field>
            <Field label="날짜">
              <input type="date" className="field num" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </Field>
            <Field label="지도 방안">
              <input className="field" value={form.measure} onChange={(e) => setForm({ ...form, measure: e.target.value })} />
            </Field>
            <Field label="비고" className="col-span-2">
              <input className="field" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </Field>
          </div>
        )}
      </Modal>

      <Modal
        open={!!paste}
        onClose={() => setPaste(null)}
        title="기존 시트에서 붙여넣기 가져오기"
        width={680}
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setPaste(null)}>
              취소
            </button>
            <button className="btn btn-primary" onClick={doPaste} disabled={!paste?.text.trim()}>
              가져오기
            </button>
          </>
        }
      >
        {paste && (
          <div className="flex flex-col gap-4">
            <fieldset className="flex flex-col gap-2 text-sm">
              <label className="flex items-center gap-2">
                <input type="radio" checked={paste.kind === 'guidance'} onChange={() => setPaste({ ...paste, kind: 'guidance' })} />
                4️⃣ 생활지도 집계 (S:X — 학번 · 이름 · 1회 · 2회 · 3회 · 학생선도위원회)
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" checked={paste.kind === 'exclusion'} onChange={() => setPaste({ ...paste, kind: 'exclusion' })} />
                2️⃣ 생활지도 대상자 제외 처리 (J:L — 학번 · 이름 · 사유)
              </label>
            </fieldset>
            <textarea
              className="field num h-56 font-mono text-xs"
              placeholder={paste.kind === 'guidance' ? '30206\t홍길동\t5월\t8월\t\t' : '30101\t김철수\t자퇴생'}
              value={paste.text}
              onChange={(e) => setPaste({ ...paste, text: e.target.value })}
            />
            <p className="text-xs text-muted">
              {paste.kind === 'guidance'
                ? '칸 값(예: 5월)은 차수별 실시 월로 읽습니다. 이미 있는 차수는 건너뜁니다.'
                : '옛 제외 명단은 학생 전체에 걸렸으므로 「전체 기간」 제외로 가져옵니다. 가져온 뒤 제외 처리 화면에서 달별 사유로 고치십시오.'}
            </p>
          </div>
        )}
      </Modal>
    </div>
  )
}
