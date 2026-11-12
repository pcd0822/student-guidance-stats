import { useEffect, useRef, useState } from 'react'
import { FileDown, Image as ImageIcon, Printer, Search, Sheet, UserRound } from 'lucide-react'
import { toPng } from 'html-to-image'
import { useApp } from '@/context'
import { api, printPdf, saveBlob } from '@/lib/api'
import { cn, normalizeId } from '@/lib/format'
import { monthsLabel } from '@/lib/months'
import type { Personal } from '@/lib/types'
import { ITEM_LABEL, ITEMS } from '@/lib/types'
import { Card, CountCell, Empty, Legend, Loading, PageTitle, Spinner, StageBadge, StatusBadge } from '@/components/ui'

export default function PersonalPage() {
  const { params, year, toast, version } = useApp()
  const [q, setQ] = useState(params.sid || '')
  const [sid, setSid] = useState(params.sid || '')
  const [data, setData] = useState<Personal | null>(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (params.sid) {
      setQ(params.sid)
      setSid(params.sid)
    }
  }, [params.sid])

  useEffect(() => {
    if (!sid) return
    setErr('')
    setLoading(true)
    api
      .get<Personal>(`/personal/${sid}`, { school_year: year })
      .then(setData)
      .catch((e) => {
        setData(null)
        setErr(e.message)
      })
      .finally(() => setLoading(false))
  }, [sid, year, version])

  const base = data ? `${year}학년도_개인별통계_${data.student_id}_${data.name}` : ''

  const csv = async () => {
    if (!data) return
    const head = ['월', ...ITEMS.map((k) => `미인정 ${ITEM_LABEL[k]}`), ...ITEMS.map((k) => `서류 제외 ${ITEM_LABEL[k]}`), '누적 반영', '누적 점수', '이월', '비고']
    const lines = [head]
    for (const pm of data.months) {
      lines.push([
        `${pm.month}월`,
        ...ITEMS.map((k) => String(pm.raw[k])),
        ...ITEMS.map((k) => String(pm.doc[k])),
        pm.counted && !pm.all_excluded ? 'O' : 'X',
        String(pm.cum_score ?? ''),
        String(pm.cum_carry ?? ''),
        [pm.all_excluded ? '전체 제외' : '', pm.reasons.join('/'), pm.counted ? '' : '생활지도로 초기화'].filter(Boolean).join(' '),
      ])
    }
    lines.push([])
    lines.push(['생활지도 이력'])
    for (const g of data.guidance) lines.push([`${g.step}차`, g.month ? `${g.month}월` : '', g.date || '', g.measure || ''])
    const text = '﻿' + lines.map((l) => l.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\r\n')
    await done(saveBlob(new Blob([text], { type: 'text/csv;charset=utf-8' }), `${base}.csv`))
  }

  const png = async () => {
    if (!ref.current) return null
    return toPng(ref.current, { pixelRatio: 2, backgroundColor: '#ffffff', cacheBust: true })
  }

  const done = async (p: Promise<string | null>) => {
    try {
      const r = await p
      if (r) toast(`저장했습니다: ${r}`)
    } catch (e: any) {
      toast(e.message || String(e), 'error')
    }
  }

  const savePng = async () => {
    setBusy(true)
    try {
      const url = await png()
      if (url) await done(saveBlob(await (await fetch(url)).blob(), `${base}.png`))
    } finally {
      setBusy(false)
    }
  }

  const makePdf = async () => {
    const url = await png()
    if (!url || !ref.current) return null
    const { jsPDF } = await import('jspdf')
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
    const w = 190
    const h = (ref.current.offsetHeight / ref.current.offsetWidth) * w
    pdf.addImage(url, 'PNG', 10, 10, w, Math.min(h, 277))
    return pdf.output('blob')
  }

  const savePdf = async () => {
    setBusy(true)
    try {
      const b = await makePdf()
      if (b) await done(saveBlob(b, `${base}.pdf`))
    } finally {
      setBusy(false)
    }
  }

  const print = async () => {
    setBusy(true)
    try {
      const b = await makePdf()
      if (b && (await printPdf(b, `${base}.pdf`))) toast('PDF 를 열었습니다. 열린 창에서 인쇄하십시오')
      else window.print()
    } catch (e: any) {
      toast(e.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageTitle
        icon={UserRound}
        title="개인별 통계"
        sub="월별 미인정 4종과 환산 누적, 제외된 달, 생활지도 이력을 봅니다"
        right={
          data && (
            <div className="no-print flex gap-2">
              {busy && <Spinner />}
              <button className="btn btn-secondary btn-sm" onClick={csv}>
                <Sheet size={14} /> CSV
              </button>
              <button className="btn btn-secondary btn-sm" onClick={savePng} disabled={busy}>
                <ImageIcon size={14} /> PNG
              </button>
              <button className="btn btn-secondary btn-sm" onClick={savePdf} disabled={busy}>
                <FileDown size={14} /> PDF
              </button>
              <button className="btn btn-secondary btn-sm" onClick={print} disabled={busy}>
                <Printer size={14} /> 인쇄
              </button>
            </div>
          )
        }
      />
      <form
        className="no-print flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          setSid(normalizeId(q))
        }}
      >
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute left-3 top-2.5 text-faint" />
          <input className="field w-56 pl-9 num" placeholder="학번 (예: 30206)" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <button className="btn btn-primary">조회</button>
      </form>

      {err && <p className="text-sm text-absent">{err}</p>}
      {loading && !data && (
        <div className="card">
          <Loading />
        </div>
      )}
      {!data && !err && !loading && (
        <div className="card">
          <Empty icon={UserRound} title="학번을 입력하십시오" sub="대시보드에서 이름을 눌러도 이 화면으로 옵니다." />
        </div>
      )}
      {data && (
        <div ref={ref} className="flex flex-col gap-4 bg-paper">
          <div className="card flex flex-wrap items-center justify-between gap-4 px-5 py-4">
            <div>
              <p className="num text-xs text-muted">
                {year}학년도 · {data.grade}학년 {data.class}반 {data.number}번 · {data.student_id}
              </p>
              <p className="text-xl font-semibold text-ink-strong">
                {data.name}
                <StatusBadge status={data.roster?.status} crisis={data.roster?.crisis} />
              </p>
              {data.roster?.status && data.roster.status !== '재학' && (
                <p className="text-xs text-muted">
                  학적: {data.roster.status}
                  {data.roster.status_date ? ` (${data.roster.status_date})` : ''}
                </p>
              )}
            </div>
            <div className="flex items-end gap-8">
              <div>
                <p className="label">지금 누적 (제외·초기화 반영)</p>
                <p className="num">
                  <span className={cn('text-2xl font-medium', data.is_target ? 'text-absent' : 'text-ink-strong')}>{data.score}점</span>
                  {data.carry > 0 && <span className="ml-2 text-sm text-muted">이월 {data.carry}회</span>}
                </p>
              </div>
              <div>
                <p className="label">원자료 합계</p>
                <p className="num text-base text-ink">
                  {data.raw_score}점{data.raw_carry > 0 && ` · 이월 ${data.raw_carry}회`}
                </p>
              </div>
              <div>
                <p className="label">{data.is_target ? '대상 단계' : '다음 지도 단계'}</p>
                <StageBadge stage={data.next_stage} />
              </div>
            </div>
          </div>

          <Card title="월별 미인정 내역" right={<Legend />} pad={false}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>월</th>
                  {ITEMS.map((k) => (
                    <th key={k}>미인정 {ITEM_LABEL[k]}</th>
                  ))}
                  <th className="r">누적 점수</th>
                  <th className="r">이월</th>
                  <th>비고</th>
                </tr>
              </thead>
              <tbody>
                {data.months.map((pm) => {
                  const off = pm.all_excluded || !pm.counted
                  return (
                    <tr key={pm.month}>
                      <td className={cn('num font-medium', off ? 'text-excused line-through' : 'text-ink-strong')}>{pm.month}월</td>
                      {ITEMS.map((k) => (
                        <td key={k}>
                          <CountCell item={k} value={pm.raw[k]} doc={pm.all_excluded ? 0 : pm.doc[k]} excluded={off} />
                        </td>
                      ))}
                      <td className="r num text-ink-strong">{pm.cum_score}</td>
                      <td className="r num text-muted">{pm.cum_carry ? `${pm.cum_carry}회` : '–'}</td>
                      <td className="text-xs text-muted">
                        {pm.all_excluded && <span>전체 제외 · {pm.reasons.join(', ')}</span>}
                        {!pm.all_excluded && pm.reasons.length > 0 && <span>서류 제외 · {pm.reasons.join(', ')}</span>}
                        {!pm.counted && <span>{pm.all_excluded || pm.reasons.length ? ' · ' : ''}생활지도로 초기화</span>}
                      </td>
                    </tr>
                  )
                })}
                <tr>
                  <td className="font-medium text-ink-strong">합계</td>
                  {ITEMS.map((k) => (
                    <td key={k} className="num">
                      {data.raw[k]}
                      {data.eff[k] !== data.raw[k] && <span className="ml-1 text-xs text-muted">(반영 {data.eff[k]})</span>}
                    </td>
                  ))}
                  <td className="r num font-medium text-ink-strong">{data.score}</td>
                  <td className="r num text-muted">{data.carry ? `${data.carry}회` : '–'}</td>
                  <td className="text-xs text-muted">{data.count_from && data.count_from > 0 ? `${data.count_from}월부터 다시 셈` : ''}</td>
                </tr>
              </tbody>
            </table>
            <p className="border-t border-line px-5 py-3 text-xs text-muted">
              자료가 있는 달: {monthsLabel(data.months.map((m) => m.month))}. 결석일수·질병·기타·인정 출결은 누적에 넣지 않습니다.
            </p>
          </Card>

          <Card title="생활지도 이력">
            {data.guidance.length === 0 ? (
              <p className="text-sm text-muted">생활지도 기록이 없습니다.</p>
            ) : (
              <ol className="flex flex-col gap-2">
                {data.guidance.map((g) => (
                  <li key={g.id} className="flex items-center gap-3 text-sm">
                    <span className="num w-12 text-muted">{g.month ? `${g.month}월` : '–'}</span>
                    <span className="w-14 font-medium text-ink-strong">{g.step}차</span>
                    <span className="num w-28 text-xs text-muted">{g.date}</span>
                    <span className="text-ink">{g.measure}</span>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      )}
    </div>
  )
}
