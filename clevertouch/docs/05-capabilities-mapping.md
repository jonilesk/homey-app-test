# Capabilities Mapping: Home Assistant → Homey

## Overview

This document maps CleverTouch entities from the Home Assistant integration to their Homey equivalents.

---

## Radiator Device

### Climate Entity → Thermostat Capabilities

| HA Property | Homey Capability | Type | Notes |
|-------------|------------------|------|-------|
| `current_temperature` | `measure_temperature` | number | Current room temperature |
| `target_temperature` | `target_temperature` | number | Active setpoint |
| `hvac_mode` | - | enum | Map to heat_mode |
| `hvac_action` | - | enum | Heating/Idle/Off state |
| `preset_mode` | Custom capability | enum | Heat mode selection |

### Homey Capability Definition for Radiator

```json
{
  "capabilities": [
    "measure_temperature",
    "target_temperature",
    "clevertouch_heat_mode"
  ],
  "capabilitiesOptions": {
    "target_temperature": {
      "min": 5,
      "max": 30,
      "step": 0.5
    }
  }
}
```

### Custom Capability: clevertouch_heat_mode

```json
{
  "type": "enum",
  "title": {
    "en": "Heat Mode"
  },
  "values": [
    { "id": "Off", "title": { "en": "Off" } },
    { "id": "Frost", "title": { "en": "Frost Protection" } },
    { "id": "Eco", "title": { "en": "Eco" } },
    { "id": "Comfort", "title": { "en": "Comfort" } },
    { "id": "Program", "title": { "en": "Program" } },
    { "id": "Boost", "title": { "en": "Boost" } }
  ],
  "getable": true,
  "setable": true,
  "uiComponent": "picker"
}
```

---

## Temperature Sensors

### HA Sensor → Homey measure_temperature

| HA Sensor | Homey Capability | Description |
|-----------|------------------|-------------|
| Comfort temperature | Custom or settings | Comfort setpoint |
| Eco temperature | Custom or settings | Eco setpoint |
| Frost temperature | Custom or settings | Frost setpoint |
| Boost temperature | Custom or settings | Boost setpoint |
| Boost time remaining | Custom capability | Seconds remaining |

### Implementation Options

**Option A: Multiple measure capabilities**
```json
{
  "capabilities": [
    "measure_temperature",
    "measure_temperature.comfort",
    "measure_temperature.eco"
  ]
}
```

**Option B: Device settings (recommended for setpoints)**
```javascript
// In driver.compose.json
{
  "settings": [
    {
      "id": "comfort_temperature",
      "type": "number",
      "label": { "en": "Comfort Temperature" },
      "value": 21,
      "min": 5,
      "max": 30,
      "units": "°C"
    },
    {
      "id": "eco_temperature",
      "type": "number",
      "label": { "en": "Eco Temperature" },
      "value": 18,
      "min": 5,
      "max": 30,
      "units": "°C"
    }
  ]
}
```

---

## On/Off Devices (Light, Outlet)

### HA Switch → Homey onoff

| HA Property | Homey Capability | Type |
|-------------|------------------|------|
| `is_on` | `onoff` | boolean |

### Homey Capability Definition

```json
{
  "capabilities": ["onoff"],
  "class": "socket"  // or "light"
}
```

---

## Number Entities (Writable Temperatures)

### HA Number → Homey Settings or Custom Capabilities

| HA Entity | Homey Approach | Notes |
|-----------|----------------|-------|
| Comfort temp setpoint | Settings dialog | Rarely changed |
| Eco temp setpoint | Settings dialog | Rarely changed |
| Boost time preset | Settings dialog | Configuration |

---

## Full Radiator Device Mapping

### driver.compose.json

```json
{
  "name": {
    "en": "CleverTouch Radiator"
  },
  "class": "thermostat",
  "capabilities": [
    "measure_temperature",
    "target_temperature",
    "clevertouch_heat_mode",
    "clevertouch_heating_active"
  ],
  "capabilitiesOptions": {
    "target_temperature": {
      "min": 5,
      "max": 30,
      "step": 0.5
    }
  },
  "settings": [
    {
      "id": "comfort_temperature",
      "type": "number",
      "label": { "en": "Comfort Temperature" },
      "value": 21,
      "min": 5,
      "max": 30,
      "step": 0.5,
      "units": "°C"
    },
    {
      "id": "eco_temperature",
      "type": "number",
      "label": { "en": "Eco Temperature" },
      "value": 18,
      "min": 5,
      "max": 30,
      "step": 0.5,
      "units": "°C"
    },
    {
      "id": "frost_temperature",
      "type": "number",
      "label": { "en": "Frost Protection Temperature" },
      "value": 7,
      "min": 5,
      "max": 15,
      "step": 0.5,
      "units": "°C"
    },
    {
      "id": "boost_temperature",
      "type": "number",
      "label": { "en": "Boost Temperature" },
      "value": 25,
      "min": 5,
      "max": 30,
      "step": 0.5,
      "units": "°C"
    },
    {
      "id": "boost_duration",
      "type": "number",
      "label": { "en": "Boost Duration" },
      "value": 1,
      "min": 1,
      "max": 24,
      "step": 1,
      "units": "hours"
    }
  ]
}
```

---

## Custom Capabilities Definition

### .homeycompose/capabilities/clevertouch_heat_mode.json

```json
{
  "type": "enum",
  "title": {
    "en": "Heat Mode"
  },
  "desc": {
    "en": "The current heating mode"
  },
  "values": [
    {
      "id": "Off",
      "title": { "en": "Off" }
    },
    {
      "id": "Frost",
      "title": { "en": "Frost Protection" }
    },
    {
      "id": "Eco",
      "title": { "en": "Eco" }
    },
    {
      "id": "Comfort",
      "title": { "en": "Comfort" }
    },
    {
      "id": "Program",
      "title": { "en": "Program" }
    },
    {
      "id": "Boost",
      "title": { "en": "Boost" }
    }
  ],
  "getable": true,
  "setable": true,
  "uiComponent": "picker",
  "icon": "/assets/icons/heat-mode.svg"
}
```

### .homeycompose/capabilities/clevertouch_heating_active.json

```json
{
  "type": "boolean",
  "title": {
    "en": "Heating"
  },
  "desc": {
    "en": "Whether the radiator is actively heating"
  },
  "getable": true,
  "setable": false,
  "uiComponent": "sensor",
  "icon": "/assets/icons/flame.svg",
  "insights": true,
  "insightsTitleTrue": { "en": "Heating active" },
  "insightsTitleFalse": { "en": "Heating inactive" }
}
```

### .homeycompose/capabilities/clevertouch_boost_remaining.json

```json
{
  "type": "number",
  "title": {
    "en": "Boost Time Remaining"
  },
  "desc": {
    "en": "Remaining boost time in minutes"
  },
  "units": {
    "en": "min"
  },
  "getable": true,
  "setable": false,
  "uiComponent": "sensor",
  "icon": "/assets/icons/timer.svg"
}
```

---

## State Mapping

### Heat Mode → Target Temperature

| Heat Mode | Active Setpoint | Notes |
|-----------|-----------------|-------|
| Off | - | No temperature control |
| Frost | frost_temperature | Frost protection |
| Eco | eco_temperature | Energy saving |
| Comfort | comfort_temperature | Normal comfort |
| Program | (varies) | Schedule-based |
| Boost | boost_temperature | Temporary override |

### HVAC Action Mapping

| HA hvac_action | Homey `clevertouch_heating_active` |
|----------------|-------------------------------------|
| `heating` | `true` |
| `idle` | `false` |
| `off` | `false` |

---

## Device Class Mapping

| Device Type | Homey Class | Icon |
|-------------|-------------|------|
| Radiator | `thermostat` | Radiator icon |
| Light | `light` | Light bulb |
| Outlet | `socket` | Power socket |

---

## Capability Listener Implementation

```javascript
// In device.js

async onInit() {
  // Heat mode changes
  this.registerCapabilityListener('clevertouch_heat_mode', async (value) => {
    await this.setHeatMode(value);
  });
  
  // Target temperature changes
  this.registerCapabilityListener('target_temperature', async (value) => {
    await this.setTargetTemperature(value);
  });
}

async setHeatMode(mode) {
  // Map to API call
  const modeValue = HEAT_MODE_TO_API[mode];
  await this.driver.api.writeQuery(this.getData().homeId, {
    id_device: this.getData().idLocal,
    gv_mode: modeValue,
    nv_mode: modeValue
  });
}

async setTargetTemperature(temperature) {
  const currentMode = this.getCapabilityValue('clevertouch_heat_mode');
  const tempType = MODE_TO_TEMP_TYPE[currentMode];
  if (!tempType) return;
  
  const deviceUnits = Math.round(temperature * 10);
  await this.driver.api.writeQuery(this.getData().homeId, {
    id_device: this.getData().idLocal,
    [TEMP_TYPE_TO_API_FIELD[tempType]]: deviceUnits
  });
}
```
