let csrf = ''
export const setCsrf = (value: string) => { csrf = value }
export async function uploadEvidence<T>(itemId: string, file: File, metadata: unknown): Promise<T> {
  const bytes = new TextEncoder().encode(JSON.stringify(metadata))
  const encoded = btoa(Array.from(bytes, b => String.fromCharCode(b)).join(''))
  const response = await fetch(`/api/v1/delivery-items/${itemId}/attachments`, { method: 'POST', credentials: 'same-origin',
    headers: { 'X-CSRF-Token': csrf, 'Content-Type': 'application/octet-stream', 'X-Evidence-Metadata': encoded, 'Idempotency-Key': crypto.randomUUID() }, body: file })
  const data = await response.json()
  if (!response.ok) throw new ApiError(data.code ?? 'NETWORK_ERROR')
  return data as T
}
export class ApiError extends Error {
  constructor(public code: string, public detail?: unknown) { super(code) }
}
export async function api<T>(path: string, options: { method?: string; body?: unknown; key?: string } = {}): Promise<T> {
  const form = options.body instanceof FormData
  const headers: Record<string, string> = { 'X-CSRF-Token': csrf }
  if (!form && options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (options.key) headers['Idempotency-Key'] = options.key
  let response: Response
  try {
    response = await fetch(`/api/v1${path}`, { method: options.method ?? 'GET', credentials: 'same-origin', headers,
      body: options.body === undefined ? undefined : form ? options.body as FormData : JSON.stringify(options.body) })
  } catch { throw new ApiError('NETWORK_ERROR') }
  const data = await response.json()
  if (!response.ok) {
    if (response.status === 401 && data.code === 'AUTH_REQUIRED') window.dispatchEvent(new Event('scope-session-expired'))
    throw new ApiError(data.code ?? 'JOB_FAILED', data.detail ?? data.fields)
  }
  return data as T
}
