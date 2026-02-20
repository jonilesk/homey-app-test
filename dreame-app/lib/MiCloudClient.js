'use strict';

const crypto = require('crypto');

/**
 * Xiaomi MiOT Cloud client for Dreame vacuums.
 *
 * Implements:
 * - 3-step Xiaomi account login (cookie-based)
 * - RC4-encrypted API requests with SHA-1 signatures
 * - Device discovery (own + shared homes)
 * - Property read/write and action calls via MiOT RPC
 * - Session persistence and auto-restoration
 *
 * Reference: Tasshack/dreame-vacuum protocol.py — DreameVacuumCloudProtocol
 */

const BASE_URL = 'https://de.api.io.mi.com/app';
const LOGIN_URL = 'https://account.xiaomi.com/pass/serviceLogin';
const LOGIN_AUTH_URL = 'https://account.xiaomi.com/pass/serviceLoginAuth2';

const MAX_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 10000;
const MAX_PROPERTIES_PER_CALL = 15;

class MiCloudClient {

  /**
   * @param {object} homey - Homey instance (for settings, logging, timers)
   */
  constructor(homey) {
    this._homey = homey;
    this._clientId = null;
    this._userId = null;
    this._ssecurity = null;
    this._serviceToken = null;
    this._loggedIn = false;
  }

  // ─── Authentication ────────────────────────────────────────────

  /**
   * Full 3-step Xiaomi Cloud login.
   * @param {string} username - Xiaomi account email/phone
   * @param {string} password - Account password
   */
  async login(username, password) {
    this._clientId = this._generateClientId();
    this._loggedIn = false;

    // Step 1: Get sign token
    const step1 = await this._loginStep1();

    if (step1.code === 0 && step1.userId && step1.ssecurity && step1.location) {
      // Session still valid from cookies
      this._userId = step1.userId;
      this._ssecurity = step1.ssecurity;
      await this._loginStep3(step1.location);
    } else {
      // Step 2: Authenticate
      const step2 = await this._loginStep2(username, password, step1._sign);

      if (step2.notificationUrl) {
        throw new Error('Two-factor authentication is required. Please disable 2FA or clear it in Mi Home app first.');
      }
      if (step2.captchaUrl) {
        throw new Error('CAPTCHA verification required. Please open Mi Home app, complete the CAPTCHA, then try again.');
      }
      if (!step2.location) {
        throw new Error('Login failed: invalid credentials or account issue.');
      }

      this._userId = step2.userId;
      this._ssecurity = step2.ssecurity;

      // Step 3: Get service token
      await this._loginStep3(step2.location);
    }

    this._loggedIn = true;
    this._persistSession();
    this._homey.app.log('[MiCloud] login successful', { userId: this._userId });
  }

  /**
   * Restore session from stored authKey.
   * @param {string} authKey - Space-separated: "serviceToken ssecurity userId clientId"
   */
  async restoreSession(authKey) {
    try {
      const parts = authKey.split(' ');
      if (parts.length !== 4) throw new Error('Invalid authKey format');

      this._serviceToken = parts[0];
      this._ssecurity = parts[1];
      this._userId = parts[2];
      this._clientId = parts[3];

      const valid = await this.checkLogin();
      if (valid) {
        this._loggedIn = true;
        this._homey.app.log('[MiCloud] session restored');
      } else {
        this._loggedIn = false;
        this._homey.app.log('[MiCloud] stored session expired');
      }
    } catch (err) {
      this._loggedIn = false;
      this._homey.app.error('[MiCloud] session restore failed:', err.message);
    }
  }

  get isLoggedIn() {
    return this._loggedIn;
  }

  // ─── Step 1: Get sign token ────────────────────────────────────

  async _loginStep1() {
    const url = `${LOGIN_URL}?sid=xiaomiio&_json=true`;
    this._homey.app.log('[MiCloud] Step 1: requesting sign token from', url);
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': this._userAgent(),
        'Cookie': `sdkVersion=3.8.6; deviceId=${this._clientId}`,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await resp.text();
    
    // Capture cookies from response to pass to Step 2
    const setCookies = resp.headers.getSetCookie?.() || [];
    this._homey.app.log('[MiCloud] Step 1 Set-Cookie headers:', setCookies.length);
    
    // Extract cookie name=value pairs, filtering out expired/deleted cookies
    const cookieMap = new Map();
    for (const cookie of setCookies) {
      const match = cookie.match(/^([^=]+)=([^;]*)/);
      if (match) {
        const name = match[1].trim();
        const value = match[2].trim();
        // Skip cookies the server is trying to delete (value=EXPIRED or max-age=0)
        if (value === 'EXPIRED' || value === '' || cookie.toLowerCase().includes('max-age=0')) {
          continue;
        }
        cookieMap.set(name, value);
      }
    }
    this._step1Cookies = cookieMap;
    
    this._homey.app.log('[MiCloud] Step 1 response status:', resp.status);
    this._homey.app.log('[MiCloud] Step 1 response (first 500 chars):', text.substring(0, 500));
    const parsed = this._parseLoginResponse(text);
    this._homey.app.log('[MiCloud] Step 1 parsed:', JSON.stringify(parsed));
    return parsed;
  }

  // ─── Step 2: Authenticate with credentials ─────────────────────

  async _loginStep2(username, password, sign) {
    const hash = crypto.createHash('md5').update(password).digest('hex').toUpperCase();
    this._homey.app.log('[MiCloud] Step 2: authenticating user:', username);
    this._homey.app.log('[MiCloud] Step 2: password hash (first 8):', hash.substring(0, 8));
    this._homey.app.log('[MiCloud] Step 2: using _sign:', sign);
    
    // Build form data - _json goes as URL query param per Python implementation
    const body = new URLSearchParams({
      user: username,
      hash,
      callback: 'https://sts.api.io.mi.com/sts',
      sid: 'xiaomiio',
      qs: '%3Fsid%3Dxiaomiio%26_json%3Dtrue',
    });
    if (sign) {
      body.append('_sign', sign);
    }

    this._homey.app.log('[MiCloud] Step 2: POST body:', body.toString());

    // Build cookie string including cookies from Step 1
    // Use sdkVersion=3.8.6 per Python implementation
    let cookieStr = `sdkVersion=3.8.6; deviceId=${this._clientId}`;
    if (this._step1Cookies && this._step1Cookies.size > 0) {
      for (const [name, value] of this._step1Cookies) {
        cookieStr += `; ${name}=${value}`;
      }
    }
    this._homey.app.log('[MiCloud] Step 2 cookies:', cookieStr);

    // _json=true as URL query param (Python: params={"_json": "true"})
    const step2Url = `${LOGIN_AUTH_URL}?_json=true`;
    this._homey.app.log('[MiCloud] Step 2: POST URL:', step2Url);
    const resp = await fetch(step2Url, {
      method: 'POST',
      headers: {
        'User-Agent': this._userAgent(),
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': cookieStr,
      },
      body: body.toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await resp.text();
    this._homey.app.log('[MiCloud] Step 2 response status:', resp.status);
    this._homey.app.log('[MiCloud] Step 2 response (first 500 chars):', text.substring(0, 500));
    const parsed = this._parseLoginResponse(text);
    this._homey.app.log('[MiCloud] Step 2 parsed:', JSON.stringify(parsed));
    return parsed;
  }

  // ─── Step 3: Get service token ────────────────────────────────

  async _loginStep3(location) {
    const resp = await fetch(location, {
      method: 'GET',
      headers: { 'User-Agent': this._userAgent() },
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    // Extract serviceToken from Set-Cookie headers
    const cookies = resp.headers.getSetCookie?.() || [];
    for (const cookie of cookies) {
      const match = cookie.match(/serviceToken=([^;]+)/);
      if (match) {
        this._serviceToken = match[1];
        return;
      }
    }

    // Fallback: follow redirect and check cookies
    if (resp.status >= 300 && resp.status < 400) {
      const redirectUrl = resp.headers.get('location');
      if (redirectUrl) {
        const resp2 = await fetch(redirectUrl, {
          method: 'GET',
          headers: { 'User-Agent': this._userAgent() },
          redirect: 'manual',
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        const cookies2 = resp2.headers.getSetCookie?.() || [];
        for (const cookie of cookies2) {
          const match = cookie.match(/serviceToken=([^;]+)/);
          if (match) {
            this._serviceToken = match[1];
            return;
          }
        }
      }
    }

    throw new Error('Failed to obtain serviceToken from login redirect');
  }

  // ─── Session check ────────────────────────────────────────────

  /**
   * Check if current session is still valid.
   * Can also validate an existing API response.
   * @param {object} [response] - Optional API response to check
   * @returns {boolean}
   */
  async checkLogin(response) {
    try {
      if (!response) {
        response = await this._apiCall('v2/message/v2/check_new_msg', {
          begin_at: Math.floor(Date.now() / 1000) - 60,
        });
      }
      if (response == null) return false;

      const code = response.code;
      const message = response.message || '';

      if (code === 2 || code === 3
        || message.includes('auth err')
        || message.includes('invalid signature')
        || message.includes('SERVICETOKEN_EXPIRED')) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  // ─── Device discovery ─────────────────────────────────────────

  /**
   * Get all Dreame vacuum devices from Xiaomi Cloud.
   * Queries own homes, shared homes, and fallback device list.
   * @returns {Array<object>} Device list filtered to dreame.vacuum.* models
   */
  async getDevices() {
    const deviceList = [];
    const seenMacs = new Set();

    // Step 1: Get own homes
    const homeResp = await this._apiCall('v2/homeroom/gethome', {
      fg: true, fetch_share: true, fetch_share_dev: true, limit: 100, app_ver: 7,
    });
    const homes = {};
    if (homeResp?.result?.homelist) {
      for (const home of homeResp.result.homelist) {
        homes[home.id] = this._userId;
      }
    }

    // Step 2: Get shared homes
    try {
      const shareResp = await this._apiCall('v2/user/get_device_cnt', {
        fetch_own: true, fetch_share: true,
      });
      if (shareResp?.result?.share?.share_family) {
        for (const entry of shareResp.result.share.share_family) {
          homes[entry.home_id] = entry.home_owner;
        }
      }
    } catch (err) {
      this._homey.app.log('[MiCloud] shared homes query failed (non-fatal):', err.message);
    }

    // Step 3: Get devices per home
    for (const [homeId, owner] of Object.entries(homes)) {
      try {
        const resp = await this._apiCall('v2/home/home_device_list', {
          home_id: parseInt(homeId, 10),
          home_owner: owner,
          limit: 100,
          get_split_device: true,
          support_smart_home: true,
        });
        if (resp?.result?.device_info) {
          for (const dev of resp.result.device_info) {
            if (dev.mac) seenMacs.add(dev.mac);
            deviceList.push(dev);
          }
        }
      } catch (err) {
        this._homey.app.log(`[MiCloud] home ${homeId} device list failed:`, err.message);
      }
    }

    // Step 4: Fallback device list (deduplicate by MAC)
    try {
      const fallbackResp = await this._apiCall('home/device_list', {
        getVirtualModel: false, getHuamiDevices: 0,
      });
      if (fallbackResp?.result?.list) {
        for (const dev of fallbackResp.result.list) {
          if (dev.mac && !seenMacs.has(dev.mac)) {
            seenMacs.add(dev.mac);
            deviceList.push(dev);
          }
        }
      }
    } catch (err) {
      this._homey.app.log('[MiCloud] fallback device list failed:', err.message);
    }

    // Filter to Dreame vacuums only
    return deviceList.filter(d => d.model && d.model.startsWith('dreame.vacuum.'));
  }

  // ─── MiOT RPC ────────────────────────────────────────────────

  /**
   * Read properties from a device (batched, max 15 per call).
   * @param {string} did - Device ID
   * @param {Array<{siid: number, piid: number}>} props - Properties to read
   * @returns {Array<{siid, piid, value, code}>}
   */
  async getProperties(did, props) {
    const results = [];

    // Batch into groups of MAX_PROPERTIES_PER_CALL
    for (let i = 0; i < props.length; i += MAX_PROPERTIES_PER_CALL) {
      const batch = props.slice(i, i + MAX_PROPERTIES_PER_CALL).map(p => ({
        did,
        siid: p.siid,
        piid: p.piid,
      }));

      const resp = await this._rpc(did, 'get_properties', batch);
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
   */
  async setProperty(did, siid, piid, value) {
    return this._rpc(did, 'set_properties', [{ did, siid, piid, value }]);
  }

  /**
   * Execute an action on a device.
   * @param {string} did - Device ID
   * @param {number} siid - Service ID
   * @param {number} aiid - Action ID
   * @param {Array} [params=[]] - Action parameters
   */
  async callAction(did, siid, aiid, params = []) {
    return this._rpc(did, 'action', { did, siid, aiid, in: params });
  }

  // ─── Internal: RPC wrapper ────────────────────────────────────

  async _rpc(did, method, params) {
    const resp = await this._apiCall(`v2/home/rpc/${did}`, { method, params });

    // Validate session on every response
    if (resp && !await this.checkLogin(resp)) {
      this._loggedIn = false;
      this._homey.app.log('[MiCloud] session expired during RPC, needs re-login');
    }

    return resp?.result;
  }

  // ─── Internal: Encrypted API call ─────────────────────────────

  /**
   * Make an RC4-encrypted API call with retry and backoff.
   * @param {string} path - API path (appended to BASE_URL)
   * @param {object} params - Request parameters
   * @returns {object} Parsed JSON response
   */
  async _apiCall(path, params) {
    const url = `${BASE_URL}/${path}`;
    const dataPayload = { data: JSON.stringify(params) };
    let lastError;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const nonce = MiCloudClient.generateNonce();
        const sNonce = MiCloudClient.signedNonce(this._ssecurity, nonce);

        const encParams = MiCloudClient.generateEncParams(
          url, 'POST', sNonce, nonce, { ...dataPayload }, this._ssecurity
        );

        const body = new URLSearchParams(encParams).toString();

        const resp = await fetch(url, {
          method: 'POST',
          headers: this._apiHeaders(),
          body,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        const encryptedText = await resp.text();

        // Decrypt response using a fresh signedNonce from the returned _nonce
        const decrypted = MiCloudClient.decryptRC4(
          MiCloudClient.signedNonce(this._ssecurity, encParams._nonce),
          encryptedText
        );
        return JSON.parse(decrypted.toString('utf8'));

      } catch (err) {
        lastError = err;
        this._homey.app.error(`[MiCloud] API ${path} attempt ${attempt}/${MAX_RETRIES} failed:`, err.message);

        if (attempt < MAX_RETRIES) {
          // Linear backoff + jitter (0-500ms)
          await this._sleep(1000 * attempt + Math.random() * 500);
        }
      }
    }

    throw lastError;
  }

  // ─── RC4 Encryption (static methods) ──────────────────────────

  /**
   * Generate a nonce: 8 random bytes + variable-length minutes-since-epoch.
   * Matches Python: (random.getrandbits(64) - 2**63).to_bytes(8, "big", signed=True)
   *   + int(millis/60000).to_bytes(((bit_length+7)//8), "big")
   */
  static generateNonce() {
    const randomPart = crypto.randomBytes(8);
    const minutes = Math.floor(Date.now() / 60000);
    const bitLen = minutes === 0 ? 1 : Math.floor(Math.log2(minutes)) + 1;
    const byteLen = Math.ceil(bitLen / 8);
    const timeBuf = Buffer.alloc(byteLen);
    let val = minutes;
    for (let i = byteLen - 1; i >= 0; i--) {
      timeBuf[i] = val & 0xff;
      val = Math.floor(val / 256);
    }
    return Buffer.concat([randomPart, timeBuf]).toString('base64');
  }

  /**
   * Compute signed nonce: SHA-256(base64decode(ssecurity) + base64decode(nonce))
   */
  static signedNonce(ssecurity, nonce) {
    const hash = crypto.createHash('sha256');
    hash.update(Buffer.from(ssecurity, 'base64'));
    hash.update(Buffer.from(nonce, 'base64'));
    return hash.digest().toString('base64');
  }

  /**
   * RC4 encrypt with 1024-byte keystream skip.
   * Uses Node.js crypto if available, falls back to pure-JS if RC4 is blocked.
   */
  static encryptRC4(key, data) {
    try {
      const cipher = crypto.createCipheriv('rc4', Buffer.from(key, 'base64'), null);
      cipher.update(Buffer.alloc(1024)); // skip first 1024 bytes of keystream
      return cipher.update(data, 'utf8', 'base64');
    } catch {
      // Fallback: pure-JS RC4
      const keyBuf = Buffer.from(key, 'base64');
      const dataBuf = Buffer.from(data, 'utf8');
      const result = MiCloudClient._rc4(keyBuf, dataBuf);
      return result.toString('base64');
    }
  }

  /**
   * RC4 decrypt with 1024-byte keystream skip.
   */
  static decryptRC4(key, data) {
    try {
      const decipher = crypto.createDecipheriv('rc4', Buffer.from(key, 'base64'), null);
      decipher.update(Buffer.alloc(1024)); // skip first 1024 bytes of keystream
      return decipher.update(Buffer.from(data, 'base64'));
    } catch {
      // Fallback: pure-JS RC4
      const keyBuf = Buffer.from(key, 'base64');
      const dataBuf = Buffer.from(data, 'base64');
      return MiCloudClient._rc4(keyBuf, dataBuf);
    }
  }

  /**
   * Pure-JS RC4 with 1024-byte keystream skip (fallback for OpenSSL 3.x).
   */
  static _rc4(key, data) {
    const S = Array.from({ length: 256 }, (_, i) => i);
    let j = 0;
    for (let i = 0; i < 256; i++) {
      j = (j + S[i] + key[i % key.length]) & 0xff;
      [S[i], S[j]] = [S[j], S[i]];
    }
    let ii = 0;
    j = 0;
    // Skip first 1024 bytes of keystream
    for (let n = 0; n < 1024; n++) {
      ii = (ii + 1) & 0xff;
      j = (j + S[ii]) & 0xff;
      [S[ii], S[j]] = [S[j], S[ii]];
    }
    const out = Buffer.alloc(data.length);
    for (let n = 0; n < data.length; n++) {
      ii = (ii + 1) & 0xff;
      j = (j + S[ii]) & 0xff;
      [S[ii], S[j]] = [S[j], S[ii]];
      out[n] = data[n] ^ S[(S[ii] + S[j]) & 0xff];
    }
    return out;
  }

  /**
   * Generate encrypted request signature (SHA-1, NOT HMAC-SHA256).
   *
   * CRITICAL: The HA integration uses plain SHA-1 for encrypted mode.
   * Parameter order: [METHOD, url_path, ...params_in_insertion_order, signedNonce]
   * URL transform: url.split('com')[1].replace('/app/', '/')
   * Params must NOT be sorted — insertion order preserved.
   */
  static generateEncSignature(url, method, signedNonce, params) {
    const urlPath = url.split('com')[1].replace('/app/', '/');
    const signArr = [method.toUpperCase(), urlPath];
    // Params in insertion order — do NOT sort
    for (const [k, v] of Object.entries(params)) {
      signArr.push(`${k}=${v}`);
    }
    signArr.push(signedNonce);
    const signStr = signArr.join('&');
    return crypto.createHash('sha1').update(signStr).digest().toString('base64');
  }

  /**
   * Build encrypted params: hash plaintext → RC4 encrypt all → hash encrypted → append metadata.
   */
  static generateEncParams(url, method, signedNonce, nonce, params, ssecurity) {
    // 1. Compute rc4_hash__ from plaintext params
    params['rc4_hash__'] = MiCloudClient.generateEncSignature(url, method, signedNonce, params);

    // 2. RC4-encrypt ALL param values (including rc4_hash__)
    for (const [k, v] of Object.entries(params)) {
      params[k] = MiCloudClient.encryptRC4(signedNonce, v);
    }

    // 3. Compute signature from encrypted params
    params['signature'] = MiCloudClient.generateEncSignature(url, method, signedNonce, params);

    // 4. Append metadata (not encrypted)
    params['ssecurity'] = ssecurity;
    params['_nonce'] = nonce;

    return params;
  }

  // ─── Helpers ──────────────────────────────────────────────────

  _generateClientId() {
    let id = '';
    for (let i = 0; i < 16; i++) {
      id += String.fromCharCode(97 + Math.floor(Math.random() * 26));
    }
    return id;
  }

  _userAgent() {
    return `Android-7.1.1-1.0.0-ONEPLUS A3010-136-${this._clientId} APP/xiaomi.smarthome APPV/62830`;
  }

  _apiHeaders() {
    return {
      'User-Agent': this._userAgent(),
      'Accept-Encoding': 'identity',
      'x-xiaomi-protocal-flag-cli': 'PROTOCAL-HTTP2',  // intentional typo from Xiaomi
      'Content-Type': 'application/x-www-form-urlencoded',
      'MIOT-ENCRYPT-ALGORITHM': 'ENCRYPT-RC4',
      'Cookie': this._apiCookies(),
    };
  }

  _apiCookies() {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Helsinki';
    const now = new Date();
    const offset = -now.getTimezoneOffset();
    const sign = offset >= 0 ? '+' : '-';
    const hh = String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0');
    const mm = String(Math.abs(offset) % 60).padStart(2, '0');
    const isDst = this._isDST(now) ? '1' : '0';
    const dstOffset = this._isDST(now) ? '3600000' : '0';

    return [
      `userId=${this._userId}`,
      `yetAnotherServiceToken=${this._serviceToken}`,
      `serviceToken=${this._serviceToken}`,
      `locale=en`,
      `timezone=GMT${sign}${hh}:${mm}`,
      `is_daylight=${isDst}`,
      `dst_offset=${dstOffset}`,
      `channel=MI_APP_STORE`,
    ].join('; ');
  }

  _isDST(date) {
    const jan = new Date(date.getFullYear(), 0, 1).getTimezoneOffset();
    const jul = new Date(date.getFullYear(), 6, 1).getTimezoneOffset();
    return date.getTimezoneOffset() < Math.max(jan, jul);
  }

  _parseLoginResponse(text) {
    // Strip "&&&START&&&" prefix if present
    const cleaned = text.replace('&&&START&&&', '').trim();
    return JSON.parse(cleaned);
  }

  _persistSession() {
    if (this._serviceToken && this._ssecurity && this._userId && this._clientId) {
      const authKey = `${this._serviceToken} ${this._ssecurity} ${this._userId} ${this._clientId}`;
      this._homey.settings.set('authKey', authKey);
    }
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = MiCloudClient;
