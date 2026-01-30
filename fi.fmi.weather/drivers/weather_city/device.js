'use strict';

const Homey = require('homey');

class WeatherCityDevice extends Homey.Device {
  async onInit() {
    this.log('[weather_city] Device initialized:', this.getName());

    this.pollTimer = null;
    this.retryCount = 0;
    this.maxRetries = 3;
    this.baseRetryDelay = 60000; // 1 minute

    // Register settings change listener
    this.registerCapabilityListener('measure_temperature', async (value) => {
      this.log('[weather_city] Temperature updated:', value);
    });

    // Start polling
    this.startPolling();
  }

  startPolling() {
    // Clear any existing timer
    if (this.pollTimer) {
      this.homey.clearInterval(this.pollTimer);
    }

    const intervalMinutes = this.getSetting('pollInterval') || 15;
    const intervalMs = intervalMinutes * 60 * 1000;
    // Add jitter (0-30 seconds) to avoid thundering herd
    const jitter = Math.random() * 30000;

    this.log(`[weather_city] Starting polling every ${intervalMinutes} min (+ ${Math.round(jitter / 1000)}s jitter)`);

    // Immediate first fetch
    this.fetchWeather();

    // Schedule subsequent fetches
    this.pollTimer = this.homey.setInterval(() => {
      this.fetchWeather();
    }, intervalMs + jitter);
  }

  async fetchWeather() {
    const city = this.getSetting('city') || 'Helsinki';
    const url = `http://opendata.fmi.fi/wfs?service=WFS&version=2.0.0&request=getFeature&storedquery_id=fmi::observations::weather::simple&place=${encodeURIComponent(city)}&parameters=temperature`;

    this.log(`[weather_city] Fetching weather for ${city}`);

    try {
      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'HomeyFMIWeather/1.0',
        },
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const xml = await res.text();
      const temp = this.parseTemperature(xml);

      if (temp !== null) {
        await this.setCapabilityValue('measure_temperature', temp);
        await this.setAvailable();
        this.retryCount = 0; // Reset retry count on success
        this.log(`[weather_city] Temperature updated: ${temp}°C`);
      } else {
        this.log('[weather_city] No temperature data in response');
        await this.handleFetchError(new Error('No temperature data in API response'));
      }
    } catch (err) {
      await this.handleFetchError(err);
    }
  }

  async handleFetchError(err) {
    this.error('[weather_city] Fetch failed:', err.message);
    this.retryCount++;

    if (this.retryCount >= this.maxRetries) {
      await this.setUnavailable(`API unreachable: ${err.message}`);
      this.log('[weather_city] Max retries reached, device marked unavailable');
    } else {
      // Schedule retry with exponential backoff
      const delay = this.baseRetryDelay * Math.pow(2, this.retryCount - 1);
      this.log(`[weather_city] Scheduling retry ${this.retryCount}/${this.maxRetries} in ${delay / 1000}s`);
      this.homey.setTimeout(() => this.fetchWeather(), delay);
    }
  }

  parseTemperature(xml) {
    // FMI WFS returns multiple observations; get the most recent one
    // Look for temperature values in BsWfs:ParameterValue elements
    const matches = xml.matchAll(/<BsWfs:ParameterValue>([0-9.-]+)<\/BsWfs:ParameterValue>/g);
    const values = [...matches].map((m) => parseFloat(m[1]));

    if (values.length > 0) {
      // Return the last (most recent) temperature value
      return values[values.length - 1];
    }
    return null;
  }

  async onSettings({ oldSettings, newSettings, changedKeys }) {
    this.log('[weather_city] Settings changed:', changedKeys);

    if (changedKeys.includes('city') || changedKeys.includes('pollInterval')) {
      // Restart polling with new settings
      this.retryCount = 0;
      this.startPolling();
    }
  }

  onDeleted() {
    this.log('[weather_city] Device deleted');
    if (this.pollTimer) {
      this.homey.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}

module.exports = WeatherCityDevice;
