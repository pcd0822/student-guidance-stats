import { useEffect, useRef, useState } from 'react'
import { Archive, CalendarRange, Download, FileText, RotateCcw, Settings as SettingsIcon, Upload, Wand2 } from 'lucide-react'
import { useApp } from '@/context'
import { api, download } from '@/lib/api'
import { Card, Field, PageTitle } from '@/components/ui'
import Wizard from './Wizard'

export default function SettingsPage() {
  const { state, toast, confirm, bump, setYear } = useApp()
  const s = state!.settings
  const [wizard, setWizard] = useState(false)
  const [newYear, setNewYear] = useState(s.current_year + 1)
  const [tpl, setTpl] = useState<{ custom: boolean; updated_at: string | null } | null>(null)
  const tplInput = useRef<HTMLInputElement>(null)
  const restoreInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api.get<{ custom: boolean; updated_at: string | null }>('/template').then(setTpl).catch(() => {})
  }, [])

  if (wizard) return <Wizard embedded onClose={() => setWizard(false)} />

  const switchYear = async () => {
    const ok = await confirm({
      title: `${newYear}학년도로 전환할까요`,
      body: (
        <div className="flex flex-col gap-2">
          <p>새 자료는 {newYear}학년도로 저장합니다.</p>
          <p className="text-muted">{s.current_year}학년도를 포함한 이전 학년도 자료는 지우지 않고 읽기 전용으로 남깁니다. 왼쪽 아래 학년도 목록에서 볼 수 있습니다.</p>
        </div>
      ),
      ok: '전환',
    })
    if (!ok) return
    try {
      await api.post('/school-year', { year: newYear })
      setYear(null)
      bump()
      toast(`${newYear}학년도로 전환했습니다`)
    } catch (e: any) {
      toast(e.message, 'error')
    }
  }

  const uploadTpl = async (f?: File) => {
    if (!f) return
    try {
      setTpl(await api.upload('/template', f))
      toast('회의록 양식을 바꿨습니다')
    } catch (e: any) {
      toast(e.message, 'error')
    } finally {
      if (tplInput.current) tplInput.current.value = ''
    }
  }

  const resetTpl = async () => {
    if (!(await confirm({ title: '기본 양식으로 되돌릴까요', body: '바꿔 끼운 양식 파일을 지우고 처음 양식을 씁니다.', ok: '되돌리기' }))) return
    setTpl(await api.del('/template'))
    toast('기본 양식으로 되돌렸습니다')
  }

  const backup = async () => {
    try {
      const p = await download('/backup', 'backup.zip')
      if (p) toast(`저장했습니다: ${p}`)
    } catch (e: any) {
      toast(e.message, 'error')
    }
  }

  const restore = async (f?: File) => {
    if (!f) return
    const ok = await confirm({
      title: '백업에서 가져올까요',
      body: (
        <div className="flex flex-col gap-2">
          <p>지금 데이터를 「{f.name}」의 내용으로 바꿉니다.</p>
          <p className="text-muted">바꾸기 전 데이터는 data/backups 폴더에 자동으로 남겨 둡니다.</p>
        </div>
      ),
      ok: '가져오기',
      danger: true,
    })
    if (!ok) {
      if (restoreInput.current) restoreInput.current.value = ''
      return
    }
    try {
      await api.upload('/restore', f)
      setYear(null)
      bump()
      toast('백업에서 가져왔습니다')
    } catch (e: any) {
      toast(e.message, 'error')
    } finally {
      if (restoreInput.current) restoreInput.current.value = ''
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageTitle icon={SettingsIcon} title="설정" sub="생활규정·학년도·회의록 양식·백업을 관리합니다" />

      <Card
        title="생활규정"
        right={
          <button className="btn btn-secondary" onClick={() => setWizard(true)}>
            <Wand2 size={16} /> 마법사 다시 열기
          </button>
        }
      >
        <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm text-ink">
          {state!.rules_text.summary.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ol>
        {state!.missing_measures.length > 0 && (
          <p className="mt-4 text-sm text-late-ink">지도 방안 빈칸: {state!.missing_measures.join(', ')}</p>
        )}
      </Card>

      <Card title={<span className="flex items-center gap-2"><CalendarRange size={16} className="text-muted" /> 학년도</span>}>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <p className="label">현재 학년도</p>
            <p className="num text-2xl font-medium text-ink-strong">{s.current_year}</p>
          </div>
          <Field label="새 학년도">
            <input type="number" className="field w-28 num" value={newYear} onChange={(e) => setNewYear(Number(e.target.value))} />
          </Field>
          <button className="btn btn-secondary" onClick={switchYear} disabled={newYear === s.current_year}>
            새 학년도로 전환
          </button>
        </div>
      </Card>

      <Card title={<span className="flex items-center gap-2"><FileText size={16} className="text-muted" /> 회의록 양식 (hwpx)</span>}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-sm text-ink">
            {tpl?.custom ? `바꿔 끼운 양식을 씁니다 (${tpl.updated_at})` : '기본 양식(2026 제4차 3학년부 학생선도 소위원회 회의록)을 씁니다'}
            <span className="block text-xs text-muted">새 양식은 기본 양식과 같은 구조(머리 표 + 월별 미인정 표 + 생활지도 표)여야 합니다. 올릴 때 시험 삼아 만들어 확인합니다.</span>
          </p>
          <div className="flex gap-2">
            <button className="btn btn-ghost" onClick={() => download('/template/download', '회의록_양식.hwpx').catch((e) => toast(e.message, 'error'))}>
              <Download size={16} /> 지금 양식 받기
            </button>
            {tpl?.custom && (
              <button className="btn btn-secondary" onClick={resetTpl}>
                <RotateCcw size={16} /> 기본 양식으로
              </button>
            )}
            <button className="btn btn-secondary" onClick={() => tplInput.current?.click()}>
              <Upload size={16} /> 양식 바꾸기
            </button>
            <input ref={tplInput} type="file" accept=".hwpx" className="hidden" onChange={(e) => uploadTpl(e.target.files?.[0])} />
          </div>
        </div>
      </Card>

      <Card title={<span className="flex items-center gap-2"><Archive size={16} className="text-muted" /> 데이터 내보내기 · 가져오기</span>}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-sm text-ink">
            DB와 설정(바꿔 끼운 양식 포함)을 zip 한 파일로 묶습니다. 학생 개인정보가 들어 있으니 학교 밖으로 보내지 마십시오.
          </p>
          <div className="flex gap-2">
            <button className="btn btn-secondary" onClick={() => restoreInput.current?.click()}>
              <Upload size={16} /> 가져오기
            </button>
            <button className="btn btn-primary" onClick={backup}>
              <Download size={16} /> 내보내기
            </button>
            <input ref={restoreInput} type="file" accept=".zip" className="hidden" onChange={(e) => restore(e.target.files?.[0])} />
          </div>
        </div>
      </Card>
    </div>
  )
}
