'use strict';

const crypto = require('crypto');

/**
 * Dreame Cloud client for Dreame vacuums.
 *
 * Implements:
 * - OAuth2 password grant login via Dreame Cloud (dreame.tech)
 * - Token refresh
 * - Device discovery
 * - Property read/write and action calls via Dreame IoT API
 * - Session persistence and auto-restoration
 *
 * Reference: Tasshack/dreame-vacuum protocol.py (dev branch) — DreameVacuumDreameHomeCloudProtocol
 */

const PASSWORD_SALT = 'RAylYC%fmSKp7%Tq';
const BASIC_AUTH = 'Basic ZHJlYW1lX2FwcHYxOkFQXmR2QHpAU1FZVnhOODg=';
// dreame_appv1:AP^dv@z@SQYVxN88

const DEFAULT_TENANT_ID = '000000';
const USER_AGENT = 'Dreame_Smarthome/2.1.9 (iPhone; iOS 18.4.1; Scale/3.00)';

const REQUEST_TIMEOUT_MS = 10000;
const MAX_RETRIES = 3;
const MAX_PROPERTIES_PER_CALL = 15;

class DreameCloudClient {

  /**
   * @param {object} homey - Homey instance (for settings, logging, timers)
   * @param {string} country - Country code for API endpoint (e.g., 'eu', 'us', 'cn')
   */
  constructor(homey, country = 'eu') {
    this._homey = homey;
    this._country = country;
    this._accessToken = null;
    this._refreshToken = null;
    this._tokenExpire = 0;
    this._uid = null;
    this._tenantId = DEFAULT_TENANT_ID;
    this._loggedIn = false;
  }

  // ─── API Base URL ─────────────────────────────────────────────

  get _baseUrl() {
    return `https://${this._country}.iot.dreame.tech:13267`;
  }

  // ─── Authentication ────────────────────────────────────────────

  /**
   * Login to Dreame Cloud via OAuth2 password grant.
   * @param {string} username - Dreame account email
   * @param {string} password - Account password
   */
  async login(username, password) {
    this._loggedIn = false;

    // Hash password with salt: MD5(password + salt)
    const passwordHash = crypto.createHash('md5')
      .update(password + PASSWORD_SALT)
      .digest('hex');

    const body = [
      'platform=IOS',
      'scope=all',
      'grant_type=password',
      `username=${encodeURIComponent(username)}`,
      `password=${passwordHash}`,
      'type=account',
    ].join('&');

    this._homey.app.log('[DreameCloud] Logging in to', this._baseUrl);

    const resp = await fetch(`${this._baseUrl}/dreame-auth/oauth/token`, {
      method: 'POST',
      headers: this._authHeaders(),
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const text = await resp.text();
    this._homey.app.log('[DreameCloud] Login response status:', resp.status);

    if (resp.status !== 200) {
      this._homey.app.error('[DreameCloud] Login failed, status:', resp.status, 'body:', text.substring(0, 300));
      throw new Error(`Login failed (HTTP ${resp.status})`);
    }

    const data = JSON.parse(text);

    if (data.error) {
      this._homey.app.error('[DreameCloud] Login error:', data.error, data.error_description);
      throw new Error(data.error_description || data.error || 'Login failed');
    }

    if (!data.access_token) {
      this._homey.app.error('[DreameCloud] No access_token in response:', text.substring(0, 300));
      throw new Error('Login failed: no access token received');
    }

    this._accessToken = data.access_token;
    this._refreshToken = data.refresh_token;
    this._tokenExpire = Date.now() + (data.expires_in - 120) * 1000;
    this._uid = data.uid;
    this._tenantId = data.tenant_id || this._tenantId;
    this._loggedIn = true;

    this._persistSession();
    this._homey.app.log('[DreameCloud] Login successful, uid:', this._uid);
  }

  /**
   * Refresh the access token using the refresh token.
   */
  async refreshLogin() {
    if (!this._refreshToken) {
      throw new Error('No refresh token available');
    }

    this._homey.app.log('[DreameCloud] Refreshing token...');

    const body = [
      'platform=IOS',
      'scope=all',
      'grant_type=refresh_token',
      `refresh_token=${encodeURIComponent(this._refreshToken)}`,
    ].join('&');

    const resp = await fetch(`${this._baseUrl}/dreame-auth/oauth/token`, {
      method: 'POST',
      headers: this._authHeaders(),
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const text = await resp.text();

    if (resp.status !== 200) {
      this._loggedIn = false;
      throw new Error(`Token refresh failed (HTTP ${resp.status})`);
    }

    const data = JSON.parse(text);

    if (!data.access_token) {
      this._loggedIn = false;
      throw new Error('Token refresh failed: no access token');
    }

    this._accessToken = data.access_token;
    this._refreshToken = data.refresh_token || this._refreshToken;
    this._tokenExpire = Date.now() + (data.expires_in - 120) * 1000;
    this._uid = data.uid || this._uid;
    this._tenantId = data.tenant_id || this._tenantId;
    this._loggedIn = true;

    this._persistSession();
    this._homey.app.log('[DreameCloud] Token refreshed successfully');
  }

  /**
   * Ensure we have a valid token, refreshing if needed.
   */
  async _ensureToken() {
    if (!this._loggedIn || !this._accessToken) {
      throw new Error('Not logged in');
    }
    if (Date.now() >= this._tokenExpire && this._refreshToken) {
      await this.refreshLogin();
    }
  }

  /**
   * Restore session from stored authKey.
   * @param {string} authKey - JSON string with token data
   */
  async restoreSession(authKey) {
    try {
      const data = JSON.parse(authKey);
      this._accessToken = data.accessToken;
      this._refreshToken = data.refreshToken;
      this._tokenExpire = data.tokenExpire || 0;
      this._uid = data.uid;
      this._tenantId = data.tenantId || DEFAULT_TENANT_ID;
      this._country = data.country || this._country;

      // Try to refresh token to validate session
      if (this._refreshToken) {
        await this.refreshLogin();
        this._homey.app.log('[DreameCloud] Session restored via refresh');
      } else {
        this._loggedIn = false;
        this._homey.app.log('[DreameCloud] No refresh token, session invalid');
      }
    } catch (err) {
      this._loggedIn = false;
      this._homey.app.error('[DreameCloud] Session restore failed:', err.message);
    }
  }

  get isLoggedIn() {
    return this._loggedIn;
  }

  // ─── Device Discovery ─────────────────────────────────────────

  /**
   * Get all Dreame vacuum devices from Dreame Cloud.
   * @returns {Array<object>} Device list filtered to dreame.vacuum.* models
   */
  async getDevices() {
    await this._ensureToken();

    const resp = await this._apiCall('dreame-user-iot/iotuserbind/device/listV2', {});
    this._homey.app.log('[DreameCloud] Device list response:', JSON.stringify(resp).substring(0, 500));

    if (!resp || resp.code !== 0) {
      throw new Error(`Device list failed: ${resp?.msg || 'unknown error'}`);
    }

    const records = resp.data?.page?.records || [];
    this._homey.app.log(`[DreameCloud] Found ${records.length} total device(s)`);

    // Filter to Dreame vacuums
    const vacuums = records.filter(d => d.model && d.model.startsWith('dreame.vacuum.'));
    this._homey.app.log(`[DreameCloud] Found ${vacuums.length} Dreame vacuum(s)`);

    return vacuums.map(dev => ({
      did: dev.did,
      name: dev.customName || dev.deviceInfo?.displayName || `Dreame ${dev.model}`,
      model: dev.model,
      mac: dev.mac,
      // For device info/commands we may need OTC info
      bindDomain: dev.bindDomain,
    }));
  }

  /**
   * Get OTC (over-the-cloud) connection info for a specific device.
   * @param {string} did - Device ID
   * @returns {object} OTC info including MQTT connection details
   */
  async getDeviceOTCInfo(did) {
    await this._ensureToken();
    const resp = await this._apiCall('dreame-user-iot/iotstatus/devOTCInfo', { did });
    if (!resp || resp.code !== 0) {
      throw new Error(`OTC info failed: ${resp?.msg || 'unknown error'}`);
    }
    return resp.data;
  }

  // ─── Device Commands ──────────────────────────────────────────

  /**
   * Send a command to a device via Dreame Cloud.
   * @param {string} did - Device ID
   * @param {string} method - MiOT method name
   * @param {*} params - Method parameters
   * @param {string} [host] - Optional bind domain host
   * @returns {*} Command result
   */
  async sendCommand(did, method, params, host) {
    await this._ensureToken();

    let hostSuffix = '';
    if (host) {
      const hostPart = host.split('.')[0];
      if (hostPart) hostSuffix = `-${hostPart}`;
    }

    const requestId = Math.floor(Math.random() * 9000) + 1000;
    const apiPath = `dreame-iot-com${hostSuffix}/device/sendCommand`;
    this._homey.app.log(`[DreameCloud] sendCommand: ${method} to ${did} via ${apiPath}`);

    const resp = await this._apiCall(apiPath, {
      did: String(did),
      id: requestId,
      data: {
        did: String(did),
        id: requestId,
        method,
        params,
      },
    });

    this._homey.app.log('[DreameCloud] sendCommand response code:', resp?.code, 'msg:', resp?.msg);

    if (!resp || resp.code !== 0) {
      throw new Error(`Command failed: ${resp?.msg || JSON.stringify(resp) || 'unknown error'}`);
    }

    return resp.data?.result;
  }

  // ─── MiOT-style Property/Action Wrappers ──────────────────────

  /**
   * Read properties from a device (batched, max 15 per call).
   * @param {string} did - Device ID
   * @param {Array<{siid: number, piid: number}>} props - Properties to read
   * @param {string} [host] - Optional bind domain host
   * @returns {Array<{siid, piid, value, code}>}
   */
  async getProperties(did, props, host) {
    const results = [];

    for (let i = 0; i < props.length; i += MAX_PROPERTIES_PER_CALL) {
      const batch = props.slice(i, i + MAX_PROPERTIES_PER_CALL).map(p => ({
        did,
        siid: p.siid,
        piid: p.piid,
      }));

      const resp = await this.sendCommand(did, 'get_properties', batch, host);
      if (Array.isArray(resp)) {
        results.push(...resp);
      }
    }

    return results;
  }

  /**
   * Set a property on a device.
   * @param {string} did - Device ID
   * @param {number} siid - Service ID
   * @param {number} piid - Property ID
   * @param {*} value - Value to set
   * @param {string} [host] - Optional bind domain host
   */
  async setProperty(did, siid, piid, value, host) {
    return this.sendCommand(did, 'set_properties', [{ did, siid, piid, value }], host);
  }

  /**
   * Execute an action on a device.
   * @param {string} did - Device ID
   * @param {number} siid - Service ID
   * @param {number} aiid - Action ID
   * @param {Array} [params=[]] - Action parameters
   * @param {string} [host] - Optional bind domain host
   */
  async callAction(did, siid, aiid, params = [], host) {
    return this.sendCommand(did, 'action', { did, siid, aiid, in: params }, host);
  }

  // ─── Internal: API call with retry ────────────────────────────

  /**
   * Make an authenticated API call to Dreame Cloud.
   * @param {string} path - API path
   * @param {object} data - Request body data
   * @returns {object} Parsed JSON response
   */
  async _apiCall(path, data) {
    const url = `${this._baseUrl}/${path}`;
    let lastError;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const resp = await fetch(url, {
          method: 'POST',
          headers: this._apiRequestHeaders(),
          body: JSON.stringify(data),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        const text = await resp.text();
        const result = JSON.parse(text);

        // Check for auth expiry
        if (result.code === 401 || result.code === 1016) {
          this._homey.app.log('[DreameCloud] Token expired, refreshing...');
          await this.refreshLogin();
          // Retry with new token
          continue;
        }

        return result;

      } catch (err) {
        lastError = err;
        this._homey.app.error(`[DreameCloud] API ${path} attempt ${attempt}/${MAX_RETRIES} failed:`, err.message);

        if (attempt < MAX_RETRIES) {
          await this._sleep(1000 * attempt + Math.random() * 500);
        }
      }
    }

    throw lastError;
  }

  // ─── Headers ──────────────────────────────────────────────────

  _authHeaders() {
    return {
      'Accept': '*/*',
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept-Language': 'en-US;q=0.8',
      'Accept-Encoding': 'gzip, deflate',
      'User-Agent': USER_AGENT,
      'Authorization': BASIC_AUTH,
      'Tenant-Id': this._tenantId,
    };
  }

  _apiRequestHeaders() {
    return {
      'Accept': '*/*',
      'Content-Type': 'application/json',
      'Accept-Language': 'en-US;q=0.8',
      'Accept-Encoding': 'gzip, deflate',
      'User-Agent': USER_AGENT,
      'Authorization': BASIC_AUTH,
      'Tenant-Id': this._tenantId,
      'Dreame-Auth': this._accessToken,
    };
  }

  // ─── Session Persistence ──────────────────────────────────────

  _persistSession() {
    if (this._accessToken && this._refreshToken && this._uid) {
      const data = {
        accessToken: this._accessToken,
        refreshToken: this._refreshToken,
        tokenExpire: this._tokenExpire,
        uid: this._uid,
        tenantId: this._tenantId,
        country: this._country,
      };
      this._homey.settings.set('authKey', JSON.stringify(data));
    }
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = DreameCloudClient;
