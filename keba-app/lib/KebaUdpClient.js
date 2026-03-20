'use strict';

const dgram = require('dgram');

const UDP_PORT = 7090;
const MIN_SEND_SPACING_MS = 100;
const DEFAULT_TIMEOUT_MS = 5000;
const REBIND_DELAY_MS = 5000;

class KebaUdpClient {

  constructor({ logger = console } = {}) {
    this._logger = logger;
    this._socket = null;
    this._deviceCallbacks = new Map(); // host → callback
    this._sendQueue = Promise.resolve();
    this._lastSendTime = 0;
    this._discoveryResolvers = [];
    this._pendingRequests = new Map(); // `${type}:${host}` → { resolve, reject, timer }
    this._closed = false;
  }

  async init() {
    if (this._socket) return;
    this._closed = false;

    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = (fn, arg) => {
        if (!settled) { settled = true; fn(arg); }
      };

      this._socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

      this._socket.on('error', (err) => {
        this._logger.error('[KebaUdpClient] Socket error:', err.message);
        settle(reject, err);
        this._handleSocketError();
      });

      this._socket.on('message', (msg, rinfo) => {
        this._handleMessage(msg.toString('utf8'), rinfo);
      });

      this._socket.on('listening', () => {
        try {
          this._socket.setBroadcast(true);
        } catch (err) {
          this._logger.error('[KebaUdpClient] Failed to enable broadcast:', err.message);
        }
        const addr = this._socket.address();
        this._logger.log(`[KebaUdpClient] Listening on ${addr.address}:${addr.port}`);
        settle(resolve);
      });

      this._socket.bind(UDP_PORT);
    });
  }

  _handleSocketError() {
    if (this._closed) return;
    this._logger.log(`[KebaUdpClient] Will attempt rebind in ${REBIND_DELAY_MS}ms`);
    if (this._socket) {
      try { this._socket.close(); } catch (_) { /* ignore */ }
      this._socket = null;
    }
    setTimeout(() => {
      if (!this._closed) {
        this.init().catch(err => {
          this._logger.error('[KebaUdpClient] Rebind failed:', err.message);
        });
      }
    }, REBIND_DELAY_MS);
  }

  _handleMessage(message, rinfo) {
    const host = rinfo.address;
    const trimmed = message.trim();

    // Check discovery resolvers (broadcast responses)
    if (this._discoveryResolvers.length > 0) {
      for (const resolver of this._discoveryResolvers) {
        resolver.responses.push({ host, message: trimmed });
      }
    }

    // Check pending request waiters
    const responseType = getResponseType(trimmed);
    const key = `${responseType}:${host}`;
    const pending = this._pendingRequests.get(key);
    if (pending) {
      clearTimeout(pending.timer);
      this._pendingRequests.delete(key);
      pending.resolve(trimmed);
      return;
    }

    // Also check for generic type keys (e.g. report responses)
    const genericKey = `any:${host}`;
    const genericPending = this._pendingRequests.get(genericKey);
    if (genericPending) {
      clearTimeout(genericPending.timer);
      this._pendingRequests.delete(genericKey);
      genericPending.resolve(trimmed);
      return;
    }

    // Route to registered device callback
    const callback = this._deviceCallbacks.get(host);
    if (callback) {
      try {
        callback(trimmed, rinfo);
      } catch (err) {
        this._logger.error(`[KebaUdpClient] Device callback error for ${host}:`, err.message);
      }
    }
  }

  async send(host, command) {
    this._sendQueue = this._sendQueue.then(async () => {
      const now = Date.now();
      const elapsed = now - this._lastSendTime;
      if (elapsed < MIN_SEND_SPACING_MS) {
        await sleep(MIN_SEND_SPACING_MS - elapsed);
      }

      return new Promise((resolve, reject) => {
        if (!this._socket) {
          reject(new Error('UDP socket not initialized'));
          return;
        }
        const buffer = Buffer.from(command, 'utf8');
        this._socket.send(buffer, 0, buffer.length, UDP_PORT, host, (err) => {
          this._lastSendTime = Date.now();
          if (err) {
            this._logger.error(`[KebaUdpClient] Send to ${host} failed:`, err.message);
            reject(err);
          } else {
            this._logger.log(`[KebaUdpClient] Sent "${command}" to ${host}:${UDP_PORT}`);
            resolve();
          }
        });
      });
    });

    return this._sendQueue;
  }

  async sendAndWait(host, command, { timeout = DEFAULT_TIMEOUT_MS, responseType = 'any' } = {}) {
    const key = `${responseType}:${host}`;

    const responsePromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pendingRequests.delete(key);
        reject(new Error(`Timeout waiting for response from ${host} (command: "${command}")`));
      }, timeout);

      this._pendingRequests.set(key, { resolve, reject, timer });
    });

    await this.send(host, command);
    return responsePromise;
  }

  async discover(broadcastAddr = '255.255.255.255', timeout = 3000) {
    const resolver = { responses: [] };
    this._discoveryResolvers.push(resolver);

    try {
      await this.send(broadcastAddr, 'i');
      await sleep(timeout);
      return resolver.responses;
    } finally {
      const idx = this._discoveryResolvers.indexOf(resolver);
      if (idx !== -1) this._discoveryResolvers.splice(idx, 1);
    }
  }

  registerDevice(host, callback) {
    this._deviceCallbacks.set(host, callback);
    this._logger.log(`[KebaUdpClient] Registered device at ${host}`);
  }

  unregisterDevice(host) {
    this._deviceCallbacks.delete(host);
    // Clean up any pending requests for this host
    for (const [key, pending] of this._pendingRequests) {
      if (key.endsWith(`:${host}`)) {
        clearTimeout(pending.timer);
        this._pendingRequests.delete(key);
      }
    }
    this._logger.log(`[KebaUdpClient] Unregistered device at ${host}`);
  }

  async close() {
    this._closed = true;
    this._deviceCallbacks.clear();

    // Reject all pending requests
    for (const [key, pending] of this._pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('UDP client closed'));
    }
    this._pendingRequests.clear();

    if (this._socket) {
      return new Promise((resolve) => {
        this._socket.close(() => {
          this._socket = null;
          this._logger.log('[KebaUdpClient] Socket closed');
          resolve();
        });
      });
    }
  }

}

// Response type detection (mirrors Python utils.py get_response_type)
function getResponseType(payload) {
  if (!payload || payload.length === 0) return 'unknown';
  if (payload.startsWith('i')) return 'broadcast';
  if (payload.startsWith('"Firmware') || payload.startsWith('Firmware')) return 'basic_info';
  if (payload.includes('TCH-OK')) return 'tch-ok';
  if (payload.includes('TCH-ERR')) return 'tch-err';

  try {
    const json = JSON.parse(payload);
    if (json.ID !== undefined) {
      const id = parseInt(json.ID, 10);
      if (id === 1) return 'report_1';
      if (id === 2) return 'report_2';
      if (id === 3) return 'report_3';
      if (id > 100) return 'report_1xx';
    }
    return 'push_update';
  } catch (_) {
    return 'unknown';
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = KebaUdpClient;
module.exports.getResponseType = getResponseType;
module.exports.UDP_PORT = UDP_PORT;
