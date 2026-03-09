'use strict';

const net = require('net');

// Solarman V5 protocol constants
const V5_START = 0xA5;
const V5_END = 0x15;
const V5_CONTROL_SUFFIX = 0x10;
const V5_CONTROL_REQUEST = 0x45;
const V5_CONTROL_RESPONSE = 0x15; // 0x45 - 0x30
const V5_CONTROL_HEARTBEAT = 0x47;
const V5_CONTROL_HEARTBEAT_RESPONSE = 0x17; // 0x47 - 0x30
const V5_FRAME_TYPE_SOLAR = 0x02;
const V5_OVERHEAD = 13; // start(1) + length(2) + suffix(1) + code(1) + seq(2) + serial(4) + checksum(1) + end(1)
const V5_REQUEST_PAYLOAD_OVERHEAD = 15; // frameType(1) + sensorType(2) + totalWork(4) + powerOn(4) + offset(4)
const V5_MAX_FRAME_SIZE = 2048;

// Modbus function codes
const FC_READ_HOLDING = 0x03;
const FC_READ_INPUT = 0x04;
const FC_WRITE_SINGLE = 0x06;
const FC_WRITE_MULTIPLE = 0x10;

// Modbus error descriptions
const MODBUS_ERRORS = {
  0x01: 'Illegal function',
  0x02: 'Illegal data address',
  0x03: 'Illegal data value',
  0x04: 'Slave device failure',
  0x05: 'Acknowledge',
  0x06: 'Slave device busy',
};

class SolarmanApi {

  /**
   * Create a Solarman V5 protocol client for communicating with
   * solar inverters through Solarman WiFi data loggers over TCP.
   *
   * @param {Object} options
   * @param {string} options.host - Data logger IP address
   * @param {number} [options.port=8899] - Data logger TCP port
   * @param {number} options.serial - Data logger serial number
   * @param {number} [options.mbSlaveId=1] - Modbus slave ID of the inverter
   * @param {number} [options.timeout=15000] - Response timeout in milliseconds
   * @param {boolean} [options.autoReconnect=true] - Auto-reconnect on connection loss
   * @param {Object} [options.logger=console] - Logger with log() and error() methods
   */
  constructor({ host, port = 8899, serial, mbSlaveId = 1, timeout = 15000, autoReconnect = true, logger = console }) {
    if (!host) throw new Error('host is required');
    if (serial == null) throw new Error('serial is required');

    this._host = host;
    this._port = port;
    this._serial = serial;
    this._mbSlaveId = mbSlaveId;
    this._timeout = timeout;
    this._autoReconnect = autoReconnect;
    this._logger = logger;

    this._socket = null;
    this._connected = false;
    this._sequence = Math.floor(Math.random() * 255) + 1; // 1–255

    // Promise-based mutex for request serialization
    this._locked = false;
    this._waiters = [];

    // Response state
    this._receiveBuffer = Buffer.alloc(0);
    this._responseResolve = null;
    this._responseReject = null;
    this._responseTimer = null;
  }

  /**
   * Connect to the data logger via TCP
   * @throws {Error} On connection failure or timeout
   */
  async connect() {
    if (this._connected && this._socket) {
      return;
    }

    // Tear down any stale socket
    if (this._socket) {
      this._socket.removeAllListeners();
      this._socket.destroy();
      this._socket = null;
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = (fn, arg) => {
        if (!settled) {
          settled = true;
          fn(arg);
        }
      };

      this._socket = new net.Socket();
      this._receiveBuffer = Buffer.alloc(0);

      // Connection-phase timeout
      const connectTimer = setTimeout(() => {
        settle(reject, new Error(`[SolarmanApi] Connection timeout to ${this._host}:${this._port}`));
        if (this._socket) {
          this._socket.destroy();
        }
      }, this._timeout);

      this._socket.once('connect', () => {
        clearTimeout(connectTimer);
        this._connected = true;
        // TCP keepalive detects silently-dead connections
        this._socket.setKeepAlive(true, 60000);
        this._socket.setNoDelay(true);
        this._logger.log(`[SolarmanApi] Connected to ${this._host}:${this._port} (serial=${this._serial})`);
        settle(resolve);
      });

      this._socket.on('data', (data) => this._onData(data));

      this._socket.on('close', () => {
        clearTimeout(connectTimer);
        const wasConnected = this._connected;
        this._connected = false;
        if (!settled) {
          settle(reject, new Error(`[SolarmanApi] Connection closed to ${this._host}:${this._port}`));
        }
        if (wasConnected) {
          this._logger.log('[SolarmanApi] Connection closed');
        }
        this._rejectPending(new Error('[SolarmanApi] Connection closed'));
      });

      this._socket.on('error', (err) => {
        clearTimeout(connectTimer);
        this._connected = false;
        if (!settled) {
          settle(reject, new Error(`[SolarmanApi] Connection error: ${err.message}`));
        } else {
          this._logger.error(`[SolarmanApi] Socket error: ${err.message}`);
        }
      });

      this._socket.connect(this._port, this._host);
    });
  }

  /**
   * Disconnect from the data logger
   */
  async disconnect() {
    this._rejectPending(new Error('[SolarmanApi] Disconnected by caller'));
    this._connected = false;
    if (this._socket) {
      this._socket.removeAllListeners();
      this._socket.destroy();
      this._socket = null;
    }
    this._receiveBuffer = Buffer.alloc(0);
    this._logger.log('[SolarmanApi] Disconnected');
  }

  /**
   * Read holding registers (Modbus function code 0x03)
   * @param {number} registerAddr - Starting register address
   * @param {number} quantity - Number of registers to read (1–125)
   * @returns {Promise<number[]>} Array of 16-bit unsigned integer values
   */
  async readHoldingRegisters(registerAddr, quantity) {
    return this._readRegisters(FC_READ_HOLDING, registerAddr, quantity);
  }

  /**
   * Read input registers (Modbus function code 0x04)
   * @param {number} registerAddr - Starting register address
   * @param {number} quantity - Number of registers to read (1–125)
   * @returns {Promise<number[]>} Array of 16-bit unsigned integer values
   */
  async readInputRegisters(registerAddr, quantity) {
    return this._readRegisters(FC_READ_INPUT, registerAddr, quantity);
  }

  /**
   * Write a single holding register (Modbus function code 0x06)
   * @param {number} registerAddr - Register address
   * @param {number} value - 16-bit unsigned value to write
   * @returns {Promise<{register: number, value: number}>} Echo of written register and value
   */
  async writeHoldingRegister(registerAddr, value) {
    await this._acquireLock();
    try {
      await this._ensureConnected();

      const data = Buffer.alloc(4);
      data.writeUInt16BE(registerAddr, 0);
      data.writeUInt16BE(value & 0xFFFF, 2);

      const modbusFrame = this._buildModbusFrame(this._mbSlaveId, FC_WRITE_SINGLE, data);
      const v5Frame = this._buildV5Frame(modbusFrame);
      const response = await this._sendReceive(v5Frame);
      const modbusResponse = this._parseV5Response(response);
      return this._parseModbusResponse(modbusResponse, FC_WRITE_SINGLE);
    } finally {
      this._releaseLock();
    }
  }

  /**
   * Write multiple holding registers (Modbus function code 0x10)
   * @param {number} registerAddr - Starting register address
   * @param {number[]} values - Array of 16-bit unsigned values to write
   * @returns {Promise<{startRegister: number, quantity: number}>} Echo of address and quantity
   */
  async writeMultipleHoldingRegisters(registerAddr, values) {
    if (!Array.isArray(values) || values.length === 0) {
      throw new Error('[SolarmanApi] values must be a non-empty array');
    }

    await this._acquireLock();
    try {
      await this._ensureConnected();

      const quantity = values.length;
      const byteCount = quantity * 2;
      const data = Buffer.alloc(5 + byteCount);
      data.writeUInt16BE(registerAddr, 0);
      data.writeUInt16BE(quantity, 2);
      data[4] = byteCount;
      for (let i = 0; i < quantity; i++) {
        data.writeUInt16BE(values[i] & 0xFFFF, 5 + i * 2);
      }

      const modbusFrame = this._buildModbusFrame(this._mbSlaveId, FC_WRITE_MULTIPLE, data);
      const v5Frame = this._buildV5Frame(modbusFrame);
      const response = await this._sendReceive(v5Frame);
      const modbusResponse = this._parseV5Response(response);
      return this._parseModbusResponse(modbusResponse, FC_WRITE_MULTIPLE);
    } finally {
      this._releaseLock();
    }
  }

  // ---------------------------------------------------------------------------
  // Internal: Modbus RTU
  // ---------------------------------------------------------------------------

  /**
   * Shared implementation for readHoldingRegisters and readInputRegisters
   */
  async _readRegisters(functionCode, registerAddr, quantity) {
    await this._acquireLock();
    try {
      await this._ensureConnected();

      const data = Buffer.alloc(4);
      data.writeUInt16BE(registerAddr, 0);
      data.writeUInt16BE(quantity, 2);

      const modbusFrame = this._buildModbusFrame(this._mbSlaveId, functionCode, data);
      const v5Frame = this._buildV5Frame(modbusFrame);
      const response = await this._sendReceive(v5Frame);
      const modbusResponse = this._parseV5Response(response);
      return this._parseModbusResponse(modbusResponse, functionCode);
    } finally {
      this._releaseLock();
    }
  }

  /**
   * Build a Modbus RTU frame: [slaveId, fc, ...data, CRC16-LE]
   * @param {number} slaveId
   * @param {number} functionCode
   * @param {Buffer} data - Function-specific payload (big-endian)
   * @returns {Buffer}
   */
  _buildModbusFrame(slaveId, functionCode, data) {
    const payloadLen = 2 + data.length;
    const frame = Buffer.alloc(payloadLen + 2);
    frame[0] = slaveId;
    frame[1] = functionCode;
    data.copy(frame, 2);

    const crc = this._calculateCrc16(frame.slice(0, payloadLen));
    frame.writeUInt16LE(crc, payloadLen);

    return frame;
  }

  /**
   * Parse a Modbus RTU response, handling double CRC from DEYE inverters.
   * @param {Buffer} modbusFrame - Raw Modbus frame extracted from V5 response
   * @param {number} expectedFc - Expected function code
   * @returns {number[]|{register: number, value: number}|{startRegister: number, quantity: number}}
   */
  _parseModbusResponse(modbusFrame, expectedFc) {
    // Validate CRC — try normal frame first, then double-CRC variant
    let payload = this._validateAndStripModbusCrc(modbusFrame);

    if (payload === null && modbusFrame.length > 4) {
      payload = this._validateAndStripModbusCrc(modbusFrame.slice(0, -2));
      if (payload !== null) {
        this._logger.log('[SolarmanApi] Double CRC detected (DEYE), stripped trailing bytes');
      }
    }

    if (payload === null) {
      // Data logger error: when the inverter is offline/sleeping, the data logger
      // returns a non-standard frame with invalid CRC (often 0x0000). Detect this
      // pattern and provide a helpful error message.
      if (modbusFrame.length >= 3 && (modbusFrame[1] & 0x80)) {
        const fc = modbusFrame[1] & 0x7F;
        const exceptionCode = modbusFrame[2];
        const desc = MODBUS_ERRORS[exceptionCode] || `code 0x${exceptionCode.toString(16)}`;
        throw new Error(
          `[SolarmanApi] Inverter not responding (FC=0x${fc.toString(16)}, ${desc}) — inverter may be offline or in standby`,
        );
      }
      throw new Error('[SolarmanApi] Modbus CRC validation failed');
    }

    const functionCode = payload[1];

    // Modbus exception response: function code has high bit set
    if (functionCode & 0x80) {
      const exceptionCode = payload.length > 2 ? payload[2] : 0;
      const desc = MODBUS_ERRORS[exceptionCode] || `Unknown (0x${exceptionCode.toString(16)})`;
      throw new Error(
        `[SolarmanApi] Modbus exception: ${desc} (FC=0x${(functionCode & 0x7F).toString(16)}, code=0x${exceptionCode.toString(16)})`,
      );
    }

    if (functionCode !== expectedFc) {
      throw new Error(
        `[SolarmanApi] Unexpected function code: expected 0x${expectedFc.toString(16)}, got 0x${functionCode.toString(16)}`,
      );
    }

    // FC3 / FC4 — Read registers response
    if (functionCode === FC_READ_HOLDING || functionCode === FC_READ_INPUT) {
      if (payload.length < 3) {
        throw new Error('[SolarmanApi] Modbus read response too short');
      }
      const byteCount = payload[2];
      if (payload.length < 3 + byteCount) {
        throw new Error(`[SolarmanApi] Modbus payload truncated: expected ${byteCount} data bytes, got ${payload.length - 3}`);
      }
      const registerCount = Math.floor(byteCount / 2);
      const values = new Array(registerCount);
      for (let i = 0; i < registerCount; i++) {
        values[i] = payload.readUInt16BE(3 + i * 2);
      }
      return values;
    }

    // FC6 — Write single register echo
    if (functionCode === FC_WRITE_SINGLE) {
      if (payload.length < 5) {
        throw new Error('[SolarmanApi] Modbus write-single response too short');
      }
      return {
        register: payload.readUInt16BE(2),
        value: payload.readUInt16BE(4),
      };
    }

    // FC16 — Write multiple registers echo
    if (functionCode === FC_WRITE_MULTIPLE) {
      if (payload.length < 5) {
        throw new Error('[SolarmanApi] Modbus write-multiple response too short');
      }
      return {
        startRegister: payload.readUInt16BE(2),
        quantity: payload.readUInt16BE(4),
      };
    }

    throw new Error(`[SolarmanApi] Unsupported function code in response: 0x${functionCode.toString(16)}`);
  }

  /**
   * Validate Modbus CRC-16 and return the frame without CRC bytes, or null if invalid.
   * @param {Buffer} frame - Full Modbus frame including CRC
   * @returns {Buffer|null} Frame without trailing CRC, or null
   */
  _validateAndStripModbusCrc(frame) {
    if (frame.length < 4) return null;

    const payload = frame.slice(0, -2);
    const receivedCrc = frame.readUInt16LE(frame.length - 2);
    const calculatedCrc = this._calculateCrc16(payload);

    return receivedCrc === calculatedCrc ? payload : null;
  }

  /**
   * CRC-16/Modbus: polynomial 0xA001, initial value 0xFFFF
   * @param {Buffer} buffer
   * @returns {number} 16-bit CRC value (write as little-endian)
   */
  _calculateCrc16(buffer) {
    let crc = 0xFFFF;
    for (let i = 0; i < buffer.length; i++) {
      crc ^= buffer[i];
      for (let j = 0; j < 8; j++) {
        if (crc & 0x0001) {
          crc = (crc >> 1) ^ 0xA001;
        } else {
          crc >>= 1;
        }
      }
    }
    return crc;
  }

  // ---------------------------------------------------------------------------
  // Internal: Solarman V5 framing
  // ---------------------------------------------------------------------------

  /**
   * Wrap a Modbus RTU frame in a Solarman V5 request envelope.
   *
   * Request structure:
   *   start(1) + length(2) + suffix(1) + code(1) + seq(2) + serial(4)
   *   + frameType(1) + sensorType(2) + totalWork(4) + powerOn(4) + offset(4)
   *   + modbusFrame(N) + checksum(1) + end(1)
   *
   * @param {Buffer} modbusFrame
   * @returns {Buffer}
   */
  _buildV5Frame(modbusFrame) {
    const payloadLength = V5_REQUEST_PAYLOAD_OVERHEAD + modbusFrame.length;
    const frameLength = payloadLength + V5_OVERHEAD;
    const frame = Buffer.alloc(frameLength);
    let offset = 0;

    // Header (11 bytes)
    frame[offset++] = V5_START;
    frame.writeUInt16LE(payloadLength, offset); offset += 2;
    frame[offset++] = V5_CONTROL_SUFFIX;
    frame[offset++] = V5_CONTROL_REQUEST;
    frame[offset++] = this._sequence; // sequence low byte
    frame[offset++] = 0x00;           // sequence high byte
    frame.writeUInt32LE(this._serial, offset); offset += 4;

    // Payload header (15 bytes)
    frame[offset++] = V5_FRAME_TYPE_SOLAR;
    frame.writeUInt16LE(0x0000, offset); offset += 2; // sensor type
    frame.writeUInt32LE(0, offset); offset += 4;       // total working time
    frame.writeUInt32LE(0, offset); offset += 4;       // power on time
    frame.writeUInt32LE(0, offset); offset += 4;       // offset time

    // Embedded Modbus RTU frame
    modbusFrame.copy(frame, offset);
    offset += modbusFrame.length;

    // Trailer
    frame[offset] = this._calculateV5Checksum(frame);
    offset++;
    frame[offset] = V5_END;

    // Advance sequence (1–255 wrapping)
    this._sequence = (this._sequence % 255) + 1;

    return frame;
  }

  /**
   * Extract the embedded Modbus RTU frame from a V5 response envelope.
   *
   * Response structure:
   *   start(1) + length(2) + suffix(1) + code(1) + seq(2) + serial(4)
   *   + frameType(1) + status(1) + totalWork(4) + powerOn(4) + offset(4)
   *   + modbusFrame(N) + checksum(1) + end(1)
   *
   * Modbus frame starts at byte 25, ends at frame.length - 2.
   *
   * @param {Buffer} frame - Complete V5 response frame
   * @returns {Buffer} Embedded Modbus RTU frame
   */
  _parseV5Response(frame) {
    if (frame[0] !== V5_START) {
      throw new Error('[SolarmanApi] Invalid V5 response: bad start byte');
    }
    if (frame[frame.length - 1] !== V5_END) {
      throw new Error('[SolarmanApi] Invalid V5 response: bad end byte');
    }

    const expectedChecksum = this._calculateV5Checksum(frame);
    const actualChecksum = frame[frame.length - 2];
    if (expectedChecksum !== actualChecksum) {
      throw new Error(
        `[SolarmanApi] V5 checksum mismatch: expected 0x${expectedChecksum.toString(16)}, got 0x${actualChecksum.toString(16)}`,
      );
    }

    // Modbus frame: offset 25 to (end - 2)
    const modbusFrame = frame.slice(25, frame.length - 2);
    if (modbusFrame.length < 4) {
      throw new Error(`[SolarmanApi] V5 response contains insufficient Modbus data (${modbusFrame.length} bytes)`);
    }

    return modbusFrame;
  }

  /**
   * V5 checksum: sum of all bytes from index 1 to (length - 3) inclusive, masked to 8 bits.
   * Excludes the start byte (index 0), checksum byte (index -2), and end byte (index -1).
   * @param {Buffer} frame
   * @returns {number} 8-bit checksum
   */
  _calculateV5Checksum(frame) {
    let sum = 0;
    for (let i = 1; i < frame.length - 2; i++) {
      sum += frame[i];
    }
    return sum & 0xFF;
  }

  // ---------------------------------------------------------------------------
  // Internal: TCP connection and I/O
  // ---------------------------------------------------------------------------

  /**
   * Ensure the TCP connection is active; auto-reconnect if configured.
   */
  async _ensureConnected() {
    if (this._connected && this._socket) {
      return;
    }
    if (this._autoReconnect) {
      this._logger.log('[SolarmanApi] Auto-reconnecting...');
      await this.connect();
    } else {
      throw new Error('[SolarmanApi] Not connected');
    }
  }

  /**
   * Send a V5 frame and wait for the matching V5 response.
   * Handles heartbeat frames transparently.
   * @param {Buffer} v5Frame
   * @returns {Promise<Buffer>} Complete V5 response frame
   */
  _sendReceive(v5Frame) {
    return new Promise((resolve, reject) => {
      // Per-request timeout
      this._responseTimer = setTimeout(() => {
        this._responseTimer = null;
        const err = new Error(`[SolarmanApi] Response timeout (${this._timeout}ms)`);
        this._rejectPending(err);
        // Force socket teardown — connection state is unknown after a timeout
        this._connected = false;
        if (this._socket) {
          this._socket.destroy();
        }
      }, this._timeout);

      this._responseResolve = (frame) => {
        if (this._responseTimer) {
          clearTimeout(this._responseTimer);
          this._responseTimer = null;
        }
        this._responseResolve = null;
        this._responseReject = null;
        resolve(frame);
      };

      this._responseReject = (err) => {
        if (this._responseTimer) {
          clearTimeout(this._responseTimer);
          this._responseTimer = null;
        }
        this._responseResolve = null;
        this._responseReject = null;
        reject(err);
      };

      this._logger.log(`[SolarmanApi] TX (${v5Frame.length}B): ${v5Frame.toString('hex')}`);

      try {
        this._socket.write(v5Frame);
      } catch (err) {
        if (this._responseTimer) {
          clearTimeout(this._responseTimer);
          this._responseTimer = null;
        }
        this._responseResolve = null;
        this._responseReject = null;
        reject(new Error(`[SolarmanApi] Socket write failed: ${err.message}`));
      }
    });
  }

  /**
   * Reject any pending response promise. Safe to call multiple times.
   */
  _rejectPending(err) {
    if (this._responseReject) {
      const rejectFn = this._responseReject;
      this._responseResolve = null;
      this._responseReject = null;
      if (this._responseTimer) {
        clearTimeout(this._responseTimer);
        this._responseTimer = null;
      }
      rejectFn(err);
    }
  }

  /**
   * Handle incoming TCP data. Accumulates bytes in a buffer and processes
   * complete V5 frames as they arrive (handles TCP fragmentation).
   */
  _onData(data) {
    this._receiveBuffer = Buffer.concat([this._receiveBuffer, data]);

    while (this._receiveBuffer.length > 0) {
      // Find V5 start marker
      const startIdx = this._receiveBuffer.indexOf(V5_START);
      if (startIdx === -1) {
        this._receiveBuffer = Buffer.alloc(0);
        return;
      }

      // Discard bytes before start marker
      if (startIdx > 0) {
        this._receiveBuffer = this._receiveBuffer.slice(startIdx);
      }

      // Need at least 3 bytes: start + length(2)
      if (this._receiveBuffer.length < 3) return;

      const payloadLength = this._receiveBuffer.readUInt16LE(1);
      const frameLength = payloadLength + V5_OVERHEAD;

      // Sanity check
      if (frameLength < V5_OVERHEAD || frameLength > V5_MAX_FRAME_SIZE) {
        this._receiveBuffer = this._receiveBuffer.slice(1);
        continue;
      }

      // Wait for the complete frame to arrive
      if (this._receiveBuffer.length < frameLength) return;

      // Extract and remove frame from buffer
      const frame = Buffer.from(this._receiveBuffer.slice(0, frameLength));
      this._receiveBuffer = this._receiveBuffer.slice(frameLength);

      this._processFrame(frame);
    }
  }

  /**
   * Process a complete V5 frame: validate, dispatch heartbeats, resolve responses.
   */
  _processFrame(frame) {
    this._logger.log(`[SolarmanApi] RX (${frame.length}B): ${frame.toString('hex')}`);

    // Validate end marker
    if (frame[frame.length - 1] !== V5_END) {
      this._logger.error('[SolarmanApi] Discarding frame: invalid end byte');
      return;
    }

    // Validate V5 checksum
    const expectedChecksum = this._calculateV5Checksum(frame);
    const actualChecksum = frame[frame.length - 2];
    if (expectedChecksum !== actualChecksum) {
      this._logger.error(
        `[SolarmanApi] Discarding frame: checksum mismatch (expected 0x${expectedChecksum.toString(16)}, got 0x${actualChecksum.toString(16)})`,
      );
      return;
    }

    const controlCode = frame[4];

    // Heartbeat from logger — reply with current time and continue waiting
    if (controlCode === V5_CONTROL_HEARTBEAT) {
      this._logger.log('[SolarmanApi] Heartbeat received, sending time response');
      this._sendHeartbeatResponse(frame);
      return;
    }

    // Data response to our request
    if (controlCode === V5_CONTROL_RESPONSE) {
      if (this._responseResolve) {
        this._responseResolve(frame);
      }
      return;
    }

    this._logger.log(`[SolarmanApi] Ignoring frame with control code 0x${controlCode.toString(16)}`);
  }

  /**
   * Build and send a time-sync response to a heartbeat frame.
   *
   * Time response structure:
   *   start(1) + length(2,LE=10) + suffix(1) + code(1) + seq(2) + serial(4)
   *   + 0x01 + 0x00 + unixTimestamp(4 LE) + 0x00000000
   *   + checksum(1) + end(1)
   */
  _sendHeartbeatResponse(heartbeatFrame) {
    const seq0 = heartbeatFrame[5];
    const seq1 = heartbeatFrame[6];
    const serial = heartbeatFrame.readUInt32LE(7);

    const payloadLength = 10;
    const frameLength = payloadLength + V5_OVERHEAD; // 23 bytes total
    const frame = Buffer.alloc(frameLength);
    let offset = 0;

    // Header (11 bytes)
    frame[offset++] = V5_START;
    frame.writeUInt16LE(payloadLength, offset); offset += 2;
    frame[offset++] = V5_CONTROL_SUFFIX;
    frame[offset++] = V5_CONTROL_HEARTBEAT_RESPONSE;
    frame[offset++] = seq0;
    frame[offset++] = seq1;
    frame.writeUInt32LE(serial, offset); offset += 4;

    // Payload (10 bytes)
    frame[offset++] = 0x01;
    frame[offset++] = 0x00;
    frame.writeUInt32LE(Math.floor(Date.now() / 1000), offset); offset += 4;
    frame.writeUInt32LE(0x00000000, offset); offset += 4;

    // Trailer
    frame[offset] = this._calculateV5Checksum(frame);
    offset++;
    frame[offset] = V5_END;

    if (this._socket && this._connected) {
      this._logger.log(`[SolarmanApi] TX heartbeat response (${frame.length}B): ${frame.toString('hex')}`);
      try {
        this._socket.write(frame);
      } catch (err) {
        this._logger.error(`[SolarmanApi] Failed to send heartbeat response: ${err.message}`);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Internal: Promise-based mutex
  // ---------------------------------------------------------------------------

  /**
   * Acquire exclusive access for a single Modbus transaction.
   * Blocks if another request is already in flight.
   */
  async _acquireLock() {
    const start = Date.now();
    while (this._locked) {
      if (Date.now() - start > 60000) {
        this._locked = false;
        this._waiters = [];
        throw new Error('[SolarmanApi] Lock acquisition timeout — possible deadlock, lock reset');
      }
      await new Promise((resolve) => {
        this._waiters.push(resolve);
      });
    }
    this._locked = true;
  }

  /**
   * Release the lock and wake the next waiter, if any.
   */
  _releaseLock() {
    this._locked = false;
    if (this._waiters.length > 0) {
      const next = this._waiters.shift();
      next();
    }
  }

}

module.exports = SolarmanApi;
