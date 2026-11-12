import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, Wand2 } from 'lucide-react'
import { useApp } from '@/context'
import { api } from '@/lib/api'
import { cn } from '@/lib/format'
import type { Item, Rules, RulesText, Settings } from '@/lib/types'
import { ITEM_LABEL, ITEMS } from '@/lib/types'
import { Field, IconTile, Toggle } from '@/components/ui'

const STEPS = ['학교', '세는 대상', '환산', '기준', '초기화', '단계', '지도 방안', '회의록', '확인']

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x))
}

export default function Wizard({ embedded = false, onClose }: { embedded?: boolean; onClose?: () => void }) {
  const { state, toast, confirm, bump } = useApp()
  const [s, setS] = useState<Settings>(() => clone(state!.settings))
  const [step, setStep] = useState(0)
  const [text, setText] = useState<RulesText | null>(state!.rules_text)
  const [missing, setMissing] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const r = s.rules
  // 설정에서 다시 연 경우: 바뀐 것이 없으면 저장할 필요가 없다
  const changed = !embedded || JSON.stringify(s) !== JSON.stringify(state!.settings)

  useEffect(() => {
    const t = setTimeout(() => {
      api
        .post<{ text: RulesText; missing_measures: string[] }>('/rules/describe', { ...r, _grades: s.grades })
        .then((x) => {
          setText(x.text)
          setMissing(x.missing_measures)
        })
        .catch(() => {})
    }, 150)
    return () => clearTimeout(t)
  }, [r, s.grades])

  const setR = (patch: Partial<Rules>) => setS((x) => ({ ...x, rules: { ...x.rules, ...patch } }))
  const stageKeys = useMemo(() => [...Array.from({ length: r.stages.count }, (_, i) => String(i + 1)), 'final'], [r.stages.count])

  const save = async () => {
    if (!ITEMS.some((k) => r.count[k])) {
      toast('세는 대상을 하나 이상 고르십시오', 'error')
      setStep(1)
      return
    }
    if (missing.length) {
      const ok = await confirm({
        title: '지도 방안 칸이 비어 있습니다',
        body: (
          <div className="flex flex-col gap-2">
            <p>비어 있는 칸: {missing.join(', ')}</p>
            <p className="text-muted">비워 두면 대상자 명단과 회의록의 생활지도 내역이 빈칸으로 나옵니다. 나중에 설정에서 채울 수 있습니다.</p>
          </div>
        ),
        ok: '그대로 저장',
      })
      if (!ok) {
        setStep(6)
        return
      }
    }
    setSaving(true)
    try {
      await api.put('/settings', { ...s, setup_done: true })
      toast('생활규정 설정을 저장했습니다. 대시보드·명단이 새 규정으로 다시 계산됩니다')
      bump()
      onClose?.()
    } catch (e: any) {
      toast(e.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const sentence = (key: string) => text?.parts?.[key] && <p className="mt-4 rounded-lg bg-raised px-4 py-3 text-sm text-ink">{text.parts[key]}</p>

  const body = (
    <div className="card mx-auto w-full max-w-[880px]">
      <div className="flex items-center gap-3 border-b border-line px-6 py-5">
        <IconTile icon={Wand2} size={36} />
        <div>
          <h1 className="text-xl font-semibold leading-7 text-ink-strong">생활규정 설정 마법사</h1>
          <p className="text-sm text-muted">기본값은 지금 쓰고 있는 스프레드시트(Code.gs)의 규정입니다. 바꿀 것만 고치십시오.</p>
        </div>
      </div>
      <ol className="flex flex-wrap gap-1 border-b border-line px-6 py-3">
        {STEPS.map((t, i) => (
          <li key={t}>
            <button
              onClick={() => setStep(i)}
              className={cn(
                'flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium transition-colors duration-150',
                i === step ? 'bg-[color-mix(in_srgb,var(--accent)_10%,#fff)] text-accent-ink' : 'text-muted hover:bg-raised'
              )}
            >
              <span className="num">{i + 1}</span> {t}
            </button>
          </li>
        ))}
      </ol>
      <div className="min-h-[340px] px-6 py-6">
        {step === 0 && (
          <div className="grid grid-cols-2 gap-4">
            <Field label="학교명" hint="첫 업로드 때 나이스 파일 꼬리의 학교명을 자동으로 넣습니다">
              <input className="field" value={s.school_name} onChange={(e) => setS({ ...s, school_name: e.target.value })} placeholder="예: ○○고등학교" />
            </Field>
            <Field label="현재 학년도">
              <input type="number" className="field num" value={s.current_year} onChange={(e) => setS({ ...s, current_year: Number(e.target.value) })} />
            </Field>
            <Field label="학년도 시작 월" hint="시작 월보다 앞선 달(예: 1·2월)은 앞 학년도에 넣습니다">
              <select className="field" value={r.start_month} onChange={(e) => setR({ start_month: Number(e.target.value) })}>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>
                    {m}월
                  </option>
                ))}
              </select>
            </Field>
            <Field label="담당 학년" hint="대시보드와 업로드 기본 체크에 씁니다">
              <div className="flex h-9 items-center gap-4">
                {[1, 2, 3].map((g) => (
                  <label key={g} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={s.grades.includes(g)}
                      onChange={(e) => setS({ ...s, grades: e.target.checked ? [...s.grades, g].sort() : s.grades.filter((x) => x !== g) })}
                    />
                    {g}학년
                  </label>
                ))}
              </div>
            </Field>
          </div>
        )}
        {step === 1 && (
          <div>
            <p className="mb-3 text-sm text-ink">어떤 미인정 출결을 셀지 고르십시오.</p>
            <div className="flex gap-6">
              {ITEMS.map((k: Item) => (
                <label key={k} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={r.count[k]} onChange={(e) => setR({ count: { ...r.count, [k]: e.target.checked } })} />
                  미인정 {ITEM_LABEL[k]}
                </label>
              ))}
            </div>
            {sentence('count')}
          </div>
        )}
        {step === 2 && (
          <div className="flex flex-col gap-3">
            <label className="flex items-start gap-3 text-sm">
              <input type="radio" name="conv" checked={r.conversion.mode === 'weighted'} onChange={() => setR({ conversion: { ...r.conversion, mode: 'weighted' } })} className="mt-0.5" />
              <span>
                <span className="font-medium text-ink-strong">가중 환산</span>
                <span className="block text-muted">지각·조퇴·결과를 합쳐 N회 = 결석 1회, 남은 횟수는 다음 달로 이월</span>
              </span>
            </label>
            {r.conversion.mode === 'weighted' && (
              <div className="ml-7 flex items-center gap-2 text-sm">
                N =
                <input type="number" min={1} max={10} className="field field-sm w-20 num" value={r.conversion.n} onChange={(e) => setR({ conversion: { ...r.conversion, n: Math.max(1, Number(e.target.value)) } })} />
              </div>
            )}
            <label className="flex items-start gap-3 text-sm">
              <input type="radio" name="conv" checked={r.conversion.mode === 'simple'} onChange={() => setR({ conversion: { ...r.conversion, mode: 'simple' } })} className="mt-0.5" />
              <span>
                <span className="font-medium text-ink-strong">단순 합계</span>
                <span className="block text-muted">네 항목 횟수를 그대로 더함</span>
              </span>
            </label>
            {sentence('conversion')}
            <p className="text-xs text-muted">명단 기준값과 화면에 보이는 누적값은 늘 같은 환산 방식을 씁니다.</p>
          </div>
        )}
        {step === 3 && (
          <div>
            <Field label="대상자 기준 점수 (이상)">
              <input type="number" min={1} className="field w-32 num" value={r.threshold} onChange={(e) => setR({ threshold: Math.max(1, Number(e.target.value)) })} />
            </Field>
            {sentence('threshold')}
          </div>
        )}
        {step === 4 && (
          <div className="flex flex-col gap-3">
            <Toggle checked={r.reset.enabled} onChange={(v) => setR({ reset: { ...r.reset, enabled: v } })} label="생활지도 후 누적 초기화" />
            {r.reset.enabled && (
              <div className="ml-11 flex flex-col gap-2 text-sm">
                <label className="flex items-center gap-2">
                  <input type="radio" name="scope" checked={r.reset.scope === 'through'} onChange={() => setR({ reset: { ...r.reset, scope: 'through' } })} />
                  지도한 달까지 지우기 (다음 달부터 다시 셈)
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="scope" checked={r.reset.scope === 'before'} onChange={() => setR({ reset: { ...r.reset, scope: 'before' } })} />
                  지도한 달 전까지 지우기 (지도한 달부터 다시 셈)
                </label>
                <p className="text-xs text-muted">초기화하면 남아 있던 이월 횟수도 사라집니다(고정).</p>
              </div>
            )}
            {sentence('reset')}
          </div>
        )}
        {step === 5 && (
          <div className="grid grid-cols-3 gap-4">
            <Field label="학년부 생활지도 단계 수">
              <input type="number" min={1} max={6} className="field num" value={r.stages.count} onChange={(e) => setR({ stages: { ...r.stages, count: Math.min(6, Math.max(1, Number(e.target.value))) } })} />
            </Field>
            <Field label="단계 이름">
              <input className="field" value={r.stages.stage_name} onChange={(e) => setR({ stages: { ...r.stages, stage_name: e.target.value } })} />
            </Field>
            <Field label="마지막 단계 이름">
              <input className="field" value={r.stages.final_name} onChange={(e) => setR({ stages: { ...r.stages, final_name: e.target.value } })} />
            </Field>
            <div className="col-span-3">{sentence('stages')}</div>
          </div>
        )}
        {step === 6 && (
          <div className="flex flex-col gap-5">
            <p className="text-sm text-ink">학년마다 차수별 지도(징계) 방안을 적으십시오. 대상자 명단과 회의록 표3의 생활지도 내역에 그대로 들어갑니다.</p>
            {s.grades.length === 0 && <p className="text-sm text-absent">1단계에서 담당 학년을 고르십시오.</p>}
            {s.grades.map((g) => (
              <div key={g}>
                <p className="mb-2 text-sm font-semibold text-ink-strong">{g}학년</p>
                <div className="grid grid-cols-2 gap-3">
                  {stageKeys.map((k) => {
                    const v = r.measures[String(g)]?.[k] || ''
                    return (
                      <Field key={k} label={k === 'final' ? r.stages.final_name : `${k}차 ${r.stages.stage_name}`}>
                        <input
                          className="field"
                          aria-invalid={!v}
                          value={v}
                          placeholder={k === '2' ? '예: 교내 환경정화활동' : '지도 방안'}
                          onChange={(e) => setR({ measures: { ...r.measures, [String(g)]: { ...(r.measures[String(g)] || {}), [k]: e.target.value } } })}
                        />
                      </Field>
                    )
                  })}
                </div>
              </div>
            ))}
            {missing.length > 0 && <p className="text-sm text-late-ink">비어 있는 칸 {missing.length}개 — 저장 전에 한 번 더 알려 드립니다.</p>}
          </div>
        )}
        {step === 7 && (
          <div className="flex flex-col gap-5">
            <p className="text-sm text-ink">회의록을 만들 때 자동으로 채울 기본값입니다. 회의록마다 고칠 수 있습니다.</p>
            {s.grades.map((g) => {
              const d = s.minutes_defaults[String(g)] || {}
              const set = (k: string, v: string) => setS({ ...s, minutes_defaults: { ...s.minutes_defaults, [String(g)]: { ...d, [k]: v } } })
              return (
                <div key={g}>
                  <p className="mb-2 text-sm font-semibold text-ink-strong">{g}학년부</p>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="장소">
                      <input className="field" value={d.place || ''} onChange={(e) => set('place', e.target.value)} placeholder="예: 4층 3학년 쉼마루" />
                    </Field>
                    <Field label="시간">
                      <input className="field num" value={d.time_range || ''} onChange={(e) => set('time_range', e.target.value)} placeholder="예: 12:00~12:20" />
                    </Field>
                    <Field label="위원장">
                      <input className="field" value={d.chair || ''} onChange={(e) => set('chair', e.target.value)} placeholder="예: ○○○ 학년부장" />
                    </Field>
                    <Field label="위원">
                      <input className="field" value={d.members || ''} onChange={(e) => set('members', e.target.value)} placeholder="쉼표로 구분" />
                    </Field>
                  </div>
                </div>
              )
            })}
          </div>
        )}
        {step === 8 && (
          <div>
            <p className="mb-3 text-sm text-ink">아래 규정으로 계산합니다. 맞으면 저장하십시오.</p>
            <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm text-ink">
              {text?.summary.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ol>
            <div className="mt-4 rounded-lg bg-raised px-4 py-3 text-sm">
              <p className="mb-1 font-medium text-ink-strong">학년별 지도 방안</p>
              {s.grades.map((g) => (
                <p key={g} className="text-ink">
                  {g}학년: {stageKeys.map((k) => `${k === 'final' ? r.stages.final_name : k + '차'} ${r.measures[String(g)]?.[k] || '(빈칸)'}`).join(' / ')}
                </p>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="flex items-center justify-between border-t border-line px-6 py-4">
        <div>
          {embedded && (
            <button className="btn btn-ghost" onClick={onClose}>
              닫기
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <button className="btn btn-secondary" disabled={step === 0} onClick={() => setStep(step - 1)}>
            <ArrowLeft size={16} /> 이전
          </button>
          {step < STEPS.length - 1 ? (
            <button className="btn btn-primary" onClick={() => setStep(step + 1)}>
              다음 <ArrowRight size={16} />
            </button>
          ) : (
            <button className="btn btn-primary" onClick={save} disabled={saving || !changed} title={changed ? undefined : '바뀐 내용이 없습니다'}>
              <Check size={16} /> {changed ? '이 규정으로 저장' : '바뀐 내용 없음'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
  if (embedded) return body
  return <div className="min-h-screen px-6 py-10">{body}</div>
}
