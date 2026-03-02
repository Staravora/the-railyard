/**
 * malaysiaProvider.js — Adapter for KTM Berhad (Malaysia national railway).
 *
 * Data source: Malaysia Open Government Data GTFS-RT
 *   https://api.data.gov.my/gtfs-realtime/vehicle-position/ktmb/
 *
 * No API key required. CORS open. Direct browser fetch.
 *
 * KTMB quirks vs. standard GTFS-RT spec:
 *   - Position is at VehiclePosition field 2 (standard = field 3)
 *   - Timestamp is at VehiclePosition field 5 (standard = field 7)
 *   - Position fields themselves are standard: lat=1, lng=2, bearing=3, speed=5
 */

const MalaysiaProvider = (() => {
  const KTMB_URL = 'https://api.data.gov.my/gtfs-realtime/vehicle-position/ktmb/';

  function normalizeHeading(v) {
    const h = Number(v) || 0;
    return ((h % 360) + 360) % 360;
  }

  function toMph(mps) {
    return mps == null ? 0 : Math.round(Number(mps) * 2.23694);
  }

  // ---------------------------------------------------------------------------
  // ProtoReader — same pattern as finlandProvider, no shared closure state
  // ---------------------------------------------------------------------------

  class ProtoReader {
    constructor(bytes) { this.b = bytes; this.pos = 0; }
    done() { return this.pos >= this.b.length; }
    readTag() { const v = this.readVarint(); return [v >> 3, v & 0x7]; }
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
      return new TextDecoder().decode(this.b.subarray(start, this.pos));
    }
    readFloat32() {
      const view = new DataView(this.b.buffer, this.b.byteOffset + this.pos, 4);
      this.pos += 4;
      return view.getFloat32(0, true);
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
      if (fn === 1 && wt === 2) {
        trip = decodeTrip(r.readBytes());
      } else if ((fn === 2 || fn === 3) && wt === 2) {
        // KTMB puts Position at field 2; standard GTFS-RT uses field 3.
        // Accept whichever comes first with a valid lat/lng.
        const decoded = decodePosition(r.readBytes());
        if (decoded.latitude && !position) position = decoded;
      } else if ((fn === 5 || fn === 7) && wt === 0) {
        // KTMB uses field 5 for timestamp; standard GTFS-RT uses field 7.
        const v = r.readVarint();
        if (!timestamp) timestamp = v;
      } else {
        r.skip(wt);
      }
    }

    if (!position?.latitude || !position?.longitude) return null;

    // Trip IDs are like "weekday_2008" — extract the numeric suffix
    const tripId = trip?.tripId || '';
    const numMatch = tripId.match(/(\d+)$/);
    const trainNumber = numMatch ? numMatch[1] : (tripId.slice(0, 8) || '?');

    return {
      id: `malaysia:${tripId || trainNumber}`,
      externalId: tripId,
      provider: 'malaysia',
      providerLabel: 'KTM (Malaysia)',
      country: 'MY',
      operator: 'KTMB',
      trainNumber,
      routeName: `KTM ${trainNumber}`,
      lat: position.latitude,
      lng: position.longitude,
      speed: toMph(position.speed),
      heading: normalizeHeading(position.bearing),
      delayMinutes: 0,
      nextStop: null,
      nextStopEta: null,
      origin: null,
      destination: null,
      progress: 0,
      stops: [],
      updatedAt: timestamp
        ? new Date(timestamp * 1000).toISOString()
        : new Date().toISOString(),
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

  function parseGtfsRt(bytes) {
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
      console.error('Malaysia GTFS-RT parse error:', err);
    }
    return trains;
  }

  async function fetchTrains() {
    const res = await fetch(KTMB_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Malaysia KTMB HTTP ${res.status}`);
    return parseGtfsRt(new Uint8Array(await res.arrayBuffer()));
  }

  return {
    id: 'malaysia',
    label: 'KTM (Malaysia)',
    country: 'MY',
    enabled: true,
    fetchTrains,
  };
})();
