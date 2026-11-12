import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { api } from '@/lib/api'
import type { AppState } from '@/lib/types'
import { Modal } from '@/components/ui'

export type Page = 'dashboard' | 'upload' | 'exclusions' | 'guidance' | 'personal' | 'minutes' | 'settings'

export interface NavParams {
  sid?: string
  draft?: { grade: number; student_ids: string[]; basis_month?: number }
  meetingId?: number
}

interface ConfirmOpts {
  title: string
  body?: ReactNode
  ok?: string
  danger?: boolean
}

interface Ctx {
  state: AppState | null
  refresh: () => Promise<void>
  year: number
  setYear: (y: number | null) => void
  readonly: boolean
  page: Page
  params: NavParams
  go: (p: Page, params?: NavParams) => void
  toast: (msg: string, tone?: 'ok' | 'error' | 'warn') => void
  confirm: (o: ConfirmOpts) => Promise<boolean>
  /** 데이터가 바뀌면 올라가는 번호. 화면들이 다시 불러올 때 쓴다 */
  version: number
  bump: () => void
}

const AppCtx = createContext<Ctx | null>(null)

export function useApp() {
  const c = useContext(AppCtx)
  if (!c) throw new Error('AppProvider 밖입니다')
  return c
}

interface ToastItem {
  id: number
  msg: string
  tone: 'ok' | 'error' | 'warn'
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState | null>(null)
  const [viewYear, setViewYear] = useState<number | null>(null)
  const [page, setPage] = useState<Page>('dashboard')
  const [params, setParams] = useState<NavParams>({})
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [version, setVersion] = useState(0)
  const [conf, setConf] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null)
  const tid = useRef(0)

  const refresh = useCallback(async () => {
    const s = await api.get<AppState>('/state', { school_year: viewYear ?? undefined })
    setState(s)
  }, [viewYear])

  useEffect(() => {
    refresh().catch((e) => toast(String(e.message || e), 'error'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh, version])

  const toast = useCallback((msg: string, tone: 'ok' | 'error' | 'warn' = 'ok') => {
    const id = ++tid.current
    setToasts((t) => [...t, { id, msg, tone }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 7000 : 4000)
  }, [])

  const confirm = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => setConf({ ...o, resolve })), [])

  const go = useCallback((p: Page, prm: NavParams = {}) => {
    setPage(p)
    setParams(prm)
    window.scrollTo(0, 0)
  }, [])

  const close = (v: boolean) => {
    conf?.resolve(v)
    setConf(null)
  }

  const value: Ctx = {
    state,
    refresh,
    year: state?.school_year ?? new Date().getFullYear(),
    setYear: (y) => setViewYear(y),
    readonly: !!state?.readonly,
    page,
    params,
    go,
    toast,
    confirm,
    version,
    bump: () => setVersion((v) => v + 1),
  }

  return (
    <AppCtx.Provider value={value}>
      {children}
      <div className="no-print pointer-events-none fixed bottom-6 right-6 z-[60] flex w-[380px] flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className="card pointer-events-auto px-4 py-3 text-sm"
            style={{
              boxShadow: '0 8px 24px rgba(28,25,23,.08)',
              borderColor: t.tone === 'error' ? 'color-mix(in srgb, var(--absent) 40%, #fff)' : t.tone === 'warn' ? 'color-mix(in srgb, var(--late) 50%, #fff)' : undefined,
              color: t.tone === 'error' ? 'var(--absent)' : t.tone === 'warn' ? 'var(--late-ink)' : 'var(--ink-strong)',
            }}
          >
            {t.msg}
          </div>
        ))}
      </div>
      <Modal
        open={!!conf}
        onClose={() => close(false)}
        title={conf?.title}
        width={440}
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => close(false)}>
              취소
            </button>
            <button className={conf?.danger ? 'btn btn-danger' : 'btn btn-primary'} onClick={() => close(true)} autoFocus>
              {conf?.ok || '확인'}
            </button>
          </>
        }
      >
        <div className="text-sm text-ink">{conf?.body}</div>
      </Modal>
    </AppCtx.Provider>
  )
}
