import type { LucideIcon } from 'lucide-react'
import { Check, Loader2, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { cn } from '@/lib/format'
import type { Item, Stage } from '@/lib/types'
import { ITEM_COLOR, ITEM_LABEL } from '@/lib/types'
import { schoolMonths } from '@/lib/months'

/* ---------------------------------------------------------------- 유리 아이콘 타일 (DESIGN.md 6절) */

function iconSize(size: number) {
  if (size <= 24) return 14
  if (size <= 28) return 16
  if (size <= 36) return 20
  return Math.round(size * 0.5)
}

export function IconTile({ icon: Icon, size = 36, active = false, className = '' }: { icon: LucideIcon; size?: number; active?: boolean; className?: string }) {
  return (
    <span
      className={cn('glass-tile inline-grid shrink-0 place-items-center', active && 'glass-tile-active', className)}
      style={{ width: size, height: size, borderRadius: size <= 28 ? 8 : 10 }}
      aria-hidden
    >
      <Icon size={iconSize(size)} strokeWidth={1.75} />
    </span>
  )
}

export function PageTitle({ icon, title, sub, right }: { icon: LucideIcon; title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-3">
        <IconTile icon={icon} size={36} />
        <div className="min-w-0">
          <h1 className="text-xl font-semibold leading-7 text-ink-strong">{title}</h1>
          {sub && <div className="text-sm text-muted">{sub}</div>}
        </div>
      </div>
      {right}
    </div>
  )
}

export function Card({ title, right, children, className = '', pad = true }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={cn('card', className)}>
      {(title || right) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          {title && <h2 className="text-base font-semibold text-ink-strong">{title}</h2>}
          {right}
        </div>
      )}
      <div className={pad ? 'p-5' : ''}>{children}</div>
    </section>
  )
}

/* ---------------------------------------------------------------- 시그니처: 손으로 그은 사선 */

export function Slash({ color, size = 16 }: { color: string; size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden className="shrink-0">
      <rect x="0.5" y="0.5" width="15" height="15" rx="4" fill={color} fillOpacity={0.12} />
      <line x1="3.5" y1="12.5" x2="12.5" y2="3.5" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

/** 미인정 횟수 칸: 0 이면 흐린 대시, 있으면 사선 + 숫자. 서류 제외가 있으면 (서류 n) */
export function CountCell({ item, value, doc = 0, excluded = false }: { item: Item; value: number; doc?: number; excluded?: boolean }) {
  if (!value) return <span className="text-faint">–</span>
  return (
    <span className={cn('inline-flex items-center gap-2 num', excluded && 'text-excused line-through')} title={`미인정 ${ITEM_LABEL[item]} ${value}회${doc ? ` · 서류 ${doc}회 제외` : ''}`}>
      {!excluded && <Slash color={ITEM_COLOR[item]} />}
      <span className="text-ink-strong">{value}</span>
      {doc > 0 && <span className="text-xs text-muted">(서류 {doc})</span>}
    </span>
  )
}

export function Legend() {
  return (
    <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
      {(['abs', 'late', 'leave', 'result'] as Item[]).map((k) => (
        <li key={k} className="flex items-center gap-1">
          <Slash color={ITEM_COLOR[k]} size={14} />
          미인정 {ITEM_LABEL[k]}
        </li>
      ))}
    </ul>
  )
}

/* ---------------------------------------------------------------- 단계 배지 */

export function StageBadge({ stage }: { stage: Pick<Stage, 'final' | 'index' | 'label'> }) {
  if (stage.final) {
    return (
      <span className="inline-flex h-6 items-center rounded-md px-2 text-xs font-medium" style={{ background: 'color-mix(in srgb, var(--absent) 12%, #fff)', color: 'var(--absent)' }}>
        {stage.label}
      </span>
    )
  }
  const pct = [8, 16, 28][Math.min(stage.index, 2)]
  return (
    <span className="inline-flex h-6 items-center rounded-md px-2 text-xs font-medium text-accent-ink" style={{ background: `color-mix(in srgb, var(--accent) ${pct}%, #fff)` }}>
      {stage.label}
    </span>
  )
}

/* ---------------------------------------------------------------- 월 체크 칩 */

export function MonthChips({
  start,
  value,
  onChange,
  available,
  label,
}: {
  start: number
  value: number[]
  onChange: (ms: number[]) => void
  available: number[]
  label?: string
}) {
  const months = schoolMonths(start)
  const toggle = (m: number) => onChange(value.includes(m) ? value.filter((x) => x !== m) : [...value, m])
  return (
    <div className="flex flex-wrap items-center gap-2">
      {label && <span className="label mr-1">{label}</span>}
      {months.map((m) => {
        const on = value.includes(m)
        const dis = !available.includes(m)
        return (
          <button
            key={m}
            type="button"
            disabled={dis}
            aria-pressed={on}
            onClick={() => toggle(m)}
            className={cn(
              'h-7 min-w-[44px] rounded-md border px-2 text-xs font-medium num transition-colors duration-150',
              dis && 'cursor-not-allowed border-line bg-paper text-faint',
              !dis && on && 'border-accent bg-[color-mix(in_srgb,var(--accent)_8%,#fff)] text-accent-ink',
              !dis && !on && 'border-line bg-surface text-ink hover:bg-raised'
            )}
            title={dis ? `${m}월 자료 없음` : undefined}
          >
            {m}월
          </button>
        )
      })}
      <span className="ml-1 flex gap-1">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(available)}>
          전체
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange([])}>
          비우기
        </button>
      </span>
    </div>
  )
}

/* ---------------------------------------------------------------- 토글·기타 */

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean }) {
  return (
    <label className={cn('inline-flex cursor-pointer select-none items-center gap-2 text-sm', disabled && 'cursor-not-allowed opacity-50')}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn('relative h-5 w-9 shrink-0 rounded-full border transition-colors duration-150', checked ? 'border-accent bg-accent' : 'border-line bg-raised')}
      >
        <span className={cn('absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white transition-[left] duration-150', checked ? 'left-[18px]' : 'left-0.5')} style={{ boxShadow: '0 1px 2px rgba(0,0,0,.2)' }} />
      </button>
      <span className="text-ink">{label}</span>
    </label>
  )
}

export function Spinner({ className = '' }: { className?: string }) {
  return <Loader2 size={16} className={cn('animate-spin text-muted', className)} />
}

export function Empty({ icon, title, sub, action }: { icon: LucideIcon; title: string; sub?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <IconTile icon={icon} size={48} />
      <p className="text-base font-semibold text-ink-strong">{title}</p>
      {sub && <p className="max-w-md text-sm text-muted">{sub}</p>}
      {action}
    </div>
  )
}

export function Modal({ open, onClose, title, children, footer, width = 560 }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; width?: number }) {
  useEffect(() => {
    if (!open) return
    const f = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[rgba(28,25,23,0.32)] p-6" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal
        className="card flex max-h-[90vh] w-full flex-col"
        style={{ maxWidth: width, boxShadow: '0 8px 24px rgba(28,25,23,.08)' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-base font-semibold text-ink-strong">{title}</h2>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="닫기">
            <X size={16} />
          </button>
        </div>
        <div className="overflow-auto p-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-4">{footer}</div>}
      </div>
    </div>
  )
}

export function Field({ label, children, hint, className = '' }: { label: ReactNode; children: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <label className={cn('flex flex-col gap-1', className)}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  )
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: 'absent' | 'late' }) {
  return (
    <div className="card flex flex-col gap-1 px-5 py-4">
      <span className="label">{label}</span>
      <span className={cn('text-2xl font-medium num', tone === 'absent' ? 'text-absent' : tone === 'late' ? 'text-late-ink' : 'text-ink-strong')}>{value}</span>
    </div>
  )
}

/* ---------------------------------------------------------------- 불러오는 중 */

/** 자료를 불러오는 동안 보이는 스피너. 빈 화면이나 「없습니다」가 먼저 깜빡이지 않게 한다 */
export function Loading({ label = '불러오는 중', className = '' }: { label?: string; className?: string }) {
  return (
    <div role="status" aria-live="polite" className={cn('flex items-center justify-center gap-2 py-10 text-sm text-muted', className)}>
      <Loader2 size={20} className="animate-spin text-accent" />
      {label}
    </div>
  )
}

/* ---------------------------------------------------------------- 저장 버튼 */

/**
 * 고친 것이 없으면 「저장됨」으로 잠기고, 고치면 「저장」, 저장 직후에는 「✓ 저장했습니다」를 잠시 보여 준다.
 * savedAt 은 저장에 성공한 시각(Date.now())
 */
export function SaveButton({
  dirty,
  saving,
  savedAt,
  onClick,
  disabled,
  label = '저장',
  className = 'btn btn-primary',
}: {
  dirty: boolean
  saving: boolean
  savedAt: number | null
  onClick: () => void
  disabled?: boolean
  label?: string
  className?: string
}) {
  const [, tick] = useState(0)
  const justSaved = !dirty && savedAt !== null && Date.now() - savedAt < 4000
  useEffect(() => {
    if (!justSaved) return
    const t = setTimeout(() => tick((n) => n + 1), 4000 - (Date.now() - (savedAt || 0)))
    return () => clearTimeout(t)
  }, [justSaved, savedAt])
  if (saving)
    return (
      <button className={className} disabled>
        <Loader2 size={16} className="animate-spin" /> 저장 중
      </button>
    )
  if (justSaved)
    return (
      <button className="btn btn-secondary" disabled style={{ opacity: 1, color: 'var(--accent-ink)', borderColor: 'var(--accent)' }} aria-live="polite">
        <Check size={16} /> 저장했습니다
      </button>
    )
  if (!dirty)
    return (
      <button className="btn btn-secondary" disabled title="고친 내용이 없습니다">
        저장됨
      </button>
    )
  return (
    <button className={className} onClick={onClick} disabled={disabled}>
      {label}
    </button>
  )
}

/* ---------------------------------------------------------------- 학적 배지 */

export function StatusBadge({ status, crisis }: { status?: string | null; crisis?: boolean }) {
  return (
    <>
      {status && status !== '재학' && (
        <span className="ml-2 inline-flex h-5 items-center rounded px-1.5 align-middle text-xs font-medium text-ink" style={{ background: 'var(--raised)' }} title={`학적: ${status}`}>
          {status}
        </span>
      )}
      {crisis && (
        <span
          className="ml-1 inline-flex h-5 items-center rounded px-1.5 align-middle text-xs font-medium"
          style={{ background: 'color-mix(in srgb, var(--early) 12%, #fff)', color: 'var(--early)' }}
          title="위기관리학생"
        >
          위기관리
        </span>
      )}
    </>
  )
}
