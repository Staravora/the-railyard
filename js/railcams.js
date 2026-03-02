/**
 * railcams.js — Rail camera directory + player.
 */

const RailcamsModule = (() => {
  const CAM_STATUS = {
    UNKNOWN: 'unknown',
    LIVE: 'live',
    ENDED: 'ended',
    OFFLINE: 'offline',
    BLOCKED: 'blocked',
  };

  const STATUS_RESET_MS = {
    ended: 8 * 60 * 1000,
    offline: 12 * 60 * 1000,
    blocked: 20 * 60 * 1000,
  };

  const FILTERS = [
    { id: 'all', label: 'All' },
    { id: 'freight', label: 'Freight Heavy' },
    { id: 'mountain', label: 'Mountain' },
    { id: 'urban', label: 'Urban' },
    { id: 'international', label: 'International' },
  ];

  const CAMS = [
    {
      id: 'vrf-tower55-fort-worth',
      name: 'VRF Tower 55 PTZ',
      region: 'Fort Worth, Texas, US',
      note: 'High-traffic Fort Worth junction view from Virtual Railfan.',
      lat: 32.7520,
      lng: -97.3331,
      zoom: 12,
      embedUrl: 'https://www.youtube.com/embed/blcDjPvPbss',
      sourceUrl: 'https://www.youtube.com/live/blcDjPvPbss',
      tags: ['VRF', 'Freight', 'Junction'],
      filters: ['freight', 'urban'],
      geoPrecise: true,
    },
    {
      id: 'vrf-rochelle-il',
      name: 'VRF Rochelle PTZ',
      region: 'Rochelle, Illinois, US',
      note: 'Classic Midwest hotspot with frequent BNSF and UP activity.',
      lat: 41.9222,
      lng: -89.0673,
      zoom: 12,
      embedUrl: 'https://www.youtube.com/embed/LhNpn9L5ndM',
      sourceUrl: 'https://www.youtube.com/live/LhNpn9L5ndM',
      tags: ['VRF', 'BNSF', 'UP'],
      filters: ['freight'],
      geoPrecise: true,
    },
    {
      id: 'vrf-fort-madison-west',
      name: 'VRF Fort Madison (West)',
      region: 'Fort Madison, Iowa, US',
      note: 'Marina-side west-facing view of Mississippi River crossing traffic.',
      lat: 40.6306,
      lng: -91.3145,
      zoom: 12,
      embedUrl: 'https://www.youtube.com/embed/DuXSP6y9W7U',
      sourceUrl: 'https://www.youtube.com/live/DuXSP6y9W7U',
      tags: ['VRF', 'Bridge', 'Freight'],
      filters: ['freight'],
      geoPrecise: true,
    },
    {
      id: 'vrf-fort-madison-bridge-ptz',
      name: 'VRF Fort Madison Bridge PTZ',
      region: 'Fort Madison, Iowa, US',
      note: 'PTZ bridge view for mainline movements at Fort Madison.',
      lat: 40.6306,
      lng: -91.3145,
      zoom: 12,
      embedUrl: 'https://www.youtube.com/embed/_0JYnfB6SWw',
      sourceUrl: 'https://www.youtube.com/live/_0JYnfB6SWw',
      tags: ['VRF', 'PTZ', 'Mainline'],
      filters: ['freight'],
      geoPrecise: true,
    },
    {
      id: 'vrf-belen-yard',
      name: 'VRF Belen Yard PTZ',
      region: 'Belen, New Mexico, US',
      note: 'BNSF yard and corridor operations from Belen rail hub.',
      lat: 34.6628,
      lng: -106.7764,
      zoom: 12,
      embedUrl: 'https://www.youtube.com/embed/EKohXgHGCj8',
      sourceUrl: 'https://www.youtube.com/live/EKohXgHGCj8',
      tags: ['VRF', 'BNSF', 'Yard'],
      filters: ['freight', 'mountain'],
      geoPrecise: true,
    },
    {
      id: 'vrf-galesburg-ptz',
      name: 'VRF Galesburg PTZ',
      region: 'Galesburg, Illinois, US',
      note: 'Busy Midwestern junction with mixed passenger and freight traffic.',
      lat: 40.9478,
      lng: -90.3712,
      zoom: 12,
      embedUrl: 'https://www.youtube.com/embed/On1MRt0NqFs',
      sourceUrl: 'https://www.youtube.com/live/On1MRt0NqFs',
      tags: ['VRF', 'BNSF', 'Amtrak'],
      filters: ['freight'],
      geoPrecise: true,
    },
    {
      id: 'vrf-horseshoe-curve',
      name: 'VRF Horseshoe Curve PTZ',
      region: 'Altoona, Pennsylvania, US',
      note: 'Iconic mountain curve with heavy Norfolk Southern traffic.',
      lat: 40.4967,
      lng: -78.4111,
      zoom: 12,
      embedUrl: 'https://www.youtube.com/embed/ssuM6NJQ2no',
      sourceUrl: 'https://www.youtube.com/live/ssuM6NJQ2no',
      tags: ['VRF', 'NS', 'Mountain'],
      filters: ['freight', 'mountain'],
      geoPrecise: true,
    },
    {
      id: 'vrf-kansas-city-east',
      name: 'VRF Kansas City East',
      region: 'Kansas City, Missouri, US',
      note: 'Doc\'s Caboose east-facing railcam in Kansas City.',
      lat: 39.1065,
      lng: -94.5800,
      zoom: 11,
      embedUrl: 'https://www.youtube.com/embed/W02WZ5c02LE',
      sourceUrl: 'https://www.youtube.com/live/W02WZ5c02LE',
      tags: ['VRF', 'Urban', 'Freight'],
      filters: ['freight', 'urban'],
      geoPrecise: true,
    },
    {
      id: 'vrf-kansas-city-west',
      name: 'VRF Kansas City West',
      region: 'Kansas City, Missouri, US',
      note: 'Doc\'s Caboose west-facing railcam in Kansas City.',
      lat: 39.1065,
      lng: -94.5800,
      zoom: 11,
      embedUrl: 'https://www.youtube.com/embed/xR3kxBG_v7Y',
      sourceUrl: 'https://www.youtube.com/live/xR3kxBG_v7Y',
      tags: ['VRF', 'Urban', 'Mainline'],
      filters: ['freight', 'urban'],
      geoPrecise: true,
    },
    {
      id: 'vrf-lincoln-east',
      name: 'VRF Lincoln East',
      region: 'Lincoln, Nebraska, US',
      note: 'Fixed east-facing view of Lincoln mainline rail traffic.',
      lat: 40.8136,
      lng: -96.7026,
      zoom: 12,
      embedUrl: 'https://www.youtube.com/embed/DhoVf4-0Zt4',
      sourceUrl: 'https://www.youtube.com/live/DhoVf4-0Zt4',
      tags: ['VRF', 'Freight', 'Mainline'],
      filters: ['freight'],
      geoPrecise: true,
    },
    {
      id: 'vrf-lincoln-ptz',
      name: 'VRF Lincoln PTZ',
      region: 'Lincoln, Nebraska, US',
      note: 'PTZ companion feed for broader Lincoln corridor coverage.',
      lat: 40.8136,
      lng: -96.7026,
      zoom: 12,
      embedUrl: 'https://www.youtube.com/embed/gOvke59hGxQ',
      sourceUrl: 'https://www.youtube.com/live/gOvke59hGxQ',
      tags: ['VRF', 'PTZ', 'Freight'],
      filters: ['freight'],
      geoPrecise: true,
    },
    {
      id: 'north-platte-west',
      name: 'North Platte Golden Spike Tower (West)',
      region: 'North Platte, Nebraska, US',
      note: 'Live view of Union Pacific freight activity from the Golden Spike Tower.',
      lat: 41.1347,
      lng: -100.7730,
      zoom: 11,
      embedUrl: 'https://www.youtube.com/embed/laKzBnfVIsQ',
      sourceUrl: 'https://www.youtube.com/live/laKzBnfVIsQ',
      tags: ['UP', 'Freight', 'Yard activity'],
      filters: ['freight'],
      geoPrecise: true,
    },
    {
      id: 'la-grange-ky',
      name: 'La Grange Street Running',
      region: 'La Grange, Kentucky, US',
      note: 'Street-running trains through downtown La Grange.',
      lat: 38.4067,
      lng: -85.3788,
      zoom: 13,
      embedUrl: 'https://www.youtube.com/embed/9SLt3AT0rXk',
      sourceUrl: 'https://www.youtube.com/live/9SLt3AT0rXk',
      tags: ['Street running', 'Freight', 'VRF'],
      filters: ['freight', 'urban'],
      geoPrecise: true,
    },
    {
      id: 'galesburg-il',
      name: 'Galesburg Railcam',
      region: 'Galesburg, Illinois, US',
      note: 'High-volume Midwestern freight and passenger junction activity.',
      lat: 40.9478,
      lng: -90.3712,
      zoom: 12,
      embedUrl: 'https://www.youtube.com/embed/On1MRt0NqFs',
      sourceUrl: 'https://www.youtube.com/live/On1MRt0NqFs',
      tags: ['BNSF', 'Amtrak', 'Freight'],
      filters: ['freight'],
      geoPrecise: true,
    },
    {
      id: 'houston-tower-26',
      name: 'Houston Tower 26',
      region: 'Houston, Texas, US',
      note: 'Live PTZ railcam covering Houston area traffic.',
      lat: 29.7604,
      lng: -95.3698,
      zoom: 11,
      embedUrl: 'https://www.youtube.com/embed/wKLX7B3Q01Q',
      sourceUrl: 'https://www.youtube.com/live/wKLX7B3Q01Q',
      tags: ['Freight', 'PTZ', 'Urban'],
      filters: ['freight', 'urban'],
      geoPrecise: true,
    },
    {
      id: 'barstow-ca',
      name: 'Barstow Subdivision PTZ',
      region: 'Barstow, California, US',
      note: 'BNSF Needles Sub mainline activity near Barstow.',
      lat: 34.8958,
      lng: -117.0173,
      zoom: 11,
      embedUrl: 'https://www.youtube.com/embed/Hsh-46qLpQE',
      sourceUrl: 'https://www.youtube.com/live/Hsh-46qLpQE',
      tags: ['BNSF', 'Desert mainline', 'Freight'],
      filters: ['freight', 'mountain'],
      geoPrecise: true,
    },
    {
      id: 'kingman-az',
      name: 'Kingman Seligman Sub PTZ',
      region: 'Kingman, Arizona, US',
      note: 'BNSF Seligman Sub freight corridor camera.',
      lat: 35.1894,
      lng: -114.0530,
      zoom: 11,
      embedUrl: 'https://www.youtube.com/embed/h8-J3JGU7g4',
      sourceUrl: 'https://www.youtube.com/live/h8-J3JGU7g4',
      tags: ['BNSF', 'Freight', 'Southwest'],
      filters: ['freight', 'mountain'],
      geoPrecise: true,
    },
    {
      id: 'oklahoma-city-ptz',
      name: 'Oklahoma City PTZ',
      region: 'Oklahoma City, Oklahoma, US',
      note: 'Live city railcam by OMRA with mixed rail traffic.',
      lat: 35.4676,
      lng: -97.5164,
      zoom: 11,
      embedUrl: 'https://www.youtube.com/embed/jdUc9qYuFHw',
      sourceUrl: 'https://www.youtube.com/live/jdUc9qYuFHw',
      tags: ['City cam', 'Freight', 'PTZ'],
      filters: ['freight', 'urban'],
      geoPrecise: true,
    },
    {
      id: 'chicago-powerhouse-east',
      name: 'Chicago Power House (East)',
      region: 'Chicago, Illinois, US',
      note: 'Steel Highway live camera covering Chicago traffic.',
      lat: 41.8781,
      lng: -87.6298,
      zoom: 11,
      embedUrl: 'https://www.youtube.com/embed/6M6rK0ssjYg',
      sourceUrl: 'https://www.youtube.com/live/6M6rK0ssjYg',
      tags: ['Chicago', 'Freight', 'Urban'],
      filters: ['freight', 'urban'],
      geoPrecise: true,
    },
    {
      id: 'chicago-powerhouse-cta',
      name: 'Chicago Power House (CTA)',
      region: 'Chicago, Illinois, US',
      note: 'Chicago rail activity with CTA context from Steel Highway.',
      lat: 41.8781,
      lng: -87.6298,
      zoom: 11,
      embedUrl: 'https://www.youtube.com/embed/grl50cJ7Fq0',
      sourceUrl: 'https://www.youtube.com/live/grl50cJ7Fq0',
      tags: ['Chicago', 'CTA', 'Urban rail'],
      filters: ['urban'],
      geoPrecise: true,
    },
    {
      id: 'mendota-il',
      name: 'Mendota Union Depot',
      region: 'Mendota, Illinois, US',
      note: 'Mainline railcam at Mendota Union Depot Railroad Museum.',
      lat: 41.5473,
      lng: -89.1179,
      zoom: 12,
      embedUrl: 'https://www.youtube.com/embed/zDZYrkvu044',
      sourceUrl: 'https://www.youtube.com/live/zDZYrkvu044',
      tags: ['BNSF', 'Mainline', 'Museum'],
      filters: ['freight'],
      geoPrecise: true,
    },
    {
      id: 'tokyo-shinjuku',
      name: 'Tokyo Shinjuku JR Live Cam',
      region: 'Shinjuku, Tokyo, Japan',
      note: 'Urban JR corridor live camera in central Tokyo.',
      lat: 35.6938,
      lng: 139.7034,
      zoom: 13,
      embedUrl: 'https://www.youtube.com/embed/GLQhbRGv5qU',
      sourceUrl: 'https://www.youtube.com/live/GLQhbRGv5qU',
      tags: ['Japan', 'JR', 'Urban'],
      filters: ['urban', 'international'],
      geoPrecise: true,
    },
    {
      id: 'norway-cab-views',
      name: 'Norway Winter Cab Views',
      region: 'Norway (route-based)',
      note: 'Rail cab stream, route-based footage rather than one fixed camera.',
      lat: 60.4720,
      lng: 8.4689,
      zoom: 5,
      embedUrl: 'https://www.youtube.com/embed/tAWFO8_O_7M',
      sourceUrl: 'https://www.youtube.com/live/tAWFO8_O_7M',
      tags: ['Cab ride', 'Norway', 'Scenic'],
      filters: ['mountain', 'international'],
      geoPrecise: false,
    },
  ];

  let selectedCamId = null;
  let activeFilter = 'all';
  let embedFallbackTimer = null;
  let currentEmbedAttempt = 0;
  let activeCamId = null;
  let autoSwitchTriedIds = new Set();
  const camRuntime = new Map();
  const resetTimers = new Map();

  function init() {
    const list = document.getElementById('railcamList');
    if (!list) return;

    selectedCamId = readSelectedCamId() || CAMS[0].id;
    activeFilter = readSelectedFilter() || 'all';
    renderFilters();
    initializeRuntimeStatuses();
    renderList();

    if (!isCamVisible(selectedCamId)) {
      const firstVisible = getVisibleCams()[0];
      selectedCamId = firstVisible ? firstVisible.id : CAMS[0].id;
    }

    window.addEventListener('message', onPlayerMessage);

    selectCam(selectedCamId, { scrollIntoView: false });
  }

  function initializeRuntimeStatuses() {
    CAMS.forEach(cam => {
      if (!camRuntime.has(cam.id)) {
        camRuntime.set(cam.id, {
          status: CAM_STATUS.UNKNOWN,
          updatedAt: Date.now(),
          lastLiveAt: 0,
        });
      }
    });
  }

  function renderFilters() {
    const host = document.getElementById('railcamFilters');
    if (!host) return;

    host.innerHTML = FILTERS.map(filter => `
      <button type="button" class="railcam-filter-chip" data-filter-id="${escapeHtml(filter.id)}">
        ${escapeHtml(filter.label)}
      </button>
    `).join('');

    host.querySelectorAll('.railcam-filter-chip').forEach(button => {
      button.addEventListener('click', () => {
        const nextFilter = button.dataset.filterId || 'all';
        activeFilter = nextFilter;
        persistSelectedFilter(nextFilter);
        renderFilters();
        renderList();

        if (!isCamVisible(selectedCamId)) {
          const firstVisible = getVisibleCams()[0];
          if (firstVisible) {
            selectCam(firstVisible.id, { scrollIntoView: false });
          } else {
            showEmptyPlayerState();
          }
        } else {
          paintSelection(selectedCamId);
        }
      });
    });

    host.querySelectorAll('.railcam-filter-chip').forEach(button => {
      button.classList.toggle('active', button.dataset.filterId === activeFilter);
    });
  }

  function renderList() {
    const list = document.getElementById('railcamList');
    if (!list) return;

    const visible = getVisibleCams();
    if (visible.length === 0) {
      list.innerHTML = '<p class="empty-state">No camera feeds match this filter.</p>';
      return;
    }

    list.innerHTML = visible.map(cam => `
      <button class="railcam-item" type="button" data-cam-id="${escapeHtml(cam.id)}">
        <span class="railcam-item-title">${escapeHtml(cam.name)}</span>
        <span class="railcam-item-region">${escapeHtml(cam.region)}</span>
        <span class="railcam-status-badge status-${getCamStatus(cam.id)}">${formatStatus(getCamStatus(cam.id))}</span>
        <span class="railcam-item-quality">${cam.geoPrecise ? 'Map-linked' : 'Feed not map-pinned'}</span>
        <span class="railcam-item-tags">${cam.tags.map(tag => `<em>${escapeHtml(tag)}</em>`).join('')}</span>
      </button>
    `).join('');

    list.querySelectorAll('.railcam-item').forEach(item => {
      item.addEventListener('click', () => {
        selectCam(item.dataset.camId, { scrollIntoView: false });
      });
    });
  }

  function selectCam(camId, opts = {}) {
    const cam = CAMS.find(entry => entry.id === camId) || CAMS[0];
    if (!cam) return;

    selectedCamId = cam.id;
    activeCamId = cam.id;
    autoSwitchTriedIds.clear();
    persistSelectedCamId(cam.id);
    paintSelection(cam.id);
    hydratePlayer(cam);

    if (opts.scrollIntoView) {
      const selectedButton = [...document.querySelectorAll('.railcam-item')]
        .find(button => button.dataset.camId === cam.id);
      if (selectedButton) selectedButton.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function paintSelection(camId) {
    document.querySelectorAll('.railcam-item').forEach(item => {
      item.classList.toggle('active', item.dataset.camId === camId);
    });
  }

  function hydratePlayer(cam) {
    const title = document.getElementById('railcamTitle');
    const region = document.getElementById('railcamRegion');
    const meta = document.getElementById('railcamMeta');
    const notes = document.getElementById('railcamNotes');
    const iframe = document.getElementById('railcamPlayer');
    const openBtn = document.getElementById('railcamOpenBtn');
    const mapBtn = document.getElementById('railcamMapBtn');

    if (!title || !region || !meta || !notes || !iframe || !openBtn || !mapBtn) return;

    title.textContent = cam.name;
    region.textContent = cam.region;
    meta.textContent = `${cam.tags.join(' • ')} • ${cam.geoPrecise ? 'Map-linked feed' : 'Not location-specific'}`;
    notes.textContent = cam.note;

    setPlayerSource(cam.embedUrl, cam.sourceUrl);
    openBtn.href = cam.sourceUrl;

    mapBtn.disabled = !cam.geoPrecise;
    mapBtn.textContent = cam.geoPrecise ? 'Jump To Map' : 'Map Not Exact';

    mapBtn.onclick = () => {
      if (!cam.geoPrecise) return;
      document.dispatchEvent(new CustomEvent('railyard:focus-map', {
        detail: {
          lat: cam.lat,
          lng: cam.lng,
          zoom: cam.zoom || 11,
          label: cam.name,
        }
      }));
    };

    const status = getCamStatus(cam.id);
    if (status !== CAM_STATUS.LIVE) {
      setStatusMessage(`Checking feed status for ${cam.name}...`);
    } else {
      setStatusMessage('');
    }
  }

  function setPlayerSource(embedUrl, sourceUrl) {
    const iframe = document.getElementById('railcamPlayer');
    const fallback = document.getElementById('railcamFallback');
    const fallbackOpen = document.getElementById('railcamFallbackOpen');
    const retryBtn = document.getElementById('railcamRetryBtn');
    if (!iframe || !fallback || !fallbackOpen || !retryBtn) return;

    fallbackOpen.href = sourceUrl;
    fallback.hidden = true;

    const attempt = ++currentEmbedAttempt;
    const normalized = normalizeEmbedUrl(embedUrl);
    const isYoutube = isYoutubeEmbed(normalized);

    const showFallback = () => {
      if (attempt !== currentEmbedAttempt) return;
      handleCamUnavailable(activeCamId, 'timeout');
      fallback.hidden = false;
      clearEmbedFallbackTimer();
    };

    iframe.onload = () => {
      if (attempt !== currentEmbedAttempt) return;

      if (!isYoutube) {
        clearEmbedFallbackTimer();
        fallback.hidden = true;
        return;
      }

      startYoutubeHandshake();
    };

    iframe.onerror = () => {
      handleCamUnavailable(activeCamId, 'error');
      showFallback();
    };

    retryBtn.onclick = () => {
      fallback.hidden = true;
      setPlayerSource(embedUrl, sourceUrl);
    };

    clearEmbedFallbackTimer();
    embedFallbackTimer = window.setTimeout(showFallback, isYoutube ? 2500 : 8000);

    iframe.src = 'about:blank';
    window.setTimeout(() => {
      if (attempt !== currentEmbedAttempt) return;
      iframe.src = normalized;
    }, 30);

    function startYoutubeHandshake() {
      let pings = 0;
      const ping = () => {
        if (attempt !== currentEmbedAttempt) return;
        pings += 1;
        try {
          iframe.contentWindow?.postMessage(JSON.stringify({
            event: 'listening',
            id: iframe.id,
            channel: 'widget',
          }), '*');
        } catch {
          // Ignore postMessage issues.
        }

        if (pings < 4) {
          window.setTimeout(ping, 280);
        }
      };

      ping();
    }
  }

  function onPlayerMessage(event) {
    const origin = String(event.origin || '');
    if (!origin.includes('youtube.com') && !origin.includes('youtube-nocookie.com')) {
      return;
    }

    const payload = parseMessage(event.data);
    if (!payload) return;

    const fallback = document.getElementById('railcamFallback');
    if (!fallback) return;

    const eventName = payload.event || payload.info?.playerState;
    const hasReady = payload.event === 'onReady' || payload.info?.playerState === 1 || payload.info?.playerState === 2;
    const playerState = payload.info?.playerState;
    const playerError = payload.info?.errorCode || payload.data;
    const hasError = payload.event === 'onError' || playerState === -1 || playerError === 150 || playerError === 101;
    const hasEnded = playerState === 0;

    if (hasReady) {
      if (activeCamId) {
        markCamLive(activeCamId);
      }
      clearEmbedFallbackTimer();
      fallback.hidden = true;
      return;
    }

    if (hasEnded) {
      if (activeCamId) {
        handleCamUnavailable(activeCamId, 'ended');
      }
      clearEmbedFallbackTimer();
      fallback.hidden = false;
      return;
    }

    if (hasError || eventName === 'error') {
      if (activeCamId) {
        handleCamUnavailable(activeCamId, playerError === 150 || playerError === 101 ? 'blocked' : 'error');
      }
      clearEmbedFallbackTimer();
      fallback.hidden = false;
    }
  }

  function handleCamUnavailable(camId, reason) {
    if (!camId) return;
    const runtime = camRuntime.get(camId);
    const hadRecentLive = runtime?.lastLiveAt && (Date.now() - runtime.lastLiveAt) < 2 * 60 * 60 * 1000;

    let nextStatus = CAM_STATUS.OFFLINE;
    if (reason === 'blocked') nextStatus = CAM_STATUS.BLOCKED;
    else if (reason === 'ended' || hadRecentLive || runtime?.status === CAM_STATUS.LIVE) nextStatus = CAM_STATUS.ENDED;

    setCamStatus(camId, nextStatus);
    scheduleStatusReset(camId, nextStatus);

    const cam = getCamById(camId);
    if (cam) {
      setStatusMessage(`${cam.name} is ${formatStatus(nextStatus)}. Switching to next available feed...`);
    }

    maybeAutoSwitchFrom(camId);
  }

  function maybeAutoSwitchFrom(camId) {
    autoSwitchTriedIds.add(camId);

    const visible = getVisibleCams();
    const currentIndex = Math.max(0, visible.findIndex(cam => cam.id === camId));
    const ordered = [
      ...visible.slice(currentIndex + 1),
      ...visible.slice(0, currentIndex),
    ];

    const candidates = ordered
      .filter(cam => !autoSwitchTriedIds.has(cam.id))
      .map(cam => ({ cam, priority: statusPriority(getCamStatus(cam.id)) }))
      .sort((a, b) => a.priority - b.priority);

    const next = candidates.find(entry => entry.priority <= 1)?.cam || null;
    if (!next) {
      setStatusMessage('No live feeds right now. Keeping source links available while feeds recover.');
      return;
    }

    autoSwitchTriedIds.add(next.id);
    selectCam(next.id, { scrollIntoView: true });
  }

  function markCamLive(camId) {
    if (!camId) return;
    setCamStatus(camId, CAM_STATUS.LIVE);
    autoSwitchTriedIds.clear();
    setStatusMessage('');
  }

  function scheduleStatusReset(camId, status) {
    const delay = STATUS_RESET_MS[status];
    if (!delay) return;

    if (resetTimers.has(camId)) {
      window.clearTimeout(resetTimers.get(camId));
    }

    const timer = window.setTimeout(() => {
      resetTimers.delete(camId);
      if (getCamStatus(camId) === status) {
        setCamStatus(camId, CAM_STATUS.UNKNOWN);
        const cam = getCamById(camId);
        if (cam && selectedCamId === camId) {
          setStatusMessage(`Rechecking ${cam.name}...`);
          hydratePlayer(cam);
        }
      }
    }, delay);

    resetTimers.set(camId, timer);
  }

  function setCamStatus(camId, status) {
    if (!camId) return;
    const prev = camRuntime.get(camId) || { status: CAM_STATUS.UNKNOWN, updatedAt: 0, lastLiveAt: 0 };
    const next = {
      ...prev,
      status,
      updatedAt: Date.now(),
      lastLiveAt: status === CAM_STATUS.LIVE ? Date.now() : prev.lastLiveAt,
    };
    camRuntime.set(camId, next);
    renderList();
    paintSelection(selectedCamId);
  }

  function getCamStatus(camId) {
    return camRuntime.get(camId)?.status || CAM_STATUS.UNKNOWN;
  }

  function statusPriority(status) {
    if (status === CAM_STATUS.LIVE) return 0;
    if (status === CAM_STATUS.UNKNOWN) return 1;
    if (status === CAM_STATUS.ENDED) return 2;
    if (status === CAM_STATUS.OFFLINE) return 3;
    return 4;
  }

  function formatStatus(status) {
    if (status === CAM_STATUS.LIVE) return 'Live';
    if (status === CAM_STATUS.ENDED) return 'Ended';
    if (status === CAM_STATUS.OFFLINE) return 'Offline';
    if (status === CAM_STATUS.BLOCKED) return 'Blocked';
    return 'Checking';
  }

  function setStatusMessage(message) {
    const notes = document.getElementById('railcamNotes');
    if (!notes) return;
    const cam = getCamById(selectedCamId);
    const base = cam ? cam.note : 'Live stream embeds may vary by source.';
    notes.textContent = message ? `${message} ${base}` : base;
  }

  function getCamById(camId) {
    return CAMS.find(cam => cam.id === camId) || null;
  }

  function parseMessage(raw) {
    if (!raw) return null;
    if (typeof raw === 'object') return raw;
    if (typeof raw !== 'string') return null;

    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function normalizeEmbedUrl(url) {
    try {
      const parsed = new URL(url);
      if (isYoutubeEmbed(parsed.href)) {
        parsed.searchParams.set('enablejsapi', '1');
        parsed.searchParams.set('playsinline', '1');
        parsed.searchParams.set('origin', window.location.origin);
      }
      return parsed.toString();
    } catch {
      return url;
    }
  }

  function isYoutubeEmbed(url) {
    try {
      const host = new URL(String(url)).hostname;
      return host === 'www.youtube.com'
        || host === 'youtube.com'
        || host === 'www.youtube-nocookie.com'
        || host === 'youtube-nocookie.com';
    } catch {
      return false;
    }
  }

  function clearEmbedFallbackTimer() {
    if (embedFallbackTimer != null) {
      window.clearTimeout(embedFallbackTimer);
      embedFallbackTimer = null;
    }
  }

  function showEmptyPlayerState() {
    const title = document.getElementById('railcamTitle');
    const region = document.getElementById('railcamRegion');
    const meta = document.getElementById('railcamMeta');
    const notes = document.getElementById('railcamNotes');
    const iframe = document.getElementById('railcamPlayer');
    const openBtn = document.getElementById('railcamOpenBtn');
    if (!title || !region || !meta || !notes || !iframe || !openBtn) return;

    title.textContent = 'No camera in this filter';
    region.textContent = 'Global';
    meta.textContent = 'Try another filter chip';
    notes.textContent = 'Switch filters to continue browsing live camera sources.';
    iframe.src = 'about:blank';
    openBtn.href = '#';

    const fallback = document.getElementById('railcamFallback');
    if (fallback) fallback.hidden = true;
    clearEmbedFallbackTimer();
  }

  function getVisibleCams() {
    if (activeFilter === 'all') return CAMS;
    return CAMS.filter(cam => Array.isArray(cam.filters) && cam.filters.includes(activeFilter));
  }

  function isCamVisible(camId) {
    return getVisibleCams().some(cam => cam.id === camId);
  }

  function readSelectedCamId() {
    try {
      return localStorage.getItem('railyard.railcams.selected');
    } catch {
      return null;
    }
  }

  function persistSelectedCamId(camId) {
    try {
      localStorage.setItem('railyard.railcams.selected', camId);
    } catch {
      // Ignore storage errors.
    }
  }

  function readSelectedFilter() {
    try {
      const stored = localStorage.getItem('railyard.railcams.filter') || 'all';
      return FILTERS.some(filter => filter.id === stored) ? stored : 'all';
    } catch {
      return 'all';
    }
  }

  function persistSelectedFilter(filterId) {
    try {
      localStorage.setItem('railyard.railcams.filter', filterId);
    } catch {
      // Ignore storage errors.
    }
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  return { init };
})();
