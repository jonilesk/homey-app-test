'use strict';

/**
 * MiOT property and action constants for Dreame vacuums.
 * All SIID/PIID/AIID values verified against Tasshack/dreame-vacuum HA integration.
 *
 * Reference: custom_components/dreame_vacuum/dreame/const.py
 */

// --- Property definitions (SIID, PIID) ---

const PROP = {
  // Service 2: Vacuum (state)
  STATE:            { siid: 2, piid: 1 },
  ERROR:            { siid: 2, piid: 2 },

  // Service 3: Battery
  BATTERY_LEVEL:    { siid: 3, piid: 1 },
  CHARGING_STATUS:  { siid: 3, piid: 2 },

  // Service 4: Cleaning
  STATUS:           { siid: 4, piid: 1 },
  CLEANING_TIME:    { siid: 4, piid: 2 },
  CLEANED_AREA:     { siid: 4, piid: 3 },
  SUCTION_LEVEL:    { siid: 4, piid: 4 },
  WATER_VOLUME:     { siid: 4, piid: 5 },
  TASK_STATUS:      { siid: 4, piid: 7 },
  CLEANING_MODE:    { siid: 4, piid: 23 },

  // Service 9-12: Consumables & stats
  MAIN_BRUSH_LEFT:      { siid: 9, piid: 2 },
  SIDE_BRUSH_LEFT:      { siid: 10, piid: 2 },
  FILTER_LEFT:          { siid: 11, piid: 1 },
  TOTAL_CLEANING_TIME:  { siid: 12, piid: 2 },
  CLEANING_COUNT:       { siid: 12, piid: 3 },
  TOTAL_CLEANED_AREA:   { siid: 12, piid: 4 },

  // Service 4: Custom cleaning properties (used for segment cleaning)
  CLEANING_PROPERTIES:  { siid: 4, piid: 10 },

  // Service 6: Map
  MAP_DATA:             { siid: 6, piid: 1 },
  FRAME_INFO:           { siid: 6, piid: 2 },
  OBJECT_NAME:          { siid: 6, piid: 3 },
};

// --- Action definitions (SIID, AIID) ---

const ACTION = {
  START:   { siid: 2, aiid: 1 },   // Start/resume cleaning
  PAUSE:   { siid: 2, aiid: 2 },   // Pause cleaning
  CHARGE:  { siid: 3, aiid: 1 },   // Return to dock
  STOP:    { siid: 4, aiid: 2 },   // Stop cleaning
  LOCATE:  { siid: 7, aiid: 1 },   // Play locate sound
  START_CUSTOM: { siid: 4, aiid: 1 },   // Start custom/segment cleaning
  REQUEST_MAP:  { siid: 6, aiid: 1 },   // Request map data
};

// --- State enums ---

/**
 * DreameVacuumState (SIID:2 PIID:1)
 * Maps integer state values to capability enum IDs.
 */
const VACUUM_STATE = {
  1:  'sweeping',
  2:  'idle',
  3:  'paused',
  4:  'error',
  5:  'returning',
  6:  'charging',
  7:  'mopping',
  8:  'drying',
  9:  'washing',
  10: 'returning_washing',
  11: 'building',
  12: 'sweeping_and_mopping',
  13: 'charging_completed',
  14: 'upgrading',
};

/**
 * States that indicate active cleaning.
 */
const CLEANING_STATES = new Set([
  'sweeping', 'mopping', 'sweeping_and_mopping',
]);

/**
 * States that indicate charging.
 */
const CHARGING_STATES = new Set([
  'charging', 'charging_completed',
]);

/**
 * DreameVacuumSuctionLevel (SIID:4 PIID:4)
 */
const SUCTION_LEVEL = {
  0: 'quiet',
  1: 'standard',
  2: 'strong',
  3: 'turbo',
};

const SUCTION_LEVEL_REVERSE = {
  quiet:    0,
  standard: 1,
  strong:   2,
  turbo:    3,
};

/**
 * Cleaning mode mapping (SIID:4 PIID:23)
 * Simple devices use values 0/1/2 directly.
 * Devices with self-wash base use a grouped integer encoding:
 *   bits 0-1: cleaning mode (mop-lifting: 0=sweep+mop, 1=mopping, 2=sweeping)
 *   bits 8-15: self-clean area
 *   bits 16+: mop wash level
 */
const CLEANING_MODE = {
  0: 'sweeping',
  1: 'mopping',
  2: 'sweeping_and_mopping',
};

const CLEANING_MODE_REVERSE = {
  sweeping:              0,
  mopping:               1,
  sweeping_and_mopping:  2,
};

/**
 * Decode cleaning mode from raw property value.
 * Handles both simple (0/1/2) and grouped (self-wash base) values.
 * Grouped format from Tasshack: split_group_value extracts bottom 2 bits.
 * Mop-pad-lifting mapping: 0=sweep+mop, 1=mopping, 2=sweeping (inverted from simple).
 */
function decodeCleaningMode(rawValue) {
  // Simple device values
  if (rawValue >= 0 && rawValue <= 2) {
    return CLEANING_MODE[rawValue];
  }
  // Grouped value for self-wash-base devices
  const modeBits = rawValue & 3;
  switch (modeBits) {
    case 0: return 'sweeping_and_mopping';
    case 1: return 'mopping';
    case 2: return 'sweeping';
    case 3: return 'sweeping_and_mopping'; // Custom/auto mode — treat as sweep+mop
    default: return 'sweeping_and_mopping';
  }
}

/**
 * Water volume mapping (SIID:4 PIID:5)
 */
const WATER_VOLUME = {
  1: 'low',
  2: 'medium',
  3: 'high',
};

const WATER_VOLUME_REVERSE = {
  low:    1,
  medium: 2,
  high:   3,
};

/**
 * Segment/room type mapping from Tasshack dreame-vacuum.
 * Maps integer type IDs to human-readable room names.
 */
const SEGMENT_TYPE = {
  0:  'Living Room',
  1:  'Bedroom',
  2:  'Kitchen',
  3:  'Study',
  4:  'Bathroom',
  5:  'Balcony',
  6:  'Hallway',
  7:  'Dining Room',
  8:  'Gym',
  9:  'Storage Room',
  10: 'Garage',
  11: 'Laundry Room',
  12: 'Office',
  13: 'Nursery',
  14: 'Guest Room',
  15: 'Entrance',
};

/**
 * Properties polled on each interval.
 */
const POLL_PROPERTIES = [
  PROP.STATE,
  PROP.ERROR,
  PROP.BATTERY_LEVEL,
  PROP.CHARGING_STATUS,
  PROP.STATUS,
  PROP.SUCTION_LEVEL,
  PROP.CLEANING_MODE,
  PROP.WATER_VOLUME,
  PROP.CLEANED_AREA,
  PROP.CLEANING_TIME,
  PROP.MAIN_BRUSH_LEFT,
  PROP.SIDE_BRUSH_LEFT,
  PROP.FILTER_LEFT,
];

module.exports = {
  PROP,
  ACTION,
  VACUUM_STATE,
  CLEANING_STATES,
  CHARGING_STATES,
  SUCTION_LEVEL,
  SUCTION_LEVEL_REVERSE,
  CLEANING_MODE,
  CLEANING_MODE_REVERSE,
  decodeCleaningMode,
  WATER_VOLUME,
  WATER_VOLUME_REVERSE,
  SEGMENT_TYPE,
  POLL_PROPERTIES,
};
