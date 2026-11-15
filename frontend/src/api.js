const unavailable = 'Сервис временно недоступен. Попробуй ещё раз.'

export async function request(path, { method = 'GET', body, signal, keepalive } = {}) {
  const response = await fetch(path, {
    method,
    signal,
    keepalive,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => { throw new Error(unavailable) })
  if (response.status === 204) return
  const data = await response.json().catch(() => null)
  if (!response.ok || data === null) {
    throw new Error(typeof data?.detail === 'string' ? data.detail : unavailable)
  }
  return data
}
