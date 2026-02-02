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

// Refresh token when 80% of its lifetime has passed
const TOKEN_REFRESH_THRESHOLD = 0.8;

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
      this.log(`[OAuth2] Token received, expires_in: ${tokenData.expires_in}, has refresh_token: ${!!tokenData.refresh_token}`);

      // Store email in settings for later use
      this.homey.settings.set('clevertouch_email', username);

      // Calculate and store token expiration timestamp
      const expiresAt = Date.now() + (tokenData.expires_in * 1000);
      this.homey.settings.set('clevertouch_token_expires_at', expiresAt);
      this.log(`[OAuth2] Token expires at: ${new Date(expiresAt).toISOString()}`);

      // Store refresh token separately as backup
      if (tokenData.refresh_token) {
        this.homey.settings.set('clevertouch_refresh_token', tokenData.refresh_token);
        this.log(`[OAuth2] Refresh token stored in settings as backup`);
      }
      // Store access token as backup
      if (tokenData.access_token) {
        this.homey.settings.set('clevertouch_access_token', tokenData.access_token);
        this.log(`[OAuth2] Access token stored in settings as backup`);
      }

      const token = new OAuth2Token({
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        token_type: tokenData.token_type || 'Bearer',
        expires_in: tokenData.expires_in
      });

      return token;
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
    
    // Try to get refresh token from token object first, then from settings backup
    let refreshToken = this.getToken()?.refresh_token;
    
    if (!refreshToken) {
      this.log('[OAuth2] No refresh token in token object, trying settings backup...');
      refreshToken = this.homey.settings.get('clevertouch_refresh_token');
    }
    
    if (!refreshToken) {
      this.log('[OAuth2] No refresh token available anywhere');
      throw new Error('No refresh token available');
    }

    this.log('[OAuth2] Found refresh token, proceeding with refresh');
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
          refresh_token: refreshToken
        })
      });

      this.log(`[OAuth2] Refresh response status: ${response.status}`);

      if (!response.ok) {
        const errorText = await response.text();
        this.log(`[OAuth2] Refresh error: ${errorText}`);
        // Clear the stored refresh token since it's invalid
        this.homey.settings.unset('clevertouch_refresh_token');
        throw new Error(`Token refresh failed: ${response.status}`);
      }

      const tokenData = await response.json();
      this.log(`[OAuth2] Token refreshed, expires_in: ${tokenData.expires_in}, has new refresh_token: ${!!tokenData.refresh_token}`);

      // Update stored expiration timestamp
      const expiresAt = Date.now() + (tokenData.expires_in * 1000);
      this.homey.settings.set('clevertouch_token_expires_at', expiresAt);
      this.log(`[OAuth2] New token expires at: ${new Date(expiresAt).toISOString()}`);

      // Update backup tokens
      if (tokenData.access_token) {
        this.homey.settings.set('clevertouch_access_token', tokenData.access_token);
        this.log(`[OAuth2] Access token stored in settings as backup`);
      }
      if (tokenData.refresh_token) {
        this.homey.settings.set('clevertouch_refresh_token', tokenData.refresh_token);
        this.log(`[OAuth2] Updated refresh token backup in settings`);
      }

      return new OAuth2Token({
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token || refreshToken, // Keep old if not rotated
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
    // API returns code 1 for read success, code 8 for write success - both are OK
    const code = parseInt(response.code?.code);
    if (code !== 1 && code !== 8) {
      throw new Error(`API error: ${response.code?.value || 'Unknown error'}`);
    }
    return response.data;
  }

  /**
   * Get home data
   */
  async getHome(homeId) {
    const response = await this._apiCall('POST', '/human/smarthome/read/', { smarthome_id: homeId });
    // API returns code 1 for read success, code 8 for write success - both are OK
    const code = parseInt(response.code?.code);
    if (code !== 1 && code !== 8) {
      throw new Error(`API error: ${response.code?.value || 'Unknown error'}`);
    }
    return response.data;
  }

  /**
   * Get all devices from a home
   * NOTE: Real-time temperature data is in zones[].devices[], NOT in the flat devices[] array
   */
  async getDevices(homeId) {
    const homeData = await this.getHome(homeId);
    
    // Log home-level mode if present
    this.log(`[API] Home data keys: ${Object.keys(homeData).join(', ')}`);
    this.log(`[API] Home-level modes: general_mode=${homeData.general_mode}, holiday_mode=${homeData.holiday_mode}, modes=${JSON.stringify(homeData.modes)}`);
    if (homeData.gv_mode !== undefined || homeData.mode !== undefined) {
      this.log(`[API] Home-level mode: gv_mode=${homeData.gv_mode}, mode=${homeData.mode}`);
    }
    
    // Extract devices from zones (this has the real-time temperature data)
    const zones = homeData.zones || [];
    const devices = [];
    
    for (const zone of zones) {
      // Log zone-level mode if present
      this.log(`[API] Zone "${zone.zone_label}" keys: ${Object.keys(zone).join(', ')}`);
      if (zone.gv_mode !== undefined || zone.mode !== undefined || zone.nv_mode !== undefined) {
        this.log(`[API] Zone "${zone.zone_label}" mode: gv_mode=${zone.gv_mode}, nv_mode=${zone.nv_mode}, mode=${zone.mode}`);
      }
      
      if (zone.devices && Array.isArray(zone.devices)) {
        // Add zone info to each device for reference
        for (const device of zone.devices) {
          device._zoneName = zone.zone_label;
          device._zoneNum = zone.num_zone;
          device._zoneGvMode = zone.gv_mode;
          // Add home-level mode (overrides device mode when set)
          device._homeGeneralMode = homeData.general_mode;
          device._homeHolidayMode = homeData.holiday_mode;
          devices.push(device);
        }
      }
    }
    
    this.log(`[API] Found ${devices.length} devices in ${zones.length} zones`);
    return devices;
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
   * Check if token needs proactive refresh (before expiration)
   */
  async _ensureValidToken() {
    const token = this.getToken();
    if (!token?.access_token) {
      this.log('[OAuth2] No access token available');
      return false;
    }

    const expiresAt = this.homey.settings.get('clevertouch_token_expires_at');
    if (!expiresAt) {
      this.log('[OAuth2] No expiration timestamp stored, assuming token is valid');
      return true;
    }

    const now = Date.now();
    const timeUntilExpiry = expiresAt - now;
    const totalLifetime = token.expires_in ? token.expires_in * 1000 : 900000; // default 15 min
    const refreshThreshold = totalLifetime * (1 - TOKEN_REFRESH_THRESHOLD);

    this.log(`[OAuth2] Token expires in ${Math.round(timeUntilExpiry / 1000)}s, threshold: ${Math.round(refreshThreshold / 1000)}s`);

    if (timeUntilExpiry < refreshThreshold) {
      this.log('[OAuth2] Token near expiration, proactively refreshing...');
      try {
        const newToken = await this.onRefreshToken();
        if (newToken) {
          this.setToken(newToken);
          if (typeof this.save === 'function') {
            await this.save();
          }
          this.log('[OAuth2] Token proactively refreshed and saved');
          return true;
        }
      } catch (error) {
        this.log('[OAuth2] Proactive refresh failed:', error.message);
        // Continue with existing token, it might still work
        return timeUntilExpiry > 0;
      }
    }

    return true;
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

    // Proactively refresh token if near expiration
    await this._ensureValidToken();

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Setup abort controller for timeout
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        // Get access token from OAuth2Client, or fall back to settings backup
        let accessToken = this.getToken()?.access_token;
        if (!accessToken) {
          accessToken = this.homey.settings.get('clevertouch_access_token');
          if (accessToken) {
            this.log(`[API] Using access token from settings backup`);
          }
        }
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
            this.log('[API] Got 401 Unauthorized - attempting token refresh');
            try {
              const newToken = await this.onRefreshToken();
              if (newToken) {
                this.setToken(newToken);
                if (typeof this.save === 'function') {
                  await this.save();
                }
                this.log('[API] Token refreshed and saved. Retrying request...');
                continue; // Retry loop with new token
              }
            } catch (refreshError) {
              this.log('[API] Failed to refresh token:', refreshError.message);
              throw new Error('Unauthorized - Refresh failed');
            }
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
