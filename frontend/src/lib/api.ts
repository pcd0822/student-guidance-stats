export class ApiError extends Error {
  status: number
  data: any
  constructor(message: string, status: number, data?: any) {
    super(message)
    this.status = status
    this.data = data
  }
}

function qs(params?: Record<string, any>) {
  if (!params) return ''
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue
    p.set(k, String(v))
  }
  const s = p.toString()
  return s ? `?${s}` : ''
}

async function handle<T>(r: Response): Promise<T> {
  if (!r.ok) {
    let msg = `요청을 처리하지 못했습니다 (${r.status})`
    let data: any
    try {
      const j = await r.json()
      if (j.detail) msg = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail)
      data = j.data
    } catch {
      /* 본문 없음 */
    }
    throw new ApiError(msg, r.status, data)
  }
  return r.json()
}

export const api = {
  get: <T>(path: string, params?: Record<string, any>) => fetch(`/api${path}${qs(params)}`).then((r) => handle<T>(r)),
  post: <T>(path: string, body?: any) =>
    fetch(`/api${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) }).then((r) =>
      handle<T>(r)
    ),
  put: <T>(path: string, body?: any) =>
    fetch(`/api${path}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) }).then((r) =>
      handle<T>(r)
    ),
  del: <T>(path: string) => fetch(`/api${path}`, { method: 'DELETE' }).then((r) => handle<T>(r)),
  upload: <T>(path: string, file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return fetch(`/api${path}`, { method: 'POST', body: fd }).then((r) => handle<T>(r))
  },
}

declare global {
  interface Window {
    pywebview?: { api?: { save_file?: (name: string, b64: string) => Promise<any>; open_temp?: (name: string, b64: string) => Promise<any> } }
  }
}

function blobToBase64(b: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const fr = new FileReader()
    fr.onload = () => res(String(fr.result).split(',')[1] || '')
    fr.onerror = rej
    fr.readAsDataURL(b)
  })
}

/** 파일 저장. 앱 창(pywebview)이면 저장 대화상자, 브라우저면 내려받기. 저장한 경로(알면)를 돌려준다. */
export async function saveBlob(blob: Blob, filename: string): Promise<string | null> {
  const pv = window.pywebview?.api
  if (pv?.save_file) {
    const r = await pv.save_file(filename, await blobToBase64(blob))
    if (r?.cancelled) return null
    if (!r?.ok) throw new Error(r?.error || '저장하지 못했습니다')
    return r.path as string
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
  return filename
}

/** 인쇄: 앱 창이면 PDF 를 기본 프로그램으로 열고, 브라우저면 window.print */
export async function printPdf(blob: Blob, filename: string) {
  const pv = window.pywebview?.api
  if (pv?.open_temp) {
    await pv.open_temp(filename, await blobToBase64(blob))
    return true
  }
  return false
}

function filenameFrom(r: Response, fallback: string) {
  const cd = r.headers.get('content-disposition') || ''
  const m = /filename\*=UTF-8''([^;]+)/i.exec(cd)
  return m ? decodeURIComponent(m[1]) : fallback
}

export async function download(path: string, fallback: string, init?: RequestInit) {
  const r = await fetch(`/api${path}`, init)
  if (!r.ok) await handle(r)
  const blob = await r.blob()
  return saveBlob(blob, filenameFrom(r, fallback))
}
