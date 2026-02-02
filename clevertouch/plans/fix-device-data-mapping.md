# Plan: Fix Device Data Mapping

## Problem Summary

The Homey app is not displaying current temperature, target temperature, or mode correctly because `device.js` uses incorrect API field names.

### Screenshot Analysis (CleverTouch Web Portal)
| Device | Mode | Setpoint | Current Temp |
|--------|------|----------|--------------|
| KEITTIO | ANTI FREEZE | 8.0°C | 7.9°C |
| BEDROOM | ANTIFREEZE | 8.0°C | 8.2°C |
| VAATEHUONE | ANTI FREEZE | 8.0°C | 7.9°C |
| OLOHUONE | ANTI FREEZE | 8.5°C | 8.3°C |

### API Data Structure (from logs)
```json
{
  "id_device": "C001-000",
  "temperature_air": "79",        // Current temp: 79 ÷ 10 = 7.9°C
  "gv_mode": "1",                 // Mode: 1 = Frost/Anti-freeze
  "consigne_confort": "210",      // Comfort setpoint: 21.0°C
  "consigne_eco": "180",          // Eco setpoint: 18.0°C  
  "consigne_hg": "80",            // Frost setpoint: 8.0°C (used for Anti-freeze)
  "consigne_boost": "250",        // Boost setpoint: 25.0°C
  "heating_up": "0",              // Is heating: "0" or "1" (string!)
  "puissance_app": "750"          // Power: 750W
}
```

### Mode Mapping
| gv_mode | Name | Setpoint Field |
|---------|------|----------------|
| 0 | Off | consigne_hg (frost protection minimum) |
| 1 | Frost (Anti-freeze) | consigne_hg |
| 2 | Eco | consigne_eco |
| 3 | Comfort | consigne_confort |
| 4 | Program | varies by schedule |
| 5 | Boost | consigne_boost |

---

## Current Code Issues

### File: `drivers/radiator/device.js`

**Issue 1: Wrong field for current temperature**
```javascript
// WRONG - field doesn't exist
if (deviceData.current_temp !== undefined) {
  this._updateCapability('measure_temperature', deviceData.current_temp / 10);
}
```

**Fix:**
```javascript
// CORRECT - use temperature_air
if (deviceData.temperature_air !== undefined) {
  const currentTemp = parseInt(deviceData.temperature_air, 10) / 10;
  this._updateCapability('measure_temperature', currentTemp);
}
```

**Issue 2: Wrong field for target temperature**
```javascript
// WRONG - field doesn't exist
if (deviceData.target_temp !== undefined) {
  this._updateCapability('target_temperature', deviceData.target_temp / 10);
}
```

**Fix:**
```javascript
// CORRECT - calculate from mode
let targetTemp = null;
switch (heatMode) {
  case 'Comfort': targetTemp = deviceData.consigne_confort; break;
  case 'Eco':     targetTemp = deviceData.consigne_eco; break;
  case 'Frost':   targetTemp = deviceData.consigne_hg; break;
  case 'Boost':   targetTemp = deviceData.consigne_boost; break;
  case 'Program': targetTemp = deviceData.consigne_confort; break; // reference
  case 'Off':     targetTemp = deviceData.consigne_hg; break;
}
if (targetTemp !== null) {
  this._updateCapability('target_temperature', parseInt(targetTemp, 10) / 10);
}
```

**Issue 3: Wrong type comparison for heating_up**
```javascript
// WRONG - comparing string to number
const heatingActive = deviceData.heating_up === true || deviceData.heating_up === 1;
```

**Fix:**
```javascript
// CORRECT - API returns string "0" or "1"
const heatingActive = String(deviceData.heating_up) === '1';
```

**Issue 4: Unused boost_remaining capability**
- Remove `clevertouch_boost_remaining` capability entirely
- It's not needed per user clarification

---

## Implementation Steps

### Step 1: Update device.js poll() method
Location: `clevertouch-app/drivers/radiator/device.js` lines 57-117

Changes:
1. Replace `deviceData.current_temp` with `deviceData.temperature_air`
2. Add mode-based target temperature calculation
3. Fix `heating_up` string comparison
4. Remove boost_remaining logic
5. Add debug logging for values

### Step 2: Remove boost_remaining capability
Location: `clevertouch-app/drivers/radiator/driver.compose.json`

Remove from capabilities array:
```json
"capabilities": [
  "measure_temperature",
  "target_temperature",
  "clevertouch_heat_mode",
  "clevertouch_heating_active"
  // REMOVE: "clevertouch_boost_remaining"
]
```

### Step 3: Remove capability definition
Location: `clevertouch-app/.homeycompose/capabilities/clevertouch_boost_remaining.json`

Delete this file if it exists.

### Step 4: Update app.json (regenerate with homey compose)
Run: `homey app build` or delete `.homeybuild/` and run `homey app run`

---

## Verification

After implementing:
1. Check logs for:
   - `Current temperature: X.X°C (raw: XXX)`
   - `Target temperature: X.X°C (raw: XXX, mode: ModeName)`
   - `Heat mode: ModeName (raw: X)`
   - `Heating active: true/false (raw: X)`

2. Verify in Homey UI:
   - Current temperature matches web portal
   - Target temperature matches setpoint for current mode
   - Mode displays correctly (Frost = Anti-freeze)
   - Heating indicator works

3. Test mode change:
   - Change mode in Homey
   - Verify target temperature updates to match new mode's setpoint

---

## Files to Modify

| File | Change |
|------|--------|
| `drivers/radiator/device.js` | Fix poll() method |
| `drivers/radiator/driver.compose.json` | Remove boost_remaining capability |
| `.homeycompose/capabilities/clevertouch_boost_remaining.json` | Delete file |

---

## Timeline

- Implementation: ~15 minutes
- Testing: ~10 minutes
- Total: ~25 minutes
