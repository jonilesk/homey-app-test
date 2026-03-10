'use strict';

const Homey = require('homey');
const SolcastApi = require('../../lib/SolcastApi');
const ForecastAggregator = require('../../lib/ForecastAggregator');

class ForecastDevice extends Homey.Device {

  async onInit() {
    this.log('ForecastDevice initializing');

    // Migrate settings added after initial pairing
    await this._migrateSettings();

    this._api = new SolcastApi({
      apiKey: this.getSetting('api_key'),
      timeout: 30000,
      logger: {
        log: (...args) => this.log('[API]', ...args),
        warn: (...args) => this.log('[API][warn]', ...args),
        error: (...args) => this.error('[API]', ...args),
      },
    });

    this._api.setQuotaLimit(this.getSetting('api_quota') || 10);

    // Load cached forecast data
    this._loadCache();

    // If we have cached data, update capabilities immediately
    if (this._forecasts && this._forecasts.length > 0) {
      this._updateCapabilitiesFromForecasts();
    }

    // Schedule daily API fetch at 03:00 local time
    this._scheduleDailyFetch();

    // Refresh capabilities every 60 minutes (recompute from cached forecasts)
    // This keeps power_now, power_30m etc. current without API calls
    this._refreshInterval = this.homey.setInterval(() => {
      if (this._forecasts && this._forecasts.length > 0) {
        this._updateCapabilitiesFromForecasts();
        this.log('[refresh] Capabilities recomputed from cache');
      }
    }, 60 * 60 * 1000);

    // Reset API usage at UTC midnight
    this._scheduleMidnightReset();
  }

  async updateForecast() {
    // Public method called by Flow action and scheduled updates
    this.log('[update] Fetching forecast...');

    try {
      const sites = this.getStoreValue('sites') || [];
      const siteIds = sites.map(s => s.resource_id);

      if (siteIds.length === 0) {
        throw new Error('No sites configured');
      }

      const forecasts = await this._api.getAllForecasts(siteIds, 168);
      this._forecasts = forecasts;
      this._saveCache();
      this._updateCapabilitiesFromForecasts();

      // Update API usage display
      const usage = this._api.getUsage();
      this._updateCapability('solcast_api_used', `${usage.used}/${usage.limit}`);
      this._updateCapability('solcast_last_updated', new Date().toLocaleTimeString());

      // Fire trigger
      this.homey.flow.getDeviceTriggerCard('forecast_updated')
        .trigger(this, {
          power_now: this.getCapabilityValue('measure_power') || 0,
          forecast_today: this.getCapabilityValue('solcast_forecast_today') || 0,
        })
        .catch(err => this.error('[trigger]', err));

      if (!this.getAvailable()) {
        await this.setAvailable();
      }

      this.log(`[update] Success — ${forecasts.length} intervals, API ${usage.used}/${usage.limit}`);

    } catch (error) {
      this.error('[update] Failed:', error.message);
      if (this.getAvailable()) {
        await this.setUnavailable(error.message);
      }
    }
  }

  _updateCapabilitiesFromForecasts() {
    const estimateType = this.getSetting('estimate_type') || 'pv_estimate';
    const hardLimit = this.getSetting('hard_limit') || 0;
    const timezone = this.homey.clock.getTimezone();

    const agg = new ForecastAggregator(this._forecasts, estimateType, hardLimit);
    const values = agg.getAll(timezone);

    this._updateCapability('measure_power', values.power_now);
    this._updateCapability('meter_power', values.forecast_today);
    this._updateCapability('solcast_power_30m', values.power_30m);
    this._updateCapability('solcast_power_1hr', values.power_1hr);
    this._updateCapability('solcast_forecast_today', values.forecast_today);
    this._updateCapability('solcast_forecast_tomorrow', values.forecast_tomorrow);
    this._updateCapability('solcast_forecast_remaining', values.forecast_remaining);
    this._updateCapability('solcast_forecast_this_hour', values.forecast_this_hour);
    this._updateCapability('solcast_forecast_next_hour', values.forecast_next_hour);
    this._updateCapability('solcast_peak_today', values.peak_today);
    this._updateCapability('solcast_peak_tomorrow', values.peak_tomorrow);
  }

  _updateCapability(name, value) {
    if (this.hasCapability(name) && this.getCapabilityValue(name) !== value) {
      this.setCapabilityValue(name, value)
        .catch(err => this.error(`Failed to set ${name}:`, err));
    }
  }

  _scheduleDailyFetch() {
    // Clear any existing daily timer
    if (this._dailyFetchTimer) {
      this.homey.clearTimeout(this._dailyFetchTimer);
      this._dailyFetchTimer = null;
    }

    const fetchHour = this._normalizeFetchHour(this.getSetting('fetch_hour'));
    const mode = this._normalizeUpdateMode(this.getSetting('update_mode'));

    if (mode === 'none') {
      this.log('[schedule] Manual mode — no automatic API fetch');
      return;
    }

    // Calculate ms until next fetch time in local timezone
    const msUntilFetch = this._msUntilLocalHour(fetchHour);
    const hoursUntil = Math.round(msUntilFetch / 3600000 * 10) / 10;
    this.log(`[schedule] Next API fetch at ${fetchHour}:00 local (in ${hoursUntil}h)`);

    this._dailyFetchTimer = this.homey.setTimeout(async () => {
      await this.updateForecast();
      // Re-schedule for tomorrow
      this._scheduleDailyFetch();
    }, msUntilFetch);
  }

  _msUntilLocalHour(targetHour) {
    const tz = this.homey.clock.getTimezone();
    const now = new Date();

    // Get current local hour
    const localHour = parseInt(new Intl.DateTimeFormat('en', {
      hour: 'numeric', hour12: false, timeZone: tz,
    }).format(now), 10);
    const localMinute = parseInt(new Intl.DateTimeFormat('en', {
      minute: 'numeric', timeZone: tz,
    }).format(now), 10);

    // Hours until target (wraps to next day if past)
    let hoursUntil = targetHour - localHour;
    if (hoursUntil < 0 || (hoursUntil === 0 && localMinute > 0)) {
      hoursUntil += 24;
    }

    return hoursUntil * 3600000 - localMinute * 60000;
  }

  _scheduleMidnightReset() {
    // Calculate ms until next UTC midnight
    const now = new Date();
    const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    const msUntilMidnight = tomorrow.getTime() - now.getTime();

    this._midnightTimer = this.homey.setTimeout(() => {
      this.log('[midnight] Resetting API usage counter');
      this._api.resetUsage();
      this._updateCapability('solcast_api_used', `0/${this.getSetting('api_quota') || 10}`);
      // Re-schedule for next midnight
      this._scheduleMidnightReset();
      // Re-schedule daily fetch for new day
      this._scheduleDailyFetch();
    }, msUntilMidnight + 1000); // +1s buffer
  }

  _loadCache() {
    try {
      const cached = this.getStoreValue('forecast_cache');
      if (cached && Array.isArray(cached)) {
        this._forecasts = cached;
        this.log(`[cache] Loaded ${cached.length} cached forecast intervals`);
      } else {
        this._forecasts = [];
      }
    } catch {
      this._forecasts = [];
    }
  }

  _saveCache() {
    try {
      // Only cache recent + future data (prune old entries)
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const pruned = this._forecasts.filter(f => f.period_end > cutoff);
      this.setStoreValue('forecast_cache', pruned).catch(err =>
        this.error('[cache] Failed to save:', err)
      );
    } catch (err) {
      this.error('[cache] Save error:', err);
    }
  }

  async _migrateSettings() {
    const updates = {};

    const mode = this._normalizeUpdateMode(this.getSetting('update_mode'));
    if (mode !== this.getSetting('update_mode')) {
      updates.update_mode = mode;
    }

    const fetchHour = this._normalizeFetchHour(this.getSetting('fetch_hour'));
    if (fetchHour !== this.getSetting('fetch_hour')) {
      updates.fetch_hour = fetchHour;
    }

    const estimateType = this._normalizeEstimateType(this.getSetting('estimate_type'));
    if (estimateType !== this.getSetting('estimate_type')) {
      updates.estimate_type = estimateType;
    }

    const hardLimit = this._normalizeHardLimit(this.getSetting('hard_limit'));
    if (hardLimit !== this.getSetting('hard_limit')) {
      updates.hard_limit = hardLimit;
    }

    const apiQuota = this._normalizeApiQuota(this.getSetting('api_quota'));
    if (apiQuota !== this.getSetting('api_quota')) {
      updates.api_quota = apiQuota;
    }

    if (Object.keys(updates).length > 0) {
      this.log('[migrate] Setting defaults:', updates);
      await this.setSettings(updates).catch(err =>
        this.error('[migrate] Failed to set defaults:', err)
      );
    }
  }

  _normalizeUpdateMode(value) {
    // Map legacy values to valid dropdown IDs.
    const mode = String(value || '').toLowerCase();
    if (mode === 'none' || mode === 'daily') {
      return mode;
    }
    if (mode === 'manual' || mode === 'off' || mode === 'disabled') {
      return 'none';
    }
    return 'daily';
  }

  _normalizeFetchHour(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) {
      return 3;
    }
    return Math.min(23, Math.max(0, Math.round(n)));
  }

  _normalizeEstimateType(value) {
    if (value === 'pv_estimate' || value === 'pv_estimate10' || value === 'pv_estimate90') {
      return value;
    }
    return 'pv_estimate';
  }

  _normalizeHardLimit(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) {
      return 0;
    }
    return Math.min(100, Math.max(0, n));
  }

  _normalizeApiQuota(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) {
      return 10;
    }
    return Math.min(100, Math.max(1, Math.round(n)));
  }

  async onSettings({ oldSettings, newSettings, changedKeys }) {
    this.log('Settings changed:', changedKeys);

    if (changedKeys.includes('api_key')) {
      this._api = new SolcastApi({
        apiKey: newSettings.api_key,
        timeout: 30000,
        logger: {
          log: (...args) => this.log('[API]', ...args),
          warn: (...args) => this.log('[API][warn]', ...args),
          error: (...args) => this.error('[API]', ...args),
        },
      });
    }

    if (changedKeys.includes('api_quota')) {
      this._api.setQuotaLimit(newSettings.api_quota);
    }

    if (changedKeys.includes('update_mode') || changedKeys.includes('fetch_hour')) {
      this._scheduleDailyFetch();
    }

    if (changedKeys.includes('estimate_type') || changedKeys.includes('hard_limit')) {
      // Recompute from cached data
      if (this._forecasts && this._forecasts.length > 0) {
        this._updateCapabilitiesFromForecasts();
      }
    }
  }

  async onUninit() {
    this.log('Device uninitializing');

    if (this._dailyFetchTimer) {
      this.homey.clearTimeout(this._dailyFetchTimer);
      this._dailyFetchTimer = null;
    }
    if (this._refreshInterval) {
      this.homey.clearInterval(this._refreshInterval);
      this._refreshInterval = null;
    }
    if (this._midnightTimer) {
      this.homey.clearTimeout(this._midnightTimer);
      this._midnightTimer = null;
    }
  }

  async onDeleted() {
    this.log('Device deleted');
  }
}

module.exports = ForecastDevice;
