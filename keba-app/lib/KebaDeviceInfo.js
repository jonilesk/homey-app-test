'use strict';

/**
 * Parse product info from Report 1 data.
 * Ports charging_station_info.py product string parsing and feature detection.
 *
 * Product string format: "MANUFACTURER-MODEL-VERSION-FEATURES"
 * Examples:
 *   "KC-P30-ES230001-00R"   → KEBA P30, meter=yes, display=yes, auth=yes (R-variant)
 *   "KC-P20-ES2000e1-00R"   → KEBA P20 e-series, meter=no, auth=yes
 *   "BMW-10-EC2405B2-E1R"   → BMW Wallbox Connect, meter=yes
 *
 * @param {object} report1 - Parsed Report 1 data (from KebaDataParser.parseReport1)
 * @returns {object} Device info with features
 */
function parseProductInfo(report1) {
  const product = report1.product || report1.Product || '';
  const serial = report1.serial || report1.Serial || '';
  const firmware = report1.firmware || report1.Firmware || '';

  const parts = product.split('-');
  const prefix = parts[0] || '';
  const modelCode = parts[1] || '';
  const version = parts[2] || '';
  const features = parts.slice(3).join('-');

  let manufacturer = 'Unknown';
  let model = 'Unknown';
  let meterIntegrated = false;
  let displayAvailable = false;
  let authAvailable = false;
  let dataLogger = false;
  let phaseSwitch = true;
  const services = ['SET_FAILSAFE', 'SET_CURRENT', 'SET_CHARGING_POWER'];

  if (prefix === 'KC') {
    manufacturer = 'KEBA';
    services.push('SET_OUTPUT', 'X2', 'X2SRC');

    if (modelCode === 'P30') {
      model = 'P30';
      authAvailable = true;
      dataLogger = true;

      // DE variant has no meter and no display
      if (product.includes('-DE') || product.endsWith('-DE')) {
        model = 'P30-DE';
        meterIntegrated = false;
        displayAvailable = false;
      } else {
        meterIntegrated = true;
        displayAvailable = true;
        services.push('DISPLAY');
      }
    } else if (modelCode === 'P20') {
      model = 'P20';
      dataLogger = false;

      // Determine meter based on version suffix pattern
      // e-series (suffix contains 'e' or ends in e1): no meter
      // b-series (suffix ends in 10): has meter
      // c-series (suffix ends in 20 or 30): has meter
      const versionLower = version.toLowerCase();
      if (versionLower.includes('e') || version.endsWith('e1')) {
        meterIntegrated = false;
      } else {
        meterIntegrated = true;
      }

      // RFID auth if features contain 'R'
      if (features.includes('R')) {
        authAvailable = true;
      }
    }
  } else if (prefix === 'BMW') {
    manufacturer = 'BMW';
    meterIntegrated = true;
    authAvailable = true;
    dataLogger = true;
    phaseSwitch = false; // BMW does not support phase switching

    // Identify specific BMW model
    if (product === 'BMW-10-EC2405B2-E1R') {
      model = 'Wallbox Connect';
    } else if (product === 'BMW-10-EC240522-E1R' || product === 'BMW-10-ESS40022-E1R') {
      model = 'Wallbox Plus';
    } else {
      model = 'Wallbox';
    }
  }

  // Add conditional services
  if (meterIntegrated) {
    services.push('SET_ENERGY');
  }
  if (authAvailable) {
    services.push('START', 'STOP');
  }

  return {
    manufacturer,
    model,
    product,
    serial,
    firmware,
    meterIntegrated,
    displayAvailable,
    authAvailable,
    dataLogger,
    phaseSwitch,
    services,
  };
}

module.exports = { parseProductInfo };
