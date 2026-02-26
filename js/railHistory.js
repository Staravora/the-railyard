/**
 * railHistory.js — "This Day in Rail" widget using Wikipedia on-this-day API
 */

const RailHistoryModule = (() => {
  const RAIL_REGEX = /railway|railroad|locomotive|train|rail(?:way)?|amtrak|transit|metro|subway|tram|monorail|funicular|maglev|steam engine|diesel|depot|station|signal|grade crossing/i;

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

      if (results.length === 0) {
        content.innerHTML = `<div class="history-empty">
          🚂 No specific rail events found for today in Wikipedia.<br>
          Check back tomorrow for more rail history!
        </div>`;
        return;
      }

      content.innerHTML = results.map(item => renderCard(item)).join('');
    } catch (err) {
      console.warn('[railHistory] fetch failed:', err);
      content.innerHTML = `<div class="history-empty">
        Could not load rail history. Please check your connection.
      </div>`;
    }
  }

  async function fetchRailEvents(month, day) {
    const types = ['events', 'births', 'deaths'];
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
          if (RAIL_REGEX.test(text)) {
            allItems.push({
              type,
              year: item.year,
              text,
              pages: item.pages || [],
            });
          }
        });
      } catch {
        // Ignore per-type failures
      }
    }));

    // Sort by year descending (most recent first)
    allItems.sort((a, b) => b.year - a.year);

    return allItems;
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
    for (const page of item.pages) {
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
