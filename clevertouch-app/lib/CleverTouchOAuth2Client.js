'use strict';

const { OAuth2Client } = require('homey-oauth2app');
const fetch = require('node-fetch');

// API base URLs for different brands
const API_BASES = {
  'purmo': 'https://purmo.dpm-portal.com',
  'frico': 'https://frico.dpm-portal.com',
  'fenix': 'https://fenix.dpm-portal.com'
};

class CleverTouchOAuth2Client extends OAuth2Client {

  /**
   * Get API base URL based on model ID
   */
  get apiBaseUrl() {
    const modelId = this.getHomey().settings.get('model_id') || 'purmo';
    return API_BASES[modelId] || API_BASES['purmo'];
  }

  /**
   * Override token URL
   */
  static get TOKEN_URL() {
    // This will be set dynamically per brand
    return 'https://purmo.dpm-portal.com/api/authenticateuser';
  }

  /**
   * Override API URL (not used for OAuth2 but needed for base class)
   */
  static get API_URL() {
    return 'https://purmo.dpm-portal.com';
  }

  /**
   * Get user data from API
   */
  async getUser() {
    return this._apiCall('POST', '/api/readuser', {});
  }

  /**
   * Get home data
   */
  async getHome(homeId) {
    return this._apiCall('POST', '/api/readhome', { home_id: homeId });
  }

  /**
   * Get all devices from a home
   */
  async getDevices(homeId) {
    const homeData = await this.getHome(homeId);
    return homeData.devices || [];
  }

  /**
   * Get specific device data
   */
  async getDeviceData(homeId, deviceId) {
    const devices = await this.getDevices(homeId);
    return devices.find(d => d.id === deviceId);
  }

  /**
   * Set device mode (Off/Frost/Eco/Comfort/Program/Boost)
   */
  async setDeviceMode(homeId, deviceLocalId, mode) {
    return this._apiCall('POST', '/api/querypush', {
      home_id: homeId,
      dev_local_id: deviceLocalId,
      gv_mode: mode
    });
  }

  /**
   * Set device temperature preset
   */
  async setDeviceTemperature(homeId, deviceLocalId, type, value) {
    const paramName = `gv_setpoint_${type}`;
    return this._apiCall('POST', '/api/querypush', {
      home_id: homeId,
      dev_local_id: deviceLocalId,
      [paramName]: value
    });
  }

  /**
   * Set multiple device presets at once
   */
  async setDevicePresets(homeId, deviceLocalId, presets) {
    const params = {
      home_id: homeId,
      dev_local_id: deviceLocalId
    };

    if (presets.comfort !== undefined) {
      params.gv_setpoint_comfort = presets.comfort;
    }
    if (presets.eco !== undefined) {
      params.gv_setpoint_eco = presets.eco;
    }
    if (presets.frost !== undefined) {
      params.gv_setpoint_frost = presets.frost;
    }

    return this._apiCall('POST', '/api/querypush', params);
  }

  /**
   * Internal API call method with timeout and retry
   */
  async _apiCall(method, path, data) {
    const maxRetries = 3;
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Setup abort controller for timeout
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        try {
          const response = await fetch(this.apiBaseUrl + path, {
            method,
            headers: {
              'Authorization': `Bearer ${this.getAccessToken()}`,
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: data ? new URLSearchParams(data) : undefined,
            signal: controller.signal
          });

          clearTimeout(timeout);

          if (response.status === 401) {
            // Token expired - this will trigger automatic refresh by OAuth2App
            throw new Error('Unauthorized');
          }

          if (!response.ok) {
            throw new Error(`API error: ${response.status} ${response.statusText}`);
          }

          return await response.json();

        } catch (fetchError) {
          clearTimeout(timeout);

          if (fetchError.name === 'AbortError') {
            throw new Error('Request timeout after 10 seconds');
          }
          throw fetchError;
        }

      } catch (error) {
        lastError = error;
        this.log(`API call failed (attempt ${attempt}/${maxRetries}):`, error.message);

        if (attempt < maxRetries) {
          // Backoff with jitter (linear backoff + random 0-500ms)
          await this._sleep(1000 * attempt + Math.random() * 500);
        }
      }
    }

    throw lastError;
  }

  /**
   * Sleep helper
   */
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

}

module.exports = CleverTouchOAuth2Client;
