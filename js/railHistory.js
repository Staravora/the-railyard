/**
 * railHistory.js — "This Day in Rail" widget using Wikipedia on-this-day API
 */

const RailHistoryModule = (() => {
  const STRONG_RAIL_REGEX = /railway|railroad|locomotive|amtrak|intercity rail|high-speed rail|streetcar|tram|subway|metro|funicular|monorail|maglev|rail transport/i;
  const SOFT_RAIL_REGEX = /train|station|depot|signal|switch|grade crossing|tunnel|rail line|commuter rail|passenger rail|freight rail|diesel|steam engine/i;
  const EXCLUSION_REGEX = /music|song|album|film|television|football|baseball|basketball|video game/i;

  const FALLBACK_EVENTS = [
    {
      year: 1825,
      text: 'Stockton and Darlington Railway opens in England, widely regarded as the dawn of modern public railways.'
    },
    {
      year: 1869,
      text: 'Completion of the first U.S. transcontinental railroad links the Atlantic and Pacific rail networks.'
    },
    {
      year: 1934,
      text: 'Burlington Zephyr demonstrates streamlined diesel passenger service and reshapes rail design language.'
    }
  ];

  async function init() {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');

    // Display date
    const dateEl = document.getElementById('historyDate');
    if (dateEl) {
      dateEl.textContent = now.toLocaleDateString([], { month: 'long', day: 'numeric' });
    }

    const content = document.getElementById('railHistoryContent');
    if (!content) return;

    try {
      const results = await fetchRailEvents(month, day);

      const displayItems = results.length > 0 ? results : FALLBACK_EVENTS;
      content.innerHTML = displayItems.map(item => renderCard(item)).join('');
    } catch (err) {
      console.warn('[railHistory] fetch failed:', err);
      content.innerHTML = FALLBACK_EVENTS.map(item => renderCard(item)).join('');
    }
  }

  async function fetchRailEvents(month, day) {
    const types = ['events'];
    const allItems = [];

    await Promise.all(types.map(async (type) => {
      try {
        const url = `https://en.wikipedia.org/api/rest_v1/feed/onthisday/${type}/${month}/${day}`;
        const res = await fetch(url, {
          headers: { 'Accept': 'application/json' }
        });
        if (!res.ok) return;

        const data = await res.json();
        const items = data[type] || [];

          items.forEach(item => {
            const text = item.text || '';
            const score = scoreRailRelevance(text);
            if (score < 2) return;

            allItems.push({
              type,
              year: item.year,
              text,
              pages: item.pages || [],
              score
            });
          });
        } catch {
          // Ignore per-type failures
        }
      }));

    allItems.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.year - a.year;
    });

    return allItems.slice(0, 10);
  }

  function scoreRailRelevance(text) {
    if (!text) return 0;
    if (EXCLUSION_REGEX.test(text)) return 0;

    let score = 0;
    if (STRONG_RAIL_REGEX.test(text)) score += 3;

    const softHits = text.match(new RegExp(SOFT_RAIL_REGEX.source, 'ig')) || [];
    score += Math.min(softHits.length, 3);

    return score;
  }

  function renderCard(item) {
    const typeLabel = item.type === 'births' ? 'Birth'
      : item.type === 'deaths' ? 'Death'
      : 'Event';

    const typeClass = item.type === 'births' ? 'birth'
      : item.type === 'deaths' ? 'death'
      : 'event';

    // Find a thumbnail from the first Wikipedia page that has one
    let thumbHTML = '';
    const pages = Array.isArray(item.pages) ? item.pages : [];
    for (const page of pages) {
      const thumb = page.thumbnail;
      if (thumb && thumb.source) {
        thumbHTML = `<img class="history-card-thumb" src="${esc(thumb.source)}" alt="" loading="lazy" onerror="this.remove()"/>`;
        break;
      }
    }

    // Sanitize text — Wikipedia sometimes includes wikitext markup
    const cleanText = item.text
      .replace(/\[\[([^\]|]+\|)?([^\]]+)\]\]/g, '$2')  // wikilinks [[target|label]] → label
      .replace(/'''/g, '')
      .replace(/''/g, '');

    return `<div class="history-card">
      <span class="history-card-type ${typeClass}">${typeLabel}</span>
      <div class="history-card-year">${item.year}</div>
      <div class="history-card-text">${esc(cleanText)}</div>
      ${thumbHTML}
    </div>`;
  }

  function esc(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  return { init };
})();
