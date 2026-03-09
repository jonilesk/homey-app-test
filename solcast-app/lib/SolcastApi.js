'use strict';

const BASE_URL = 'https://api.solcast.com.au';
const DEFAULT_TIMEOUT = 30000;
const DEFAULT_QUOTA_LIMIT = 10;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY = 15000;

/**
 * Error thrown when API quota is exceeded (HTTP 429 or local limit reached).
 */
class QuotaExceededError extends Error {
  constructor(message = 'Solcast API quota exceeded') {
    super(message);
    this.name = 'QuotaExceededError';
  }
}

/**
 * Error thrown when API authentication fails (HTTP 401).
 */
class AuthenticationError extends Error {
  constructor(message = 'Solcast API authentication failed — check your API key') {
    super(message);
    this.name = 'AuthenticationError';
  }
}

/**
 * HTTPS client for the Solcast solar forecast API.
 *
 * Handles rate-limit tracking, retry with exponential backoff on 429,
 * multi-site forecast aggregation, and AbortController-based timeouts.
 */
class SolcastApi {

  /**
   * @param {Object} options
   * @param {string} options.apiKey - Solcast API key
   * @param {string} [options.baseUrl='https://api.solcast.com.au'] - API base URL
   * @param {number} [options.timeout=30000] - Request timeout in ms
   * @param {Object} [options.logger=console] - Logger (must support .log, .error, .warn)
   */
  constructor({ apiKey, baseUrl, timeout, logger } = {}) {
    if (!apiKey || typeof apiKey !== 'string') {
      throw new Error('SolcastApi requires a valid apiKey');
    }
    this._apiKey = apiKey;
    this._baseUrl = baseUrl || BASE_URL;
    this._timeout = timeout || DEFAULT_TIMEOUT;
    this._logger = logger || console;

    this._apiUsed = 0;
    this._apiLimit = DEFAULT_QUOTA_LIMIT;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Fetch rooftop sites configured for this API key.
   * Does NOT count against the usage quota.
   *
   * @returns {Promise<Array<{name: string, resource_id: string, capacity: number,
   *   capacity_dc: number, latitude: number, longitude: number, azimuth: number,
   *   tilt: number, location: string}>>}
   */
  async getSites() {
    const data = await this._fetch('/rooftop_sites?format=json');
    return data.sites || [];
  }

  /**
   * Fetch forecasts for a specific site.
   * Counts as 1 API call against the daily quota.
   *
   * @param {string} siteId - The site resource_id
   * @param {number} [hours=168] - Forecast horizon in hours (default 7 days)
   * @returns {Promise<Array<{pv_estimate: number, pv_estimate10: number,
   *   pv_estimate90: number, period_end: string, period: string}>>}
   */
  async getForecasts(siteId, hours = 168) {
    this._checkQuota();
    const data = await this._fetch(
      `/rooftop_sites/${encodeURIComponent(siteId)}/forecasts?format=json&hours=${hours}`,
    );
    this._apiUsed++;
    return data.forecasts || [];
  }

  /**
   * Fetch estimated actuals for a specific site.
   * Counts as 1 API call against the daily quota.
   *
   * @param {string} siteId - The site resource_id
   * @param {number} [hours=168] - Look-back horizon in hours (default 7 days)
   * @returns {Promise<Array<{pv_estimate: number, period_end: string, period: string}>>}
   */
  async getEstimatedActuals(siteId, hours = 168) {
    this._checkQuota();
    const data = await this._fetch(
      `/rooftop_sites/${encodeURIComponent(siteId)}/estimated_actuals?format=json&hours=${hours}`,
    );
    this._apiUsed++;
    return data.estimated_actuals || [];
  }

  /**
   * Fetch forecasts for ALL sites and merge them into a single combined array.
   * Each site fetch counts as 1 API call. Values are summed per period_end.
   *
   * @param {string[]} siteIds - Array of site resource_ids
   * @param {number} [hours=168] - Forecast horizon in hours
   * @returns {Promise<Array<{pv_estimate: number, pv_estimate10: number,
   *   pv_estimate90: number, period_end: string, period: string}>>}
   *   Combined forecasts sorted by period_end ascending
   */
  async getAllForecasts(siteIds, hours = 168) {
    if (!Array.isArray(siteIds) || siteIds.length === 0) {
      return [];
    }

    // Fetch each site sequentially to respect rate limits
    const allResults = [];
    for (const siteId of siteIds) {
      const forecasts = await this.getForecasts(siteId, hours);
      allResults.push(forecasts);
    }

    return this._mergeForecasts(allResults);
  }

  /**
   * Get current API usage statistics.
   *
   * @returns {{ used: number, limit: number, remaining: number }}
   */
  getUsage() {
    return {
      used: this._apiUsed,
      limit: this._apiLimit,
      remaining: Math.max(0, this._apiLimit - this._apiUsed),
    };
  }

  /**
   * Reset the daily usage counter. Call this at UTC midnight.
   */
  resetUsage() {
    this._apiUsed = 0;
    this._logger.log('[SolcastApi] Usage counter reset');
  }

  /**
   * Set the daily API quota limit.
   *
   * @param {number} limit - Maximum API calls per day
   */
  setQuotaLimit(limit) {
    if (typeof limit !== 'number' || limit < 0) {
      throw new Error('Quota limit must be a non-negative number');
    }
    this._apiLimit = limit;
    this._logger.log(`[SolcastApi] Quota limit set to ${limit}`);
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Perform an authenticated GET request with timeout and retry logic.
   *
   * @param {string} path - URL path (may already contain query params)
   * @param {number} [retryCount=0] - Current retry attempt
   * @returns {Promise<Object>} Parsed JSON response body
   * @private
   */
  async _fetch(path, retryCount = 0) {
    const separator = path.includes('?') ? '&' : '?';
    const url = `${this._baseUrl}${path}${separator}api_key=${this._apiKey}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this._timeout);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });

      if (response.ok) {
        return await this._parseJson(response);
      }

      // 429 Too Many Requests — retry with exponential backoff
      if (response.status === 429) {
        const body = await this._parseJsonSafe(response);
        const serverMsg = body?.response_status?.message || 'Too many requests';
        this._logger.warn(
          `[SolcastApi] Rate limited (429): ${serverMsg} (attempt ${retryCount + 1}/${MAX_RETRIES})`,
        );

        if (retryCount < MAX_RETRIES) {
          const delay = RETRY_BASE_DELAY * 2 ** retryCount;
          this._logger.warn(`[SolcastApi] Retrying in ${delay / 1000}s…`);
          await this._sleep(delay);
          return this._fetch(path, retryCount + 1);
        }
        throw new QuotaExceededError(
          `Solcast API rate limit exceeded after ${MAX_RETRIES} retries: ${serverMsg}`,
        );
      }

      // 401 Unauthorized
      if (response.status === 401) {
        const body = await this._parseJsonSafe(response);
        const code = body?.response_status?.error_code || 'Unauthorized';
        throw new AuthenticationError(`Solcast API authentication failed: ${code}`);
      }

      // Other HTTP errors
      const text = await response.text().catch(() => '');
      throw new Error(
        `Solcast API request failed: HTTP ${response.status} ${response.statusText} — ${text}`,
      );
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error(`Solcast API request timed out after ${this._timeout}ms: ${path}`);
      }
      // Re-throw known errors as-is
      if (
        error instanceof QuotaExceededError
        || error instanceof AuthenticationError
      ) {
        throw error;
      }
      // Wrap unknown fetch/network errors
      if (!error.message?.startsWith('Solcast API')) {
        throw new Error(`Solcast API network error: ${error.message}`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Parse a JSON response body, throwing a descriptive error on failure.
   *
   * @param {Response} response
   * @returns {Promise<Object>}
   * @private
   */
  async _parseJson(response) {
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(
        `Solcast API returned malformed JSON: ${text.substring(0, 200)}`,
      );
    }
  }

  /**
   * Attempt to parse JSON from a response, returning null on failure.
   *
   * @param {Response} response
   * @returns {Promise<Object|null>}
   * @private
   */
  async _parseJsonSafe(response) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  /**
   * Throw QuotaExceededError if the local usage counter has reached the limit.
   *
   * @private
   */
  _checkQuota() {
    if (this._apiUsed >= this._apiLimit) {
      throw new QuotaExceededError(
        `Daily API quota reached (${this._apiUsed}/${this._apiLimit}). Resets at UTC midnight.`,
      );
    }
  }

  /**
   * Merge multiple forecast arrays by summing values per period_end timestamp.
   *
   * @param {Array<Array>} forecastArrays - Array of per-site forecast arrays
   * @returns {Array} Combined forecasts sorted by period_end ascending
   * @private
   */
  _mergeForecasts(forecastArrays) {
    /** @type {Map<string, {pv_estimate: number, pv_estimate10: number, pv_estimate90: number, period_end: string, period: string}>} */
    const merged = new Map();

    for (const forecasts of forecastArrays) {
      for (const entry of forecasts) {
        const key = entry.period_end;
        if (merged.has(key)) {
          const existing = merged.get(key);
          existing.pv_estimate += entry.pv_estimate || 0;
          existing.pv_estimate10 += entry.pv_estimate10 || 0;
          existing.pv_estimate90 += entry.pv_estimate90 || 0;
        } else {
          merged.set(key, {
            pv_estimate: entry.pv_estimate || 0,
            pv_estimate10: entry.pv_estimate10 || 0,
            pv_estimate90: entry.pv_estimate90 || 0,
            period_end: entry.period_end,
            period: entry.period,
          });
        }
      }
    }

    return Array.from(merged.values()).sort(
      (a, b) => new Date(a.period_end).getTime() - new Date(b.period_end).getTime(),
    );
  }

  /**
   * @param {number} ms
   * @returns {Promise<void>}
   * @private
   */
  _sleep(ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

}

module.exports = SolcastApi;
module.exports.QuotaExceededError = QuotaExceededError;
module.exports.AuthenticationError = AuthenticationError;
