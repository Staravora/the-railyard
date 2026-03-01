/**
 * finlandProvider.js — Adapter for Finland (Digitraffic) train data.
 *
 * Uses GTFS-RT feed for real-time train positions.
 * API: https://rata.digitraffic.fi/api/v1/trains/gtfs-rt-locations
 *
 * Fallback to GraphQL if GTFS-RT fails:
 * https://rata.digitraffic.fi/api/v2/graphql/
 */

const FinlandProvider = (() => {
  const GTFS_RT_URL = 'https://rata.digitraffic.fi/api/v1/trains/gtfs-rt-locations';
  const GRAPHQL_URL = 'https://rata.digitraffic.fi/api/v2/graphql/';

  const GRAPHQL_QUERY = `
    query {
      currentlyRunningTrains {
        trainNumber
        departureDate
        operator {
          shortCode
          name
        }
        trainLocations(take: 1, orderBy: {timestamp: DESCENDING}) {
          speed
          timestamp
          location {
            lat
            lng
          }
        }
        timeTableRows(where: {exists: {actualTime: true}}, take: 1) {
          station {
            name
            shortCode
          }
          scheduledTime
          actualTime
        }
        timeTableRows(take: 1, orderBy: {scheduledTime: ASCENDING}) {
          station {
            name
          }
        }
        timeTableRows(orderBy: {scheduledTime: DESCENDING}, take: 1) {
          station {
            name
          }
        }
      }
    }
  `;

  function normalizeHeading(value) {
    const h = Number(value) || 0;
    return ((h % 360) + 360) % 360;
  }

  function toMph(metersPerSecond) {
    if (metersPerSecond == null) return 0;
    return Math.round(Number(metersPerSecond) * 2.23694);
  }

  function calculateDelay(actualTime, scheduledTime) {
    if (!actualTime || !scheduledTime) return 0;
    const actual = new Date(actualTime);
    const scheduled = new Date(scheduledTime);
    return Math.round((actual - scheduled) / 60000);
  }

  function parseGraphQLResponse(data) {
    const trains = [];
    const rawTrains = data?.data?.currentlyRunningTrains || [];

    for (const train of rawTrains) {
      const locations = train.trainLocations || [];
      const location = locations[0];

      if (!location?.location?.lat || !location?.location?.lng) continue;

      const nextStop = train.timeTableRows?.find(row => row.actualTime === null || new Date(row.actualTime) > new Date());
      const origin = train.timeTableRows?.[0]?.station?.name;
      const destination = train.timeTableRows?.[train.timeTableRows.length - 1]?.station?.name;

      const lastStop = train.timeTableRows?.find(row => row.actualTime);
      const delayMinutes = lastStop ? calculateDelay(lastStop.actualTime, lastStop.scheduledTime) : 0;

      const progress = train.timeTableRows?.length > 0
        ? train.timeTableRows.findIndex(row => !row.actualTime) / train.timeTableRows.length
        : 0;

      trains.push({
        id: `finland:${train.trainNumber}-${train.departureDate}`,
        externalId: `${train.trainNumber}-${train.departureDate}`,
        provider: 'finland',
        providerLabel: 'Digitraffic',
        country: 'FI',
        operator: train.operator?.shortCode || 'VR',
        trainNumber: String(train.trainNumber),
        routeName: `${origin || '?'} → ${destination || '?'}`,
        lat: location.location.lat,
        lng: location.location.lng,
        speed: toMph(location.speed),
        heading: 0,
        delayMinutes,
        nextStop: nextStop?.station?.name || null,
        nextStopEta: nextStop?.scheduledTime || null,
        origin,
        destination,
        progress: Math.max(0, Math.min(1, progress)),
        stops: train.timeTableRows?.map(row => ({
          name: row.station?.name,
          code: row.station?.shortCode,
          scheduledTime: row.scheduledTime,
          actualTime: row.actualTime,
        })) || [],
        updatedAt: location.timestamp ? new Date(location.timestamp).toISOString() : new Date().toISOString(),
      });
    }

    return trains;
  }

  async function fetchViaGraphQL() {
    const res = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: GRAPHQL_QUERY }),
    });

    if (!res.ok) {
      throw new Error(`GraphQL HTTP ${res.status}`);
    }

    const json = await res.json();
    if (json.errors) {
      throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
    }

    return parseGraphQLResponse(json);
  }

  async function fetchTrains() {
    try {
      const res = await fetch(GTFS_RT_URL, {
        cache: 'no-store',
      });

      if (!res.ok) {
        throw new Error(`GTFS-RT HTTP ${res.status}`);
      }

      const buffer = await res.arrayBuffer();
      const data = new Uint8Array(buffer);

      return parseGtfsRt(data);
    } catch (err) {
      console.warn('Finland GTFS-RT failed, falling back to GraphQL:', err.message);
      return fetchViaGraphQL();
    }
  }

  function parseGtfsRt(data) {
    const trains = [];

    if (!data || data.length < 2) return trains;

    try {
      const feed = decodeGtfsRtFeed(data);

      if (!feed?.entity) return trains;

      for (const entity of feed.entity) {
        if (!entity.vehicle?.position) continue;

        const vehicle = entity.vehicle;
        const trip = vehicle.trip || {};
        const position = vehicle.position;

        if (!position.latitude || !position.longitude) continue;

        const trainNumber = trip.tripId?.split(':')[0] || trip.tripId || '?';

        trains.push({
          id: `finland:${trainNumber}`,
          externalId: trainNumber,
          provider: 'finland',
          providerLabel: 'Digitraffic',
          country: 'FI',
          operator: trip.routeId?.split('_')[0] || 'VR',
          trainNumber,
          routeName: trip.routeId || 'Finnish Rail Service',
          lat: position.latitude,
          lng: position.longitude,
          speed: toMph(position.speed),
          heading: normalizeHeading(position.bearing),
          delayMinutes: vehicle.delay ? Math.round(vehicle.delay / 60) : 0,
          nextStop: null,
          nextStopEta: null,
          origin: null,
          destination: null,
          progress: 0,
          stops: [],
          updatedAt: vehicle.timestamp ? new Date(vehicle.timestamp * 1000).toISOString() : new Date().toISOString(),
        });
      }
    } catch (err) {
      console.error('GTFS-RT parse error:', err);
    }

    return trains;
  }

  function decodeGtfsRtFeed(data) {
    let pos = 0;
    const length = data.length;

    function readVarint() {
      let result = 0;
      let shift = 0;
      while (pos < length) {
        const byte = data[pos++];
        result |= (byte & 0x7F) << shift;
        if ((byte & 0x80) === 0) break;
        shift += 7;
      }
      return result;
    }

    function readField() {
      if (pos >= length) return null;

      const tagAndWire = readVarint();
      const fieldTag = tagAndWire >> 3;
      const wireType = tagAndWire & 0x07;

      let value;
      let done = false;

      switch (wireType) {
        case 0:
          value = readVarint();
          break;
        case 1:
          value = data.slice(pos, pos + 8);
          pos += 8;
          break;
        case 2:
          const len = readVarint();
          value = data.slice(pos, pos + len);
          pos += len;
          break;
        case 5:
          value = data.slice(pos, pos + 4);
          pos += 4;
          break;
        default:
          done = true;
      }

      return done ? null : { fieldTag, value };
    }

    function readMessage() {
      const obj = {};
      while (pos < length) {
        const field = readField();
        if (!field) break;

        const { fieldTag, value } = field;

        switch (fieldTag) {
          case 1:
            obj.entity = obj.entity || [];
            const entity = readEntity(value);
            if (entity) obj.entity.push(entity);
            break;
          default:
            if (wireTypeIsLengthDelimited(wireType(fieldTag))) {
              const len = readVarint();
              pos += len;
            }
        }
      }
      return obj;
    }

    function readEntity(data) {
      if (!data || data.length === 0) return null;
      const startPos = pos;
      let obj = {};
      let endPos = startPos + data.length;

      const savedPos = pos;
      pos = 0;
      const arr = new Uint8Array(data.length);
      arr.set(data);
      const savedData = data;
      data = arr;
      pos = 0;
      data = savedData;
      pos = startPos;

      try {
        while (pos < endPos && pos < length) {
          const tagAndWire = readVarint();
          const fieldTag = tagAndWire >> 3;
          const wireType = tagAndWire & 0x07;

          let value;
          if (wireType === 2) {
            const len = readVarint();
            value = data.slice(pos, pos + len);
            pos += len;
          } else if (wireType === 0) {
            value = readVarint();
          } else if (wireType === 5) {
            value = data.slice(pos, pos + 4);
            pos += 4;
          }

          if (fieldTag === 2) {
            obj.vehicle = obj.vehicle || {};
            const vehicleData = readVehicle(value);
            obj.vehicle = { ...obj.vehicle, ...vehicleData };
          }
        }
      } catch (e) {
        return null;
      }

      return Object.keys(obj).length > 0 ? obj : null;
    }

    function readVehicle(data) {
      const startPos = pos;
      const endPos = startPos + data.length;
      let obj = {};

      const savedData = data;
      pos = 0;
      const arr = new Uint8Array(data.length);
      arr.set(data);
      data = arr;

      try {
        while (pos < data.length && pos < endPos - startPos + startPos) {
          const tagAndWire = readVarint();
          const fieldTag = tagAndWire >> 3;
          const wireType = tagAndWire & 0x07;

          if (wireType === 2) {
            const len = readVarint();
            const value = data.slice(pos, pos + len);
            pos += len;

            switch (fieldTag) {
              case 1:
                obj.trip = readTrip(value);
                break;
              case 2:
                obj.position = readPosition(value);
                break;
              case 3:
                obj.vehicle = readVehiclePosition(value);
                break;
              case 4:
                obj.timestamp = readVarint();
                break;
              case 5:
                obj.delay = readVarint();
                break;
            }
          } else if (wireType === 0) {
            const value = readVarint();
            if (fieldTag === 4) obj.timestamp = value;
            if (fieldTag === 5) obj.delay = value;
          }
        }
      } catch (e) {
      }

      pos = startPos;
      data = savedData;
      return obj;
    }

    function wireTypeIsLengthDelimited(wt) {
      return wt === 2 || wt === 3 || wt === 4;
    }

    function wireType(fieldTag) {
      return 0;
    }

    function readTrip(data) {
      let obj = {};
      const startPos = pos;
      const savedData = data;

      pos = 0;
      const arr = new Uint8Array(data.length);
      arr.set(data);
      data = arr;

      try {
        while (pos < data.length) {
          const tagAndWire = readVarint();
          const fieldTag = tagAndWire >> 3;
          const wireType = tagAndWire & 0x07;

          if (wireType === 2) {
            const len = readVarint();
            const value = new TextDecoder().decode(data.slice(pos, pos + len));
            pos += len;

            if (fieldTag === 1) obj.tripId = value;
            if (fieldTag === 2) obj.routeId = value;
            if (fieldTag === 3) obj.directionId = value;
            if (fieldTag === 4) obj.startTime = value;
            if (fieldTag === 5) obj.startDate = value;
            if (fieldTag === 6) obj.scheduleRelationship = value;
          }
        }
      } catch (e) {
      }

      pos = startPos;
      data = savedData;
      return obj;
    }

    function readPosition(data) {
      let obj = {};
      const savedData = data;

      pos = 0;
      const arr = new Uint8Array(data.length);
      arr.set(data);
      data = arr;

      try {
        while (pos < data.length) {
          const tagAndWire = readVarint();
          const fieldTag = tagAndWire >> 3;
          const wireType = tagAndWire & 0x07;

          if (wireType === 1) {
            const bytes = data.slice(pos, pos + 8);
            pos += 8;
            const view = new DataView(bytes.buffer);
            if (fieldTag === 1) obj.latitude = view.getFloat64(0);
            if (fieldTag === 2) obj.longitude = view.getFloat64(0);
            if (fieldTag === 3) obj.bearing = view.getFloat32(0);
            if (fieldTag === 4) obj.speed = view.getFloat32(0);
          } else if (wireType === 5) {
            const bytes = data.slice(pos, pos + 4);
            pos += 4;
            const view = new DataView(bytes.buffer);
            if (fieldTag === 3) obj.bearing = view.getFloat32(0);
            if (fieldTag === 4) obj.speed = view.getFloat32(0);
          }
        }
      } catch (e) {
      }

      pos = 0;
      data = savedData;
      return obj;
    }

    function readVehiclePosition(data) {
      return readPosition(data);
    }

    return readMessage();
  }

  return {
    id: 'finland',
    label: 'VR (Finland)',
    country: 'FI',
    enabled: true,
    fetchTrains,
  };
})();
