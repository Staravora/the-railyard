/**
 * getGermanyTrains — Firebase Cloud Function
 *
 * Fetches the gtfs.de free GTFS-RT VehiclePositions feed, parses the binary
 * protobuf, and returns JSON so the browser doesn't need CORS access to the
 * upstream binary endpoint.
 *
 * Deploy:
 *   firebase deploy --only functions
 */

const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');

const NSW_API_KEY = defineSecret('NSW_API_KEY');

// ---------------------------------------------------------------------------
// Minimal protobuf reader (no deps — same field numbers as GTFS-RT spec)
//
// FeedMessage:      header=1, entity=2 (repeated)
// FeedEntity:       id=1, vehicle=4
// VehiclePosition:  trip=1, position=3, timestamp=7
// TripDescriptor:   tripId=1, routeId=5
// Position:         latitude=1, longitude=2, bearing=3, speed=5  (all float32/wt5)
// ---------------------------------------------------------------------------

class ProtoReader {
  constructor(bytes) {
    this.b = bytes;
    this.pos = 0;
  }

  done() { return this.pos >= this.b.length; }

  readTag() {
    const v = this.readVarint();
    return [v >> 3, v & 0x7];
  }

  readVarint() {
    let v = 0, s = 0;
    while (this.pos < this.b.length) {
      const byte = this.b[this.pos++];
      v |= (byte & 0x7f) << s;
      if (!(byte & 0x80)) break;
      s += 7;
    }
    return v >>> 0;
  }

  readBytes() {
    const len = this.readVarint();
    const start = this.pos;
    this.pos += len;
    return this.b.subarray(start, this.pos);
  }

  readString() {
    const len = this.readVarint();
    const start = this.pos;
    this.pos += len;
    return Buffer.from(this.b.subarray(start, this.pos)).toString('utf8');
  }

  readFloat32() {
    const buf = Buffer.from(this.b.buffer, this.b.byteOffset + this.pos, 4);
    this.pos += 4;
    return buf.readFloatLE(0);
  }

  skip(wt) {
    if (wt === 0) this.readVarint();
    else if (wt === 1) this.pos += 8;
    else if (wt === 2) this.pos += this.readVarint();
    else if (wt === 5) this.pos += 4;
  }
}

function decodePosition(bytes) {
  const r = new ProtoReader(bytes);
  const pos = {};
  while (!r.done()) {
    const [fn, wt] = r.readTag();
    if (wt === 5) {
      const val = r.readFloat32();
      if (fn === 1) pos.latitude = val;
      else if (fn === 2) pos.longitude = val;
      else if (fn === 3) pos.bearing = val;
      else if (fn === 5) pos.speed = val;
    } else {
      r.skip(wt);
    }
  }
  return pos;
}

function decodeTrip(bytes) {
  const r = new ProtoReader(bytes);
  const trip = {};
  while (!r.done()) {
    const [fn, wt] = r.readTag();
    if (wt === 2) {
      const str = r.readString();
      if (fn === 1) trip.tripId = str;
      else if (fn === 5) trip.routeId = str;
    } else {
      r.skip(wt);
    }
  }
  return trip;
}

function decodeVehiclePosition(bytes) {
  const r = new ProtoReader(bytes);
  let trip = null, position = null, timestamp = 0;
  while (!r.done()) {
    const [fn, wt] = r.readTag();
    if      (fn === 1 && wt === 2) { trip = decodeTrip(r.readBytes()); }
    else if (fn === 3 && wt === 2) { position = decodePosition(r.readBytes()); }
    else if (fn === 7 && wt === 0) { timestamp = r.readVarint(); }
    else                           { r.skip(wt); }
  }

  if (!position?.latitude || !position?.longitude) return null;

  // DB routeIds typically look like "ICE 593" or "IC 2112"; tripIds are opaque numerics.
  const routeId = trip?.routeId || '';
  const tripId  = trip?.tripId  || '';

  // Extract a human-readable train number from routeId if it matches "TYPE NNN" pattern.
  const routeMatch = routeId.match(/^([A-Z]+)\s+(\d+)$/);
  const trainType   = routeMatch ? routeMatch[1] : null;
  const trainNumber = routeMatch ? routeMatch[2] : tripId.slice(0, 8);
  const routeName   = routeId || (trainType ? `${trainType} ${trainNumber}` : `Train ${trainNumber}`);

  return {
    trainNumber,
    routeId,
    tripId,
    routeName,
    lat: position.latitude,
    lng: position.longitude,
    speed: position.speed ?? 0,   // m/s — converted to mph in the browser provider
    bearing: position.bearing ?? 0,
    timestamp,
  };
}

function decodeEntity(bytes) {
  const r = new ProtoReader(bytes);
  let vehicle = null;
  while (!r.done()) {
    const [fn, wt] = r.readTag();
    if (fn === 4 && wt === 2) { vehicle = decodeVehiclePosition(r.readBytes()); }
    else                      { r.skip(wt); }
  }
  return vehicle;
}

function parseGtfsRt(buffer) {
  const bytes = new Uint8Array(buffer);
  const trains = [];
  try {
    const r = new ProtoReader(bytes);
    while (!r.done()) {
      const [fn, wt] = r.readTag();
      if (fn === 2 && wt === 2) {
        const train = decodeEntity(r.readBytes());
        if (train) trains.push(train);
      } else {
        r.skip(wt);
      }
    }
  } catch (err) {
    console.error('Germany GTFS-RT parse error:', err);
  }
  return trains;
}

// ---------------------------------------------------------------------------
// Cloud Functions
// ---------------------------------------------------------------------------

exports.getAustraliaTrains = onRequest(
  { region: 'us-central1', timeoutSeconds: 30, memory: '256MiB', secrets: [NSW_API_KEY] },
  async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }

    const apiKey = NSW_API_KEY.value();
    if (!apiKey) {
      res.status(503).json({ error: 'NSW_API_KEY not configured' });
      return;
    }

    try {
      const upstream = await fetch(
        'https://api.transport.nsw.gov.au/v1/gtfs-realtime/vehiclepos/train',
        { headers: { 'Authorization': `apikey ${apiKey}` } }
      );
      if (!upstream.ok) {
        const body = await upstream.text().catch(() => '');
        console.error(`NSW upstream ${upstream.status}:`, body.slice(0, 500));
        res.status(502).json({ error: `Upstream HTTP ${upstream.status}`, detail: body.slice(0, 200) });
        return;
      }

      const buffer = await upstream.arrayBuffer();
      const trains = parseGtfsRt(buffer);

      res.set('Cache-Control', 'public, max-age=10');
      res.status(200).json({ trains, fetchedAt: new Date().toISOString() });
    } catch (err) {
      console.error('getAustraliaTrains error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

exports.getGermanyTrains = onRequest(
  { region: 'us-central1', timeoutSeconds: 30, memory: '256MiB' },
  async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }

    try {
      const upstream = await fetch('https://realtime.gtfs.de/realtime-free.pb');
      if (!upstream.ok) {
        res.status(502).json({ error: `Upstream HTTP ${upstream.status}` });
        return;
      }

      const buffer = await upstream.arrayBuffer();
      const trains = parseGtfsRt(buffer);

      res.set('Cache-Control', 'public, max-age=10');
      res.status(200).json({ trains, fetchedAt: new Date().toISOString() });
    } catch (err) {
      console.error('getGermanyTrains error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);
