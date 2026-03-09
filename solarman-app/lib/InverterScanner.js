'use strict';

const dgram = require('dgram');

const DISCOVERY_MESSAGE = 'WIFIKIT-214028-READ';
const DEFAULT_PORT = 48899;
const DEFAULT_TIMEOUT = 2000;
const DEFAULT_BROADCAST_ADDR = '255.255.255.255';

class InverterScanner {

  /**
   * Discover Solarman data loggers on the local network
   * @param {Object} options
   * @param {number} [options.timeout=2000] - Discovery timeout in ms
   * @param {string} [options.broadcastAddr='255.255.255.255'] - Broadcast address
   * @param {number} [options.port=48899] - Discovery port
   * @returns {Promise<Array<{ip: string, mac: string, serial: number}>>}
   */
  static async discover(options = {}) {
    const {
      timeout = DEFAULT_TIMEOUT,
      broadcastAddr = DEFAULT_BROADCAST_ADDR,
      port = DEFAULT_PORT,
    } = options;

    return new Promise((resolve) => {
      const devices = [];
      const seen = new Set();
      let socket;

      try {
        socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      } catch {
        resolve(devices);
        return;
      }

      const cleanup = () => {
        try {
          socket.close();
        } catch {
          // Socket may already be closed
        }
      };

      const timer = setTimeout(() => {
        cleanup();
        resolve(devices);
      }, timeout);

      socket.on('error', () => {
        clearTimeout(timer);
        cleanup();
        resolve(devices);
      });

      socket.on('message', (data) => {
        try {
          const parts = data.toString().split(',');
          if (parts.length === 3) {
            const ip = parts[0];
            const mac = parts[1];
            const serial = parseInt(parts[2], 10);

            if (!Number.isNaN(serial) && !seen.has(serial)) {
              seen.add(serial);
              devices.push({ ip, mac, serial });
            }
          }
        } catch {
          // Ignore malformed responses
        }
      });

      socket.bind(0, () => {
        try {
          socket.setBroadcast(true);

          const message = Buffer.from(DISCOVERY_MESSAGE);
          socket.send(message, 0, message.length, port, broadcastAddr, (err) => {
            if (err) {
              clearTimeout(timer);
              cleanup();
              resolve(devices);
            }
          });
        } catch {
          clearTimeout(timer);
          cleanup();
          resolve(devices);
        }
      });
    });
  }

}

module.exports = InverterScanner;
