import { BookOpenCheck, Contact, FileText, FileUp, History, LayoutDashboard, Settings as SettingsIcon, ShieldMinus, UserRound } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { AppProvider, useApp, type Page } from './context'
import { IconTile, Spinner } from './components/ui'
import { cn } from './lib/format'
import Dashboard from './pages/Dashboard'
import Upload from './pages/Upload'
import Students from './pages/Students'
import Exclusions from './pages/Exclusions'
import GuidancePage from './pages/Guidance'
import PersonalPage from './pages/Personal'
import MinutesPage from './pages/Minutes'
import SettingsPage from './pages/Settings'
import Wizard from './pages/Wizard'

const MENU: { key: Page; label: string; icon: LucideIcon }[] = [
  { key: 'dashboard', label: '대시보드', icon: LayoutDashboard },
  { key: 'upload', label: '자료 올리기', icon: FileUp },
  { key: 'students', label: '학생 관리', icon: Contact },
  { key: 'exclusions', label: '제외 처리', icon: ShieldMinus },
  { key: 'guidance', label: '생활지도 이력', icon: History },
  { key: 'personal', label: '개인별 통계', icon: UserRound },
  { key: 'minutes', label: '회의록', icon: FileText },
  { key: 'settings', label: '설정', icon: SettingsIcon },
]

function Shell() {
  const { state, page, go, year, setYear, readonly } = useApp()
  if (!state) {
    return (
      <div className="grid h-screen place-items-center">
        <Spinner />
      </div>
    )
  }
  if (!state.settings.setup_done) return <Wizard />
  return (
    <div className="flex min-h-screen">
      <aside className="no-print sticky top-0 flex h-screen w-[232px] shrink-0 flex-col gap-4 border-r border-line bg-paper px-3 py-6">
        <div className="flex items-center gap-3 px-2">
          <IconTile icon={BookOpenCheck} size={36} />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-ink-strong">생활지도·학생선도</p>
            <p className="truncate text-xs text-muted">{state.settings.school_name || '학교명 미설정'}</p>
          </div>
        </div>
        <nav className="flex flex-col gap-1">
          {MENU.map((m) => {
            const on = page === m.key
            return (
              <button
                key={m.key}
                onClick={() => go(m.key)}
                className={cn(
                  'flex h-9 items-center gap-3 rounded-lg px-2 text-left text-sm font-medium transition-colors duration-150',
                  on ? 'bg-raised text-ink-strong' : 'text-ink hover:bg-raised'
                )}
                aria-current={on ? 'page' : undefined}
              >
                <IconTile icon={m.icon} size={28} active={on} />
                {m.label}
              </button>
            )
          })}
        </nav>
        <div className="mt-auto flex flex-col gap-2 px-2">
          <label className="label" htmlFor="year-select">
            학년도
          </label>
          <select
            id="year-select"
            className="field field-sm"
            value={year}
            onChange={(e) => setYear(Number(e.target.value) === state.settings.current_year ? null : Number(e.target.value))}
          >
            {state.school_years.map((y) => (
              <option key={y} value={y}>
                {y}학년도{y === state.settings.current_year ? ' (현재)' : ' (읽기 전용)'}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted">모든 자료는 이 컴퓨터 안에만 저장합니다 · v{state.version}</p>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-6 py-6">
        {readonly && (
          <div className="no-print mb-4 rounded-lg border px-4 py-2 text-sm text-late-ink" style={{ borderColor: 'color-mix(in srgb, var(--late) 45%, #fff)', background: 'color-mix(in srgb, var(--late) 8%, #fff)' }}>
            {year}학년도 자료를 읽기 전용으로 보고 있습니다. 고치려면 왼쪽 아래에서 현재 학년도({state.settings.current_year})를 고르십시오.
          </div>
        )}
        {page === 'dashboard' && <Dashboard />}
        {page === 'upload' && <Upload />}
        {page === 'students' && <Students />}
        {page === 'exclusions' && <Exclusions />}
        {page === 'guidance' && <GuidancePage />}
        {page === 'personal' && <PersonalPage />}
        {page === 'minutes' && <MinutesPage />}
        {page === 'settings' && <SettingsPage />}
      </main>
    </div>
  )
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  )
}
