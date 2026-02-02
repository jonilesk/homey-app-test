'use strict';

const { OAuth2Client, OAuth2Token } = require('homey-oauth2app');
const fetch = require('node-fetch');

// Brand configuration - host and realm for each brand
const BRAND_CONFIG = {
  'purmo': { host: 'e3.lvi.eu', realm: 'purmo' },
  'waltermeier': { host: 'www.smartcomfort.waltermeier.com', realm: 'waltermeier' },
  'frico': { host: 'fricopfsmart.frico.se', realm: 'frico' },
  'fenix': { host: 'v24.fenixgroup.eu', realm: 'fenix' },
  'vogelundnoot': { host: 'e3.vogelundnoot.com', realm: 'vogelundnoot' },
  'cordivari': { host: 'cordivarihome.com', realm: 'cordivari' }
};

const CLIENT_ID = 'app-front';

class CleverTouchOAuth2Client extends OAuth2Client {

  // Static OAuth2 configuration required by homey-oauth2app
  static CLIENT_ID = 'app-front';
  static CLIENT_SECRET = ''; // Not used for password grant, but required by library

  /**
   * Get brand config
   */
  getBrandConfig() {
    const modelId = this._brandId || 'purmo';
    return BRAND_CONFIG[modelId] || BRAND_CONFIG['purmo'];
  }

  /**
   * Set brand ID (called during pairing)
   */
  setBrandId(brandId) {
    this._brandId = brandId;
    this.log(`[OAuth2] Brand set to: ${brandId}`);
  }

  /**
   * Get API base URL based on brand
   */
  get apiBaseUrl() {
    const config = this.getBrandConfig();
    return `https://${config.host}/api/v0.1`;
  }

  /**
   * Get token URL based on brand
   */
  get tokenUrl() {
    const config = this.getBrandConfig();
    return `https://auth.${config.host}/realms/${config.realm}/protocol/openid-connect/token`;
  }

  /**
   * Override token URL (static fallback)
   */
  static get TOKEN_URL() {
    return 'https://auth.e3.lvi.eu/realms/purmo/protocol/openid-connect/token';
  }

  /**
   * Override API URL
   */
  static get API_URL() {
    return 'https://e3.lvi.eu/api/v0.1';
  }

  /**
   * Handle password grant authentication (called by login_credentials template)
   */
  async onGetTokenByCredentials({ username, password }) {
    this.log(`[OAuth2] Getting token by credentials for: ${username}`);
    
    // Store email for later API calls
    this._email = username;
    
    const tokenUrl = this.tokenUrl;
    this.log(`[OAuth2] Token URL: ${tokenUrl}`);
    
    try {
      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          grant_type: 'password',
          client_id: CLIENT_ID,
          username: username,
          password: password
        })
      });

      this.log(`[OAuth2] Token response status: ${response.status}`);

      if (!response.ok) {
        const errorText = await response.text();
        this.log(`[OAuth2] Token error: ${errorText}`);
        throw new Error(`Authentication failed: ${response.status}`);
      }

      const tokenData = await response.json();
      this.log(`[OAuth2] Token received, expires_in: ${tokenData.expires_in}`);

      // Store email in settings for later use
      this.homey.settings.set('clevertouch_email', username);

      return new OAuth2Token({
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        token_type: tokenData.token_type || 'Bearer',
        expires_in: tokenData.expires_in
      });
    } catch (error) {
      this.log(`[OAuth2] Token error:`, error);
      throw error;
    }
  }

  /**
   * Handle token refresh
   */
  async onRefreshToken() {
    this.log('[OAuth2] Refreshing token...');
    
    const token = this.getToken();
    if (!token?.refresh_token) {
      throw new Error('No refresh token available');
    }

    const tokenUrl = this.tokenUrl;
    
    try {
      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: CLIENT_ID,
          refresh_token: token.refresh_token
        })
      });

      this.log(`[OAuth2] Refresh response status: ${response.status}`);

      if (!response.ok) {
        const errorText = await response.text();
        this.log(`[OAuth2] Refresh error: ${errorText}`);
        throw new Error(`Token refresh failed: ${response.status}`);
      }

      const tokenData = await response.json();
      this.log(`[OAuth2] Token refreshed, expires_in: ${tokenData.expires_in}`);

      return new OAuth2Token({
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        token_type: tokenData.token_type || 'Bearer',
        expires_in: tokenData.expires_in
      });
    } catch (error) {
      this.log(`[OAuth2] Refresh error:`, error);
      throw error;
    }
  }

  /**
   * Get user data from API
   */
  async getUser(email) {
    const response = await this._apiCall('POST', '/human/user/read/', { email });
    if (response.code?.code !== 1) {
      throw new Error(`API error: ${response.code?.value || 'Unknown error'}`);
    }
    return response.data;
  }

  /**
   * Get home data
   */
  async getHome(homeId) {
    const response = await this._apiCall('POST', '/human/smarthome/read/', { smarthome_id: homeId });
    if (response.code?.code !== 1) {
      throw new Error(`API error: ${response.code?.value || 'Unknown error'}`);
    }
    return response.data;
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
    return devices.find(d => d.id === deviceId || d.id_device === deviceId);
  }

  /**
   * Set device mode (Off/Frost/Eco/Comfort/Program/Boost)
   * Mode values: 0=Off, 1=Frost, 2=Eco, 3=Comfort, 4=Program, 5=Boost
   */
  async setDeviceMode(homeId, deviceLocalId, mode) {
    const response = await this._apiCall('POST', '/human/query/push/', {
      smarthome_id: homeId,
      context: '1',
      peremption: '15000',
      'query[id_device]': deviceLocalId,
      'query[gv_mode]': String(mode),
      'query[nv_mode]': String(mode)
    });
    if (response.code?.code !== 8) {
      throw new Error(`API error: ${response.code?.value || 'Unknown error'}`);
    }
    return response;
  }

  /**
   * Set device temperature preset (value in device units = celsius * 10)
   */
  async setDeviceTemperature(homeId, deviceLocalId, type, value) {
    const paramName = type === 'comfort' ? 'consigne_confort' :
                      type === 'eco' ? 'consigne_eco' :
                      type === 'frost' ? 'consigne_hg' : 'consigne_boost';
    
    const response = await this._apiCall('POST', '/human/query/push/', {
      smarthome_id: homeId,
      context: '1',
      peremption: '15000',
      'query[id_device]': deviceLocalId,
      [`query[${paramName}]`]: String(value)
    });
    if (response.code?.code !== 8) {
      throw new Error(`API error: ${response.code?.value || 'Unknown error'}`);
    }
    return response;
  }

  /**
   * Set multiple device presets at once
   */
  async setDevicePresets(homeId, deviceLocalId, presets) {
    const params = {
      smarthome_id: homeId,
      context: '1',
      peremption: '15000',
      'query[id_device]': deviceLocalId
    };

    if (presets.comfort !== undefined) {
      params['query[consigne_confort]'] = String(presets.comfort);
    }
    if (presets.eco !== undefined) {
      params['query[consigne_eco]'] = String(presets.eco);
    }
    if (presets.frost !== undefined) {
      params['query[consigne_hg]'] = String(presets.frost);
    }

    const response = await this._apiCall('POST', '/human/query/push/', params);
    if (response.code?.code !== 8) {
      throw new Error(`API error: ${response.code?.value || 'Unknown error'}`);
    }
    return response;
  }

  /**
   * Internal API call method with timeout and retry
   */
  async _apiCall(method, path, data) {
    const maxRetries = 3;
    let lastError;

    this.log(`[API] Starting ${method} ${path}`);
    this.log(`[API] Base URL: ${this.apiBaseUrl}`);
    this.log(`[API] Data:`, JSON.stringify(data));

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Setup abort controller for timeout
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        const accessToken = this.getToken()?.access_token;
        this.log(`[API] Access token exists: ${!!accessToken}`);
        if (accessToken) {
          this.log(`[API] Token preview: ${accessToken.substring(0, 20)}...`);
        }

        try {
          const url = this.apiBaseUrl + path;
          this.log(`[API] Full URL: ${url}`);
          const response = await fetch(url, {
            method,
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: data ? new URLSearchParams(data) : undefined,
            signal: controller.signal
          });

          clearTimeout(timeout);

          this.log(`[API] Response status: ${response.status} ${response.statusText}`);

          if (response.status === 401) {
            // Token expired - this will trigger automatic refresh by OAuth2App
            this.log('[API] Got 401 Unauthorized - token may be expired');
            throw new Error('Unauthorized');
          }

          if (!response.ok) {
            const errorBody = await response.text();
            this.log(`[API] Error response body: ${errorBody}`);
            throw new Error(`API error: ${response.status} ${response.statusText}`);
          }

          const jsonResponse = await response.json();
          this.log(`[API] Response:`, JSON.stringify(jsonResponse).substring(0, 500));
          return jsonResponse;

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
