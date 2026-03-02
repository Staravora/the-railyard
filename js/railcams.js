/**
 * railcams.js — North America rail camera directory + player.
 */

const RailcamsModule = (() => {
  const FILTERS = [
    { id: 'all', label: 'All' },
    { id: 'freight', label: 'Freight Heavy' },
    { id: 'mountain', label: 'Mountain' },
    { id: 'urban', label: 'Urban' },
    { id: 'canada', label: 'Canada' },
  ];

  const CAMS = [
    {
      id: 'tehachapi',
      name: 'Tehachapi Loop Watch',
      region: 'California, US',
      note: 'Channel feed focused on western freight corridors and railfan cams.',
      lat: 35.1314,
      lng: -118.4831,
      zoom: 11,
      embedUrl: 'https://www.youtube.com/embed/videoseries?list=UUIWjTTrzVo2RGgK2gortxGw',
      sourceUrl: 'https://www.youtube.com/channel/UCIWjTTrzVo2RGgK2gortxGw',
      tags: ['BNSF', 'UP', 'Mountain grade'],
      filters: ['freight', 'mountain'],
    },
    {
      id: 'cajon',
      name: 'Cajon Pass Dispatch View',
      region: 'California, US',
      note: 'Good corridor context for heavy freight movements through Southern California.',
      lat: 34.3208,
      lng: -117.4689,
      zoom: 10,
      embedUrl: 'https://www.youtube.com/embed/videoseries?list=UUW3ztjFA4AoU4pXCTKb4rMQ',
      sourceUrl: 'https://www.youtube.com/channel/UCW3ztjFA4AoU4pXCTKb4rMQ',
      tags: ['BNSF', 'UP', 'Freight focus'],
      filters: ['freight', 'mountain'],
    },
    {
      id: 'fort-madison',
      name: 'Fort Madison River Crossing',
      region: 'Iowa, US',
      note: 'Midwest camera/archive feed with frequent long freight consists.',
      lat: 40.6306,
      lng: -91.3145,
      zoom: 12,
      embedUrl: 'https://www.youtube.com/embed/videoseries?list=UUHwO6ybr9_--FvMui3-2_EA',
      sourceUrl: 'https://www.youtube.com/channel/UCHwO6ybr9_--FvMui3-2_EA',
      tags: ['BNSF', 'Amtrak', 'River crossing'],
      filters: ['freight'],
    },
    {
      id: 'horseshoe',
      name: 'Horseshoe Curve Watch',
      region: 'Pennsylvania, US',
      note: 'Appalachian-focused feed suited to mixed manifest and intermodal traffic.',
      lat: 40.4967,
      lng: -78.4111,
      zoom: 12,
      embedUrl: 'https://www.youtube.com/embed/videoseries?list=UUrtIIVfi-5tMlVXdMDzOMUA',
      sourceUrl: 'https://www.youtube.com/channel/UCrtIIVfi-5tMlVXdMDzOMUA',
      tags: ['Norfolk Southern', 'Helpers', 'Historic route'],
      filters: ['freight', 'mountain'],
    },
    {
      id: 'chicago',
      name: 'Chicago Junctions',
      region: 'Illinois, US',
      note: 'Urban terminal camera feed for dense North American rail hubs.',
      lat: 41.8781,
      lng: -87.6298,
      zoom: 9,
      embedUrl: 'https://www.youtube.com/embed/videoseries?list=UU1BPUOehswCUydiOQ6twZKw',
      sourceUrl: 'https://www.youtube.com/channel/UC1BPUOehswCUydiOQ6twZKw',
      tags: ['Intermodal', 'Commuter', 'Freight bottleneck'],
      filters: ['freight', 'urban'],
    },
    {
      id: 'canada-west',
      name: 'Western Canada Mainline',
      region: 'Alberta / BC, CA',
      note: 'Canada-oriented railcam/archive feed for long-haul operations.',
      lat: 51.0486,
      lng: -114.0708,
      zoom: 7,
      embedUrl: 'https://www.youtube.com/embed/videoseries?list=UU6YuojLzzdEMjbFiMHyecug',
      sourceUrl: 'https://www.youtube.com/channel/UC6YuojLzzdEMjbFiMHyecug',
      tags: ['CPKC', 'CN', 'Long-haul freight'],
      filters: ['freight', 'mountain', 'canada'],
    },
  ];

  let selectedCamId = null;
  let activeFilter = 'all';
  let embedFallbackTimer = null;
  let currentEmbedAttempt = 0;

  function init() {
    const list = document.getElementById('railcamList');
    if (!list) return;

    selectedCamId = readSelectedCamId() || CAMS[0].id;
    activeFilter = readSelectedFilter() || 'all';
    renderFilters();
    renderList();

    if (!isCamVisible(selectedCamId)) {
      const firstVisible = getVisibleCams()[0];
      selectedCamId = firstVisible ? firstVisible.id : CAMS[0].id;
    }

    window.addEventListener('message', onPlayerMessage);

    selectCam(selectedCamId, { scrollIntoView: false });
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
    meta.textContent = `${cam.tags.join(' • ')}`;
    notes.textContent = cam.note;

    setPlayerSource(cam.embedUrl, cam.sourceUrl);
    openBtn.href = cam.sourceUrl;

    mapBtn.onclick = () => {
      document.dispatchEvent(new CustomEvent('railyard:focus-map', {
        detail: {
          lat: cam.lat,
          lng: cam.lng,
          zoom: cam.zoom || 11,
          label: cam.name,
        }
      }));
    };
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
    const hasError = payload.event === 'onError' || payload.info?.playerState === -1;

    if (hasReady) {
      clearEmbedFallbackTimer();
      fallback.hidden = true;
      return;
    }

    if (hasError || eventName === 'error') {
      clearEmbedFallbackTimer();
      fallback.hidden = false;
    }
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
    region.textContent = 'North America';
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
