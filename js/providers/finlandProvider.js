/**
 * finlandProvider.js — Adapter for Finland (VR / Digitraffic) train data.
 *
 * Primary source: GTFS-RT binary feed (lower latency)
 *   https://rata.digitraffic.fi/api/v1/trains/gtfs-rt-locations
 *
 * Fallback: Digitraffic GraphQL API (richer data: stops, delays, route names)
 *   https://rata.digitraffic.fi/api/v2/graphql/
 */

const FinlandProvider = (() => {
  const GTFS_RT_URL = 'https://rata.digitraffic.fi/api/v1/trains/gtfs-rt-locations';
  const GRAPHQL_URL = 'https://rata.digitraffic.fi/api/v2/graphql/';

  const GRAPHQL_QUERY = `
    query {
      currentlyRunningTrains {
        trainNumber
        departureDate
        operator { shortCode name }
        trainLocations(take: 1, orderBy: {timestamp: DESCENDING}) {
          speed
          timestamp
          location { lat lng }
        }
        timeTableRows {
          station { name shortCode }
          scheduledTime
          actualTime
          type
        }
      }
    }
  `;

  function normalizeHeading(v) {
    const h = Number(v) || 0;
    return ((h % 360) + 360) % 360;
  }

  function toMph(mps) {
    return mps == null ? 0 : Math.round(Number(mps) * 2.23694);
  }

  function calcDelayMinutes(actualTime, scheduledTime) {
    if (!actualTime || !scheduledTime) return 0;
    return Math.round((new Date(actualTime) - new Date(scheduledTime)) / 60000);
  }

  // ---------------------------------------------------------------------------
  // GraphQL path — richer data (stop names, delays, route info)
  // ---------------------------------------------------------------------------

  function parseGraphQLResponse(json) {
    const trains = [];
    for (const train of json?.data?.currentlyRunningTrains || []) {
      const loc = (train.trainLocations || [])[0];
      if (!loc?.location?.lat || !loc?.location?.lng) continue;

      const rows = train.timeTableRows || [];
      const origin = rows[0]?.station?.name || null;
      const destination = rows[rows.length - 1]?.station?.name || null;

      let lastActualIdx = -1;
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i].actualTime) { lastActualIdx = i; break; }
      }
      const lastActualRow = lastActualIdx >= 0 ? rows[lastActualIdx] : null;
      const nextStopRow = rows.find(r => !r.actualTime) || null;
      const progress = rows.length > 0 ? (lastActualIdx + 1) / rows.length : 0;

      trains.push({
        id: `finland:${train.trainNumber}-${train.departureDate}`,
        externalId: `${train.trainNumber}-${train.departureDate}`,
        provider: 'finland',
        providerLabel: 'VR / Digitraffic',
        country: 'FI',
        operator: train.operator?.shortCode || 'VR',
        trainNumber: String(train.trainNumber),
        routeName: origin && destination
          ? `${origin} → ${destination}`
          : `Train ${train.trainNumber}`,
        lat: loc.location.lat,
        lng: loc.location.lng,
        speed: toMph(loc.speed),
        heading: 0,
        delayMinutes: calcDelayMinutes(lastActualRow?.actualTime, lastActualRow?.scheduledTime),
        nextStop: nextStopRow?.station?.name || null,
        nextStopEta: nextStopRow?.scheduledTime || null,
        origin,
        destination,
        progress: Math.max(0, Math.min(1, progress)),
        stops: rows.map(r => ({
          name: r.station?.name,
          code: r.station?.shortCode,
          scheduledTime: r.scheduledTime,
          actualTime: r.actualTime,
        })),
        updatedAt: loc.timestamp
          ? new Date(loc.timestamp).toISOString()
          : new Date().toISOString(),
      });
    }
    return trains;
  }

  async function fetchViaGraphQL() {
    const res = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: GRAPHQL_QUERY }),
    });
    if (!res.ok) throw new Error(`Finland GraphQL HTTP ${res.status}`);
    const json = await res.json();
    if (json.errors?.length) throw new Error(`Finland GraphQL: ${json.errors[0].message}`);
    return parseGraphQLResponse(json);
  }

  // ---------------------------------------------------------------------------
  // GTFS-RT path — minimal, correct protobuf decoder
  //
  // GTFS-RT field numbers used here:
  //   FeedMessage:     header=1, entity=2 (repeated)
  //   FeedEntity:      id=1, vehicle=4
  //   VehiclePosition: trip=1, position=3, timestamp=7
  //   TripDescriptor:  tripId=1, routeId=5
  //   Position:        latitude=1, longitude=2, bearing=3, speed=5 — all float32 / wire type 5
  // ---------------------------------------------------------------------------

  // ProtoReader encapsulates all decoder state to avoid shared-closure bugs.
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

    // Read a length-delimited field's bytes as a subarray (zero-copy).
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
      return view.getFloat32(0, true); // protobuf is little-endian
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
        // latitude=1, longitude=2, bearing=3, speed=5 are all float32
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

    const trainNumber = trip?.tripId?.split(':')[0] || trip?.tripId || '?';
    return {
      id: `finland:${trainNumber}`,
      externalId: trainNumber,
      provider: 'finland',
      providerLabel: 'VR / Digitraffic',
      country: 'FI',
      operator: trip?.routeId?.split('_')[0] || 'VR',
      trainNumber,
      routeName: trip?.routeId || 'Finnish Rail Service',
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
      console.error('Finland GTFS-RT parse error:', err);
    }
    return trains;
  }

  // ---------------------------------------------------------------------------
  // Fetch — GTFS-RT first, GraphQL fallback
  // ---------------------------------------------------------------------------

  async function fetchTrains() {
    try {
      const res = await fetch(GTFS_RT_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error(`GTFS-RT HTTP ${res.status}`);
      const trains = parseGtfsRt(new Uint8Array(await res.arrayBuffer()));
      if (trains.length > 0) return trains;
      throw new Error('GTFS-RT returned no trains');
    } catch (err) {
      console.warn('Finland GTFS-RT failed, falling back to GraphQL:', err.message);
    }
    return fetchViaGraphQL();
  }

  return {
    id: 'finland',
    label: 'VR (Finland)',
    country: 'FI',
    enabled: true,
    fetchTrains,
  };
})();
