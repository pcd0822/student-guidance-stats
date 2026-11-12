// 대시보드의 [링크 공유]·[다운로드]: 미인정 출결 현황을 담임 선생님과 나눈다.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Copy, Download, FileDown, Link2, RefreshCw, Search } from 'lucide-react'
import { toJpeg } from 'html-to-image'
import { useApp } from '@/context'
import { api, download, saveBlob } from '@/lib/api'
import { cn } from '@/lib/format'
import { fileTitle, pickQuery, scoreText, selectGroups, sums, type Group, type Pick, type ReportData, type Scope } from '@/lib/report'
import { ITEM_COLOR } from '@/lib/types'
import { Loading, Modal, MonthChips, Spinner } from './ui'

/* ---------------------------------------------------------------- 공통 조각 */

/** 제목 + 칩 묶음. ui.tsx 의 Field 는 <label> 이라 안의 첫 버튼이 눌리므로 div 로 둔다 */
function Row({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </div>
  )
}

function Seg<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: [T, string][]; label: string }) {
  return (
    <div className="inline-flex self-start rounded-lg border border-line bg-surface p-0.5" role="group" aria-label={label}>
      {options.map(([v, l]) => (
        <button
          key={v}
          type="button"
          aria-pressed={v === value}
          onClick={() => onChange(v)}
          className={cn('h-8 rounded-md px-3 text-sm font-medium transition-colors duration-150', v === value ? 'bg-raised text-ink-strong' : 'text-muted hover:text-ink-strong')}
        >
          {l}
        </button>
      ))}
    </div>
  )
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'h-7 min-w-[44px] rounded-md border px-2 text-xs font-medium num transition-colors duration-150',
        on ? 'border-accent bg-[color-mix(in_srgb,var(--accent)_8%,#fff)] text-accent-ink' : 'border-line bg-surface text-ink hover:bg-raised'
      )}
    >
      {children}
    </button>
  )
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // 앱 창(WebView)에서 clipboard API 가 막히면 옛 방식으로
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  }
}

/* ---------------------------------------------------------------- PDF 쪽 */

const PAGE_W = 1123 // A4 가로, 96dpi
const PER_PAGE = 7 // 학생 7명(28줄)씩 한 쪽

const cellBase: CSSProperties = { border: '1px solid #b8b2a7', padding: '3px 5px', textAlign: 'center', whiteSpace: 'nowrap' }

function PdfPage({ d, g, rows, title, sub, page }: { d: ReportData; g: Group; rows: Group['rows']; title: string; sub: string; page: string }) {
  const items = d.items
  return (
    <div style={{ width: PAGE_W, padding: '28px 32px', background: '#fff', color: '#1c1917', fontFamily: 'Pretendard, sans-serif', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
        <span style={{ fontSize: 17, fontWeight: 600 }}>{title}</span>
        <span style={{ fontSize: 11, color: '#6b6560' }}>{sub}</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#6b6560' }}>{page}</span>
      </div>
      <div style={{ fontSize: 10.5, color: '#6b6560', marginBottom: 8 }}>원자료 그대로이며 회색 칸은 제외 처리된 달입니다 · (서류 n) 서류로 확인한 횟수 · 제외 반영 환산은 생활지도 초기화를 반영하지 않습니다</div>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr style={{ background: '#efeae0', fontWeight: 500 }}>
            {['번호', '학번', '이름', '미인정', ...g.months.map((m) => `${m}월`), '합계', '제외 반영 환산'].map((h) => (
              <th key={h} style={{ ...cellBase, fontWeight: 500 }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        {rows.map((r) => {
          const { raw, doc } = sums(r, g.months, items.map((i) => i.key))
          return (
            <tbody key={r.student_id}>
              {items.map((it, i) => (
                <tr key={it.key} style={i === 0 ? { borderTop: '2px solid #8f887c' } : undefined}>
                  {i === 0 && (
                    <>
                      <td rowSpan={4} style={cellBase}>{r.number}</td>
                      <td rowSpan={4} style={cellBase}>{r.student_id}</td>
                      <td rowSpan={4} style={{ ...cellBase, textAlign: 'left', fontWeight: 500 }}>
                        {r.name}
                        {r.status && r.status !== '재학' && <span style={{ marginLeft: 4, fontSize: 10, color: '#6b6560' }}>({r.status})</span>}
                      </td>
                    </>
                  )}
                  <td style={{ ...cellBase, color: '#6b6560', fontSize: 11 }}>{it.label}</td>
                  {g.months.map((m) => {
                    const pm = r.months[String(m)]
                    const v = pm ? pm.raw[it.key] : 0
                    const dv = pm ? pm.doc[it.key] : 0
                    const ex = !!pm && (pm.all || dv > 0)
                    return (
                      <td key={m} style={{ ...cellBase, background: ex ? '#e7e5e4' : undefined, color: v ? (ex ? '#57534e' : '#1c1917') : '#a8a29e', fontWeight: v ? 600 : 400 }}>
                        {v ? (
                          <>
                            {!ex && <span style={{ display: 'inline-block', width: 3, height: 10, marginRight: 4, background: ITEM_COLOR[it.key], transform: 'skewX(-25deg)', verticalAlign: -1 }} />}
                            {v}
                            {!pm!.all && dv > 0 && <span style={{ fontWeight: 400, fontSize: 10, color: '#6b6560' }}> (서류 {dv})</span>}
                          </>
                        ) : (
                          '-'
                        )}
                      </td>
                    )
                  })}
                  <td style={{ ...cellBase, fontWeight: raw[it.key] ? 600 : 400, color: raw[it.key] ? '#1c1917' : '#a8a29e' }}>
                    {raw[it.key] || '-'}
                    {doc[it.key] > 0 && <span style={{ fontWeight: 400, fontSize: 10, color: '#6b6560' }}> (제외 {doc[it.key]})</span>}
                  </td>
                  {i === 0 && (
                    <td rowSpan={4} style={{ ...cellBase, fontWeight: 500 }}>
                      {scoreText(d, r, g.months)}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          )
        })}
      </table>
    </div>
  )
}

function pagesOf(d: ReportData, groups: Group[], p: Pick) {
  const out: { g: Group; rows: Group['rows']; title: string; sub: string }[] = []
  for (const g of groups) {
    const title = p.scope === 'student' ? `${g.rows[0].student_id} ${g.rows[0].name} 미인정 출결` : `${g.grade}학년 ${g.cls}반 미인정 출결`
    const span = g.months.length ? `${g.months[0]}월~${g.months[g.months.length - 1]}월` : ''
    const sub = [d.school_name, `${d.school_year}학년도`, span, `${d.generated_at} 기준`].filter(Boolean).join(' · ')
    for (let i = 0; i < g.rows.length; i += PER_PAGE) out.push({ g, rows: g.rows.slice(i, i + PER_PAGE), title, sub })
  }
  return out
}

/* ---------------------------------------------------------------- 다운로드 */

export function DownloadModal({ open, onClose, defaultGrade }: { open: boolean; onClose: () => void; defaultGrade: number }) {
  const { toast, year } = useApp()
  const [d, setD] = useState<ReportData | null>(null)
  const [p, setP] = useState<Pick>({ scope: 'class', grade: defaultGrade, cls: 0, sid: '', months: null })
  const [fmt, setFmt] = useState<'xlsx' | 'pdf'>('xlsx')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [render, setRender] = useState<ReturnType<typeof pagesOf> | null>(null)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    setD(null)
    api
      .get<ReportData>('/report', { school_year: year })
      .then(setD)
      .catch((e) => toast(e.message, 'error'))
  }, [open, year, toast])

  const grades = useMemo(() => (d ? Object.keys(d.grades).map(Number).sort() : []), [d])
  const classes = useMemo(() => (d ? [...new Set(d.students.filter((r) => r.grade === p.grade).map((r) => r.class))].sort((a, b) => a - b) : []), [d, p.grade])
  useEffect(() => {
    if (!d) return
    if (p.scope !== 'all' && !grades.includes(p.grade) && grades.length) setP((x) => ({ ...x, grade: grades[0] }))
  }, [d, grades, p.scope, p.grade])
  useEffect(() => {
    if (p.scope === 'class' && classes.length && !classes.includes(p.cls)) setP((x) => ({ ...x, cls: classes[0] }))
  }, [classes, p.scope, p.cls])

  const stu = d?.students.find((r) => r.student_id === p.sid)
  const hits = useMemo(() => {
    const s = q.trim()
    if (!d || !s) return []
    return d.students.filter((r) => r.student_id.includes(s) || (r.name || '').includes(s)).slice(0, 24)
  }, [d, q])
  const monthGrade = p.scope === 'student' ? stu?.grade ?? 0 : p.grade
  const availMonths = useMemo(() => {
    if (!d) return []
    const gs = p.scope === 'all' && !p.grade ? grades : [monthGrade]
    return [...new Set(gs.flatMap((g) => d.grades[String(g)] || []))]
  }, [d, p.scope, p.grade, grades, monthGrade])
  const groups = d ? selectGroups(d, p) : []
  const ready = !!d && (p.scope !== 'student' || !!p.sid) && (p.scope !== 'class' || !!p.cls)
  const count = groups.reduce((n, g) => n + g.rows.length, 0)

  const setScope = (scope: Scope) => setP((x) => ({ ...x, scope, months: null, grade: scope === 'all' ? x.grade : x.grade || grades[0] || 0 }))

  const go = async () => {
    if (!d) return
    setBusy(true)
    try {
      if (fmt === 'xlsx') {
        const r = await download(`/report.xlsx?${new URLSearchParams({ ...pickQuery(p), school_year: String(year) })}`, `${fileTitle(d, p)}.xlsx`)
        if (r) toast(`저장했습니다: ${r}`)
        return
      }
      const pages = pagesOf(d, groups, p)
      setRender(pages)
      await new Promise((r) => setTimeout(r, 80)) // 화면에 그려질 때까지
      const nodes = Array.from(box.current?.children || []) as HTMLElement[]
      const { jsPDF } = await import('jspdf')
      const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' })
      for (let i = 0; i < nodes.length; i++) {
        const url = await toJpeg(nodes[i], { pixelRatio: 2, quality: 0.92, backgroundColor: '#ffffff', cacheBust: true })
        let w = 281
        let h = (nodes[i].offsetHeight / nodes[i].offsetWidth) * w
        if (h > 194) {
          w = (w * 194) / h
          h = 194
        }
        if (i) pdf.addPage()
        pdf.addImage(url, 'JPEG', (297 - w) / 2, 8, w, h)
      }
      const r = await saveBlob(pdf.output('blob'), `${fileTitle(d, p)}.pdf`)
      if (r) toast(`저장했습니다: ${r}`)
    } catch (e: any) {
      toast(e.message || String(e), 'error')
    } finally {
      setRender(null)
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="미인정 내역 내려받기"
      width={640}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            닫기
          </button>
          <button className="btn btn-primary" disabled={!ready || !count || busy} onClick={go}>
            {busy ? <Spinner /> : <Download size={16} />} 내려받기
          </button>
        </>
      }
    >
      {!d ? (
        <Loading />
      ) : !d.students.length ? (
        <p className="py-6 text-center text-sm text-muted">아직 올린 자료가 없습니다.</p>
      ) : (
        <div className="flex flex-col gap-4">
          <Row label="범위">
            <Seg<Scope> label="범위" value={p.scope} onChange={setScope} options={[['student', '학생 한 명'], ['class', '학급'], ['all', '전체']]} />
          </Row>
          {p.scope !== 'student' && (
            <Row label="학년">
              <div className="flex flex-wrap gap-2">
                {p.scope === 'all' && (
                  <Chip on={!p.grade} onClick={() => setP({ ...p, grade: 0, months: null })}>
                    모든 학년
                  </Chip>
                )}
                {grades.map((g) => (
                  <Chip key={g} on={p.grade === g} onClick={() => setP({ ...p, grade: g, months: null })}>
                    {g}학년
                  </Chip>
                ))}
              </div>
            </Row>
          )}
          {p.scope === 'class' && (
            <Row label="반">
              <div className="flex flex-wrap gap-2">
                {classes.length ? (
                  classes.map((c) => (
                    <Chip key={c} on={p.cls === c} onClick={() => setP({ ...p, cls: c })}>
                      {c}반
                    </Chip>
                  ))
                ) : (
                  <span className="text-xs text-muted">이 학년에 미인정이 있는 학생이 없습니다</span>
                )}
              </div>
            </Row>
          )}
          {p.scope === 'student' && (
            <Row label="학생" hint={stu ? `고른 학생: ${stu.student_id} ${stu.name}` : '학번이나 이름을 넣고 고르십시오'}>
              <div className="relative">
                <Search size={16} className="pointer-events-none absolute left-3 top-2.5 text-faint" />
                <input className="field w-full pl-9" placeholder="학번·이름 검색" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
              </div>
              {hits.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {hits.map((r) => (
                    <Chip key={r.student_id} on={p.sid === r.student_id} onClick={() => setP({ ...p, sid: r.student_id, months: null })}>
                      {r.student_id} {r.name}
                    </Chip>
                  ))}
                </div>
              )}
            </Row>
          )}
          <Row label="달" hint={p.months ? undefined : '자료가 있는 모든 달입니다'}>
            <MonthChips start={d.start_month} available={availMonths} value={p.months ?? availMonths} onChange={(ms) => setP({ ...p, months: ms.length === availMonths.length ? null : ms })} />
          </Row>
          <Row label="형식">
            <Seg<'xlsx' | 'pdf'> label="형식" value={fmt} onChange={setFmt} options={[['xlsx', '엑셀 (xlsx)'], ['pdf', 'PDF']]} />
          </Row>
          <p className="text-xs text-muted">
            {ready ? `${groups.length}개 학급 · ${count}명` : '조건을 고르십시오'} · 원자료 그대로이며 제외 처리된 달은 회색으로 표시합니다.{fmt === 'pdf' && ' PDF 는 A4 가로, 반마다 쪽을 나눕니다.'}
          </p>
        </div>
      )}
      {render &&
        createPortal(
          <div ref={box} aria-hidden style={{ position: 'fixed', left: -20000, top: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {render.map((pg, i) => (
              <PdfPage key={i} d={d!} g={pg.g} rows={pg.rows} title={pg.title} sub={pg.sub} page={`${i + 1} / ${render.length}`} />
            ))}
          </div>,
          document.body
        )}
    </Modal>
  )
}

/* ---------------------------------------------------------------- 링크 공유 */

interface ShareStatus {
  enabled: boolean
  running: boolean
  port: number
  urls: string[]
  error?: string | null
}

export function ShareModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast, confirm, year } = useApp()
  const [mode, setMode] = useState<'lan' | 'file'>('lan')
  const [st, setSt] = useState<ShareStatus | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    api
      .get<ShareStatus>('/share')
      .then(setSt)
      .catch((e) => toast(e.message, 'error'))
  }, [open, toast])

  const act = async (action: 'enable' | 'disable' | 'rotate') => {
    if (action === 'rotate' && !(await confirm({ title: '새 주소를 만들까요?', body: '지금 주소는 바로 열리지 않게 됩니다. 담임 선생님들께 새 주소를 다시 보내야 합니다.', ok: '새 주소 만들기' }))) return
    setBusy(true)
    try {
      const s = await api.post<ShareStatus>('/share', { action })
      setSt(s)
      if (action === 'enable') toast(s.running ? '링크 공유를 켰습니다' : '공유 서버를 열지 못했습니다', s.running ? 'ok' : 'error')
      if (action === 'disable') toast('링크 공유를 껐습니다')
      if (action === 'rotate') toast('새 주소를 만들었습니다')
    } catch (e: any) {
      toast(e.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const copy = async (u: string) => (await copyText(u)) ? toast('주소를 복사했습니다') : toast('복사하지 못했습니다. 주소 칸을 눌러 직접 복사하십시오', 'warn')

  const saveFile = async () => {
    setBusy(true)
    try {
      const r = await download(`/share/file?school_year=${year}`, '미인정출결_공유.html')
      if (r) toast(`저장했습니다: ${r}`)
    } catch (e: any) {
      toast(e.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="담임 선생님과 미인정 내역 공유" width={600} footer={<button className="btn btn-secondary" onClick={onClose}>닫기</button>}>
      <div className="flex flex-col gap-4">
        <Seg<'lan' | 'file'> label="공유 방식" value={mode} onChange={setMode} options={[['lan', '교내망 링크'], ['file', '공유 파일']]} />
        {mode === 'lan' ? (
          !st ? (
            <Loading />
          ) : !st.enabled ? (
            <div className="flex flex-col gap-3 text-sm">
              <p>
                링크를 켜면 같은 학교망의 다른 컴퓨터에서 브라우저로 <b className="font-semibold text-ink-strong">보기 전용 현황 화면</b>을 엽니다. 담임 선생님이 학년·반·학생·달 칩으로 직접 골라 보고 인쇄·엑셀로 받을 수 있습니다.
              </p>
              <ul className="list-disc pl-5 text-xs text-muted">
                <li>이 컴퓨터에서 앱이 켜져 있을 때만 열립니다. 자료를 새로 올리면 담임 화면도 최신으로 바뀝니다.</li>
                <li>처음 켤 때 윈도우 방화벽 창이 뜨면 「액세스 허용」을 누르십시오. 허용이 안 되면 다른 컴퓨터에서 열리지 않으니 「공유 파일」을 쓰십시오.</li>
                <li>설정·제외·회의록 같은 다른 기능은 링크로 열리지 않습니다. 자료는 학교망 밖으로 나가지 않습니다.</li>
              </ul>
              <div>
                <button className="btn btn-primary" disabled={busy} onClick={() => act('enable')}>
                  {busy ? <Spinner /> : <Link2 size={16} />} 링크 공유 켜기
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3 text-sm">
              {!st.running ? (
                <p className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'color-mix(in srgb, var(--absent) 40%, #fff)', color: 'var(--absent)' }}>
                  공유 서버를 열지 못했습니다{st.error ? ` (${st.error})` : ''}. 「공유 끄기」 뒤 다시 켜거나 「공유 파일」을 쓰십시오.
                </p>
              ) : !st.urls.length ? (
                <p className="text-sm text-muted">이 컴퓨터의 학교망 주소를 찾지 못했습니다. 인터넷 연결을 확인하십시오.</p>
              ) : (
                <>
                  <p className="text-xs text-muted">아래 주소를 메신저로 담임 선생님께 보내십시오. 주소가 여러 개면 보통 첫 번째가 학교망 주소입니다.</p>
                  {st.urls.map((u) => (
                    <div key={u} className="flex items-center gap-2">
                      <input className="field flex-1 num text-xs" readOnly value={u} onFocus={(e) => e.target.select()} />
                      <button className="btn btn-secondary" onClick={() => copy(u)}>
                        <Copy size={16} /> 복사
                      </button>
                    </div>
                  ))}
                </>
              )}
              <p className="text-xs text-muted">앱이 켜져 있는 동안만 열립니다. 방화벽 때문에 다른 컴퓨터에서 안 열리면 「공유 파일」을 쓰십시오.</p>
              <div className="flex gap-2">
                <button className="btn btn-secondary" disabled={busy} onClick={() => act('rotate')}>
                  <RefreshCw size={16} /> 새 주소 만들기
                </button>
                <button className="btn btn-danger" disabled={busy} onClick={() => act('disable')}>
                  공유 끄기
                </button>
              </div>
            </div>
          )
        ) : (
          <div className="flex flex-col gap-3 text-sm">
            <p>
              지금 자료를 담은 <b className="font-semibold text-ink-strong">HTML 파일 하나</b>를 만듭니다. 메신저로 보내면 받은 선생님이 두 번 눌러 브라우저로 엽니다. 학년·반·학생·달 칩이 그대로 작동하고 인쇄·PDF 로 저장할 수 있습니다.
            </p>
            <ul className="list-disc pl-5 text-xs text-muted">
              <li>이 컴퓨터가 꺼져 있어도 열립니다. 대신 만든 때의 사본이라, 자료를 새로 올리면 다시 보내야 합니다.</li>
              <li>받은 컴퓨터에 학생 이름이 든 사본이 남습니다. 필요한 분께만 보내십시오.</li>
            </ul>
            <div>
              <button className="btn btn-primary" disabled={busy} onClick={saveFile}>
                {busy ? <Spinner /> : <FileDown size={16} />} 공유 파일 내려받기
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
