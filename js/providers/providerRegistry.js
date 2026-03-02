/**
 * providerRegistry.js — Unified feed adapter registry.
 */

const FeedRegistryModule = (() => {
  const providers = [];
  const statuses = new Map();
  let initialized = false;

  function registerProvider(provider) {
    if (!provider || !provider.id || typeof provider.fetchTrains !== 'function') return;
    if (providers.some(p => p.id === provider.id)) return;

    providers.push(provider);
    statuses.set(provider.id, {
      id: provider.id,
      label: provider.label || provider.id,
      enabled: provider.enabled !== false,
      country: provider.country || 'Unknown',
      ok: false,
      lastSuccessAt: null,
      lastErrorAt: null,
      errorCount: 0,
      latencyMs: null,
      lastError: null,
    });
  }

  function init() {
    if (initialized) return;
    initialized = true;

    if (typeof AmtrakProvider !== 'undefined') {
      registerProvider(AmtrakProvider);
    }

    if (typeof UkNetworkRailProvider !== 'undefined') {
      registerProvider(UkNetworkRailProvider);
    }

    if (typeof FinlandProvider !== 'undefined') {
      registerProvider(FinlandProvider);
    }

    if (typeof GermanyProvider !== 'undefined') {
      registerProvider(GermanyProvider);
    } else {
      registerProvider(makePlaceholderProvider('de-db', 'Deutsche Bahn', 'DE'));
    }

    if (typeof MalaysiaProvider !== 'undefined') {
      registerProvider(MalaysiaProvider);
    }

    if (typeof AustraliaProvider !== 'undefined') {
      registerProvider(AustraliaProvider);
    } else {
      registerProvider(makePlaceholderProvider('au-nsw', 'NSW TrainLink', 'AU'));
    }

    registerProvider(makePlaceholderProvider('fr-sncf', 'SNCF', 'FR'));
    registerProvider(makePlaceholderProvider('be-sncb', 'SNCB', 'BE'));
  }

  function makePlaceholderProvider(id, label, country) {
    return {
      id,
      label,
      country,
      enabled: false,
      fetchTrains: async () => [],
    };
  }

  async function fetchUnifiedTrains() {
    init();

    const enabledProviders = providers.filter(provider => provider.enabled !== false);
    const tasks = enabledProviders.map(async provider => {
      const start = Date.now();
      try {
        const trains = await provider.fetchTrains();
        const status = statuses.get(provider.id);
        const now = new Date().toISOString();
        if (status) {
          status.ok = true;
          status.lastSuccessAt = now;
          status.latencyMs = Date.now() - start;
          status.lastError = null;
        }
        return { providerId: provider.id, ok: true, trains };
      } catch (err) {
        const status = statuses.get(provider.id);
        const now = new Date().toISOString();
        if (status) {
          status.ok = false;
          status.lastErrorAt = now;
          status.errorCount += 1;
          status.lastError = err && err.message ? err.message : 'Unknown error';
          status.latencyMs = Date.now() - start;
        }
        return { providerId: provider.id, ok: false, trains: [] };
      }
    });

    const results = await Promise.all(tasks);
    const trains = results.flatMap(result => result.trains || []);
    const successCount = results.filter(result => result.ok).length;
    const failureCount = results.length - successCount;

    return {
      trains,
      successCount,
      failureCount,
      providerStatuses: getProviderStatuses(),
      lastUpdatedAt: new Date().toISOString(),
    };
  }

  function getProviderStatuses() {
    init();
    return providers.map(provider => ({
      ...statuses.get(provider.id),
      enabled: provider.enabled !== false,
    }));
  }

  return {
    init,
    registerProvider,
    fetchUnifiedTrains,
    getProviderStatuses,
  };
})();
