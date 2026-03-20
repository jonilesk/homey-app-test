'use strict';

/**
 * Parse Report 1 JSON (device identification).
 * @param {object} data - Raw JSON from "report 1" response
 * @returns {object} Parsed device identification
 */
function parseReport1(data) {
  return {
    id: parseInt(data.ID, 10),
    product: data.Product || '',
    serial: data.Serial || '',
    firmware: data.Firmware || '',
    comModule: data['COM-module'] || '',
    backend: data.Backend || '',
    timeQ: data.timeQ || '',
    dipSw: data['DIP-Sw'] || '',
  };
}

/**
 * Parse Report 2 JSON (charging status).
 * Scaling factors match Python source charging_station.py datagram_received().
 * @param {object} data - Raw JSON from "report 2" response
 * @returns {object} Parsed charging status
 */
function parseReport2(data) {
  const state = parseInt(data.State, 10);
  const plug = parseInt(data.Plug, 10);
  const { stateOn, stateDetail } = decodeChargingState(state);
  const plugState = decodePlugState(plug);

  return {
    state,
    stateOn,
    stateDetail,
    plug,
    ...plugState,
    enableSys: parseInt(data['Enable sys'], 10),
    enableUser: parseInt(data['Enable user'], 10),
    maxCurr: parseInt(data['Max curr'], 10) / 1000,        // mA → A
    maxCurrPercent: parseInt(data['Max curr %'], 10) / 10,  // ‰ → %
    currHW: parseInt(data['Curr HW'], 10) / 1000,          // mA → A
    currUser: parseInt(data['Curr user'], 10) / 1000,      // mA → A
    currFS: parseInt(data['Curr FS'], 10) / 1000,          // mA → A
    currTimer: parseInt(data['Curr timer'], 10) / 1000,    // mA → A
    tmoFS: parseInt(data['Tmo FS'], 10),
    tmoCI: parseInt(data['Tmo CT'], 10),
    fsOn: parseInt(data['Tmo FS'], 10) > 0,
    output: parseInt(data.Output, 10),
    input: parseInt(data.Input, 10),
    authReq: parseInt(data['AuthReq'], 10) || 0,
    authOn: parseInt(data['Authon'], 10) || 0,
    sec: parseInt(data.Sec, 10),
  };
}

/**
 * Parse Report 3 JSON (metering / energy data).
 * Scaling factors match Python source charging_station.py datagram_received().
 * @param {object} data - Raw JSON from "report 3" response
 * @returns {object} Parsed metering data
 */
function parseReport3(data) {
  return {
    u1: parseInt(data.U1, 10),                                // Volts (no scaling)
    u2: parseInt(data.U2, 10),
    u3: parseInt(data.U3, 10),
    i1: parseInt(data.I1, 10) / 1000,                         // mA → A
    i2: parseInt(data.I2, 10) / 1000,
    i3: parseInt(data.I3, 10) / 1000,
    power: Math.round(parseInt(data.P, 10) / 1000000 * 1000), // µW → kW → W (for measure_power)
    powerKw: Math.round(parseInt(data.P, 10) / 1000000 * 100) / 100, // µW → kW (2 decimals)
    powerFactor: parseInt(data.PF, 10) / 1000,                // ‰ → ratio (0–1)
    energySession: Math.round(parseInt(data['E pres'], 10) / 10000 * 100) / 100, // 0.1Wh → kWh (2 dec)
    energyTotal: Math.round(parseInt(data['E total'], 10) / 10000 * 100) / 100,  // 0.1Wh → kWh (2 dec)
    energyStart: Math.round(parseInt(data['E start'], 10) / 10000 * 100) / 100,
    sec: parseInt(data.Sec, 10),
  };
}

/**
 * Decode plug state integer to structured state.
 * Values from KEBA UDP protocol specification.
 * @param {number} raw - Plug state integer (0, 1, 3, 5, 7)
 * @returns {object}
 */
function decodePlugState(raw) {
  const plugCS = raw > 0;           // Cable connected to charging station
  const plugLocked = raw === 3 || raw === 7;
  const plugEV = raw > 4;           // EV connected

  let plugDetail;
  switch (raw) {
    case 0: plugDetail = 'no_cable'; break;
    case 1: plugDetail = 'cable_cs'; break;
    case 3: plugDetail = 'cable_locked'; break;
    case 5: plugDetail = 'cable_ev'; break;
    case 7: plugDetail = 'cable_locked_ev'; break;
    default: plugDetail = 'unknown'; break;
  }

  return { plugCS, plugLocked, plugEV, plugDetail };
}

/**
 * Decode charging state integer.
 * Values from KEBA UDP protocol specification.
 * @param {number} raw - State integer (0–5)
 * @returns {{ stateOn: boolean, stateDetail: string }}
 */
function decodeChargingState(raw) {
  switch (raw) {
    case 0: return { stateOn: false, stateDetail: 'starting' };
    case 1: return { stateOn: false, stateDetail: 'not_ready' };
    case 2: return { stateOn: false, stateDetail: 'ready' };
    case 3: return { stateOn: true, stateDetail: 'charging' };
    case 4: return { stateOn: false, stateDetail: 'error' };
    case 5: return { stateOn: false, stateDetail: 'auth_rejected' };
    default: return { stateOn: false, stateDetail: 'unknown' };
  }
}

/**
 * Determine response type from raw UDP message.
 * Mirrors Python utils.py get_response_type().
 * @param {string} message - Raw UDP message string
 * @returns {string} Response type identifier
 */
function getResponseType(message) {
  if (!message || message.length === 0) return 'unknown';
  if (message.startsWith('i')) return 'broadcast';
  if (message.startsWith('"Firmware') || message.startsWith('Firmware')) return 'basic_info';
  if (message.includes('TCH-OK')) return 'tch-ok';
  if (message.includes('TCH-ERR')) return 'tch-err';

  try {
    const json = JSON.parse(message);
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

/**
 * Validate current value per KEBA specification.
 * Must be 0 (disable) or between 6–63 A.
 * @param {number} amperes - Current in Amperes
 * @returns {boolean}
 */
function validateCurrent(amperes) {
  if (typeof amperes !== 'number') return false;
  return amperes === 0 || (amperes >= 6 && amperes <= 63);
}

module.exports = {
  parseReport1,
  parseReport2,
  parseReport3,
  decodePlugState,
  decodeChargingState,
  getResponseType,
  validateCurrent,
};
