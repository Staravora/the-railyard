# UK Proxy Worker (Cloudflare)

This Worker proxies UK live train data to avoid browser CORS issues and keep API keys off the frontend.

## Endpoints

- `GET /health`
- `GET /uk/trains`

`/uk/trains` returns a normalized shape expected by `js/providers/ukNetworkRailProvider.js`:

```json
{
  "source": "uk-networkrail",
  "updatedAt": "2026-02-27T18:30:00.000Z",
  "count": 123,
  "trains": [
    {
      "id": "1A23",
      "lat": 51.501,
      "lng": -0.123,
      "speedMph": 72,
      "speedKph": 116,
      "heading": 90,
      "trainNumber": "1A23",
      "routeName": "London Euston -> Manchester Piccadilly",
      "operator": "Avanti West Coast",
      "delayMinutes": 3,
      "nextStop": "Milton Keynes Central",
      "nextStopEta": "2026-02-27T18:39:00Z",
      "origin": "London Euston",
      "destination": "Manchester Piccadilly",
      "progress": 0.34,
      "updatedAt": "2026-02-27T18:29:57.000Z",
      "stops": []
    }
  ]
}
```

## Deploy

From this folder:

```bash
npm install -g wrangler
wrangler login
wrangler secret put NR_API_URL
wrangler secret put NR_API_KEY
wrangler secret put ALLOWED_ORIGIN
wrangler deploy
```

Notes:
- `NR_API_URL` is your upstream UK feed endpoint.
- `NR_API_KEY` is optional if your upstream is public.
- `ALLOWED_ORIGIN` should be your GitHub Pages URL, e.g. `https://staravora.github.io`.

## Frontend Wiring

Create `js/providerConfig.js` in the web app with:

```js
window.RAILYARD_PROVIDER_ENDPOINTS = {
  ukNetworkRail: 'https://<your-worker-subdomain>.workers.dev/uk/trains',
}
```

Load it before provider scripts in `index.html` if you want automatic activation.
