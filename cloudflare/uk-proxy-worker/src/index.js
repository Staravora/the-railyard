/**
 * Cloudflare Worker: UK rail proxy adapter
 *
 * Exposes:
 * - GET /health
 * - GET /uk/trains
 *
 * Required env:
 * - NR_API_URL: upstream Network Rail-compatible endpoint
 *
 * Optional env:
 * - NR_API_KEY
 * - NR_AUTH_HEADER (defaults to "Authorization")
 * - NR_AUTH_SCHEME (defaults to "Bearer")
 * - ALLOWED_ORIGIN (defaults to "*")
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env, request) })
    }

    if (url.pathname === '/health') {
      return json(
        {
          ok: true,
          service: 'uk-proxy-worker',
          timestamp: new Date().toISOString(),
        },
        200,
        env,
        request,
      )
    }

    if (url.pathname === '/uk/trains') {
      try {
        const payload = await fetchUkFeed(env)
        const trains = normalizeUkPayload(payload)

        return json(
          {
            source: 'uk-networkrail',
            updatedAt: new Date().toISOString(),
            trains,
            count: trains.length,
          },
          200,
          env,
          request,
          { 'Cache-Control': 'public, max-age=5' },
        )
      } catch (err) {
        return json(
          {
            ok: false,
            error: err instanceof Error ? err.message : 'Unknown proxy error',
          },
          502,
          env,
          request,
        )
      }
    }

    return json({ ok: false, error: 'Not found' }, 404, env, request)
  },
}

async function fetchUkFeed(env) {
  if (!env.NR_API_URL) {
    throw new Error('Missing NR_API_URL')
  }

  const headers = {
    Accept: 'application/json',
    'User-Agent': 'TheRailyardProxy/1.0',
  }

  if (env.NR_API_KEY) {
    const headerName = env.NR_AUTH_HEADER || 'Authorization'
    const scheme = env.NR_AUTH_SCHEME || 'Bearer'
    headers[headerName] = scheme ? `${scheme} ${env.NR_API_KEY}` : env.NR_API_KEY
  }

  const res = await fetch(env.NR_API_URL, {
    method: 'GET',
    headers,
    cf: { cacheTtl: 5, cacheEverything: false },
  })

  if (!res.ok) {
    throw new Error(`Upstream HTTP ${res.status}`)
  }

  return res.json()
}

function normalizeUkPayload(payload) {
  const rows = Array.isArray(payload?.trains)
    ? payload.trains
    : Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.data)
        ? payload.data
        : []

  return rows
    .map((row, idx) => normalizeRow(row, idx))
    .filter(Boolean)
}

function normalizeRow(row, idx) {
  if (!row || typeof row !== 'object') return null

  const lat = toNumber(row.lat ?? row.latitude ?? row.currentLat)
  const lng = toNumber(row.lng ?? row.lon ?? row.longitude ?? row.currentLng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null

  const speedKph = toNumber(row.speedKph ?? row.speed_kph ?? row.speed)
  const speedMphRaw = toNumber(row.speedMph ?? row.speed_mph)
  const speedMph = Number.isFinite(speedMphRaw)
    ? Math.max(0, Math.round(speedMphRaw))
    : Number.isFinite(speedKph)
      ? Math.max(0, Math.round(speedKph * 0.621371))
      : 0

  const progressRaw = toNumber(row.progress ?? row.routeProgress)
  const progress = Number.isFinite(progressRaw)
    ? Math.max(0, Math.min(1, progressRaw > 1 ? progressRaw / 100 : progressRaw))
    : 0

  const delayRaw = toNumber(row.delayMinutes ?? row.delay ?? row.lateBy)

  return {
    id: String(row.id ?? row.trainId ?? row.uid ?? row.trainNumber ?? `uk-${idx}`),
    lat,
    lng,
    speedMph,
    speedKph: Number.isFinite(speedKph) ? Math.round(speedKph) : Math.round(speedMph / 0.621371),
    heading: normalizeHeading(row.heading ?? row.bearing ?? 0),
    trainNumber: String(row.trainNumber ?? row.headcode ?? row.uid ?? '?'),
    routeName: String(row.routeName ?? row.serviceName ?? row.route ?? 'UK Rail Service'),
    operator: String(row.operator ?? row.toc ?? row.company ?? 'National Rail'),
    delayMinutes: Number.isFinite(delayRaw) ? Math.round(delayRaw) : 0,
    nextStop: row.nextStop ?? row.next_station ?? null,
    nextStopEta: row.nextStopEta ?? row.next_stop_eta ?? row.eta ?? null,
    origin: row.origin ?? row.from ?? null,
    destination: row.destination ?? row.to ?? null,
    progress,
    updatedAt: row.updatedAt ?? row.timestamp ?? new Date().toISOString(),
    stops: Array.isArray(row.stops) ? row.stops : [],
  }
}

function toNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : NaN
}

function normalizeHeading(value) {
  const h = Number(value) || 0
  return ((h % 360) + 360) % 360
}

function json(body, status, env, request, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(env, request),
      ...extraHeaders,
    },
  })
}

function corsHeaders(env, request) {
  const allowedOrigin = env.ALLOWED_ORIGIN || '*'
  const reqOrigin = request.headers.get('Origin')

  const origin = allowedOrigin === '*' ? '*' : (reqOrigin && reqOrigin === allowedOrigin ? reqOrigin : allowedOrigin)

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }
}
