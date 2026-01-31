# Flow Cards for CleverTouch Homey App

## Overview

Flow cards enable automation in Homey. This document defines triggers, conditions, and actions for CleverTouch devices.

---

## Triggers (When...)

### 1. Temperature Changed

**File**: `.homeycompose/flow/triggers/temperature_changed.json`

```json
{
  "id": "temperature_changed",
  "title": {
    "en": "The temperature changed"
  },
  "hint": {
    "en": "When the measured temperature changes"
  },
  "args": [
    {
      "name": "device",
      "type": "device",
      "filter": "driver_id=radiator"
    }
  ],
  "tokens": [
    {
      "name": "temperature",
      "type": "number",
      "title": { "en": "Temperature" },
      "example": 21.5
    }
  ]
}
```

### 2. Heat Mode Changed

**File**: `.homeycompose/flow/triggers/heat_mode_changed.json`

```json
{
  "id": "heat_mode_changed",
  "title": {
    "en": "The heat mode changed"
  },
  "hint": {
    "en": "When the heating mode changes"
  },
  "args": [
    {
      "name": "device",
      "type": "device",
      "filter": "driver_id=radiator"
    }
  ],
  "tokens": [
    {
      "name": "heat_mode",
      "type": "string",
      "title": { "en": "Heat Mode" },
      "example": "Comfort"
    }
  ]
}
```

### 3. Heating Started

**File**: `.homeycompose/flow/triggers/heating_started.json`

```json
{
  "id": "heating_started",
  "title": {
    "en": "Heating started"
  },
  "hint": {
    "en": "When the radiator starts heating"
  },
  "args": [
    {
      "name": "device",
      "type": "device",
      "filter": "driver_id=radiator"
    }
  ]
}
```

### 4. Heating Stopped

**File**: `.homeycompose/flow/triggers/heating_stopped.json`

```json
{
  "id": "heating_stopped",
  "title": {
    "en": "Heating stopped"
  },
  "hint": {
    "en": "When the radiator stops heating"
  },
  "args": [
    {
      "name": "device",
      "type": "device",
      "filter": "driver_id=radiator"
    }
  ]
}
```

### 5. Boost Mode Ended

**File**: `.homeycompose/flow/triggers/boost_ended.json`

```json
{
  "id": "boost_ended",
  "title": {
    "en": "Boost mode ended"
  },
  "hint": {
    "en": "When boost mode timer expires"
  },
  "args": [
    {
      "name": "device",
      "type": "device",
      "filter": "driver_id=radiator"
    }
  ]
}
```

---

## Conditions (And...)

### 1. Is Heating

**File**: `.homeycompose/flow/conditions/is_heating.json`

```json
{
  "id": "is_heating",
  "title": {
    "en": "Is !{{heating|not heating}}"
  },
  "hint": {
    "en": "Check if the radiator is actively heating"
  },
  "args": [
    {
      "name": "device",
      "type": "device",
      "filter": "driver_id=radiator"
    }
  ]
}
```

### 2. Heat Mode Is

**File**: `.homeycompose/flow/conditions/heat_mode_is.json`

```json
{
  "id": "heat_mode_is",
  "title": {
    "en": "Heat mode is !{{|not}} ..."
  },
  "titleFormatted": {
    "en": "Heat mode is !{{|not}} [[mode]]"
  },
  "hint": {
    "en": "Check if the heat mode matches"
  },
  "args": [
    {
      "name": "device",
      "type": "device",
      "filter": "driver_id=radiator"
    },
    {
      "name": "mode",
      "type": "dropdown",
      "title": { "en": "Mode" },
      "values": [
        { "id": "Off", "title": { "en": "Off" } },
        { "id": "Frost", "title": { "en": "Frost Protection" } },
        { "id": "Eco", "title": { "en": "Eco" } },
        { "id": "Comfort", "title": { "en": "Comfort" } },
        { "id": "Program", "title": { "en": "Program" } },
        { "id": "Boost", "title": { "en": "Boost" } }
      ]
    }
  ]
}
```

### 3. Temperature Is Above/Below

**File**: `.homeycompose/flow/conditions/temperature_compare.json`

```json
{
  "id": "temperature_compare",
  "title": {
    "en": "Temperature is !{{above|below}} ..."
  },
  "titleFormatted": {
    "en": "Temperature is !{{above|below}} [[temperature]]°C"
  },
  "hint": {
    "en": "Check if temperature is above or below a value"
  },
  "args": [
    {
      "name": "device",
      "type": "device",
      "filter": "driver_id=radiator"
    },
    {
      "name": "temperature",
      "type": "range",
      "title": { "en": "Temperature" },
      "min": 5,
      "max": 30,
      "step": 0.5,
      "label": "°C",
      "labelDecimals": 1
    }
  ]
}
```

### 4. In Boost Mode

**File**: `.homeycompose/flow/conditions/is_boosting.json`

```json
{
  "id": "is_boosting",
  "title": {
    "en": "Is !{{in boost mode|not in boost mode}}"
  },
  "hint": {
    "en": "Check if boost mode is active"
  },
  "args": [
    {
      "name": "device",
      "type": "device",
      "filter": "driver_id=radiator"
    }
  ]
}
```

---

## Actions (Then...)

### 1. Set Heat Mode

**File**: `.homeycompose/flow/actions/set_heat_mode.json`

```json
{
  "id": "set_heat_mode",
  "title": {
    "en": "Set heat mode to ..."
  },
  "titleFormatted": {
    "en": "Set heat mode to [[mode]]"
  },
  "hint": {
    "en": "Change the heating mode"
  },
  "args": [
    {
      "name": "device",
      "type": "device",
      "filter": "driver_id=radiator"
    },
    {
      "name": "mode",
      "type": "dropdown",
      "title": { "en": "Mode" },
      "values": [
        { "id": "Off", "title": { "en": "Off" } },
        { "id": "Frost", "title": { "en": "Frost Protection" } },
        { "id": "Eco", "title": { "en": "Eco" } },
        { "id": "Comfort", "title": { "en": "Comfort" } },
        { "id": "Program", "title": { "en": "Program" } },
        { "id": "Boost", "title": { "en": "Boost" } }
      ]
    }
  ]
}
```

### 2. Set Target Temperature

**File**: `.homeycompose/flow/actions/set_target_temperature.json`

```json
{
  "id": "set_target_temperature",
  "title": {
    "en": "Set temperature to ..."
  },
  "titleFormatted": {
    "en": "Set temperature to [[temperature]]°C"
  },
  "hint": {
    "en": "Set the target temperature for current mode"
  },
  "args": [
    {
      "name": "device",
      "type": "device",
      "filter": "driver_id=radiator"
    },
    {
      "name": "temperature",
      "type": "range",
      "title": { "en": "Temperature" },
      "min": 5,
      "max": 30,
      "step": 0.5,
      "label": "°C",
      "labelDecimals": 1
    }
  ]
}
```

### 3. Activate Boost

**File**: `.homeycompose/flow/actions/activate_boost.json`

```json
{
  "id": "activate_boost",
  "title": {
    "en": "Activate boost mode"
  },
  "titleFormatted": {
    "en": "Activate boost for [[duration]] hours at [[temperature]]°C"
  },
  "hint": {
    "en": "Activate boost mode with custom duration and temperature"
  },
  "args": [
    {
      "name": "device",
      "type": "device",
      "filter": "driver_id=radiator"
    },
    {
      "name": "duration",
      "type": "range",
      "title": { "en": "Duration" },
      "min": 1,
      "max": 24,
      "step": 1,
      "label": "hours",
      "labelDecimals": 0
    },
    {
      "name": "temperature",
      "type": "range",
      "title": { "en": "Temperature" },
      "min": 5,
      "max": 30,
      "step": 0.5,
      "label": "°C",
      "labelDecimals": 1
    }
  ]
}
```

### 4. Set Comfort Temperature

**File**: `.homeycompose/flow/actions/set_comfort_temperature.json`

```json
{
  "id": "set_comfort_temperature",
  "title": {
    "en": "Set comfort temperature to ..."
  },
  "titleFormatted": {
    "en": "Set comfort temperature to [[temperature]]°C"
  },
  "hint": {
    "en": "Set the temperature preset for comfort mode"
  },
  "args": [
    {
      "name": "device",
      "type": "device",
      "filter": "driver_id=radiator"
    },
    {
      "name": "temperature",
      "type": "range",
      "title": { "en": "Temperature" },
      "min": 5,
      "max": 30,
      "step": 0.5,
      "label": "°C",
      "labelDecimals": 1
    }
  ]
}
```

### 5. Set Eco Temperature

**File**: `.homeycompose/flow/actions/set_eco_temperature.json`

```json
{
  "id": "set_eco_temperature",
  "title": {
    "en": "Set eco temperature to ..."
  },
  "titleFormatted": {
    "en": "Set eco temperature to [[temperature]]°C"
  },
  "hint": {
    "en": "Set the temperature preset for eco mode"
  },
  "args": [
    {
      "name": "device",
      "type": "device",
      "filter": "driver_id=radiator"
    },
    {
      "name": "temperature",
      "type": "range",
      "title": { "en": "Temperature" },
      "min": 5,
      "max": 30,
      "step": 0.5,
      "label": "°C",
      "labelDecimals": 1
    }
  ]
}
```

---

## Flow Card Implementation

### In driver.js

```javascript
'use strict';

const Homey = require('homey');

class RadiatorDriver extends Homey.Driver {
  async onInit() {
    this.log('Radiator driver initialized');
    
    // Register flow cards
    this._registerFlowCards();
  }

  _registerFlowCards() {
    // Action: Set heat mode
    this.homey.flow.getActionCard('set_heat_mode')
      .registerRunListener(async (args) => {
        await args.device.setHeatMode(args.mode);
      });

    // Action: Set target temperature
    this.homey.flow.getActionCard('set_target_temperature')
      .registerRunListener(async (args) => {
        await args.device.setCapabilityValue('target_temperature', args.temperature);
        await args.device.onTargetTemperature(args.temperature);
      });

    // Action: Activate boost
    this.homey.flow.getActionCard('activate_boost')
      .registerRunListener(async (args) => {
        await args.device.activateBoost(args.duration * 60, args.temperature);
      });

    // Action: Set comfort temperature
    this.homey.flow.getActionCard('set_comfort_temperature')
      .registerRunListener(async (args) => {
        await args.device.setPresetTemperature('comfort', args.temperature);
      });

    // Action: Set eco temperature
    this.homey.flow.getActionCard('set_eco_temperature')
      .registerRunListener(async (args) => {
        await args.device.setPresetTemperature('eco', args.temperature);
      });

    // Condition: Is heating
    this.homey.flow.getConditionCard('is_heating')
      .registerRunListener(async (args) => {
        return args.device.getCapabilityValue('clevertouch_heating_active');
      });

    // Condition: Heat mode is
    this.homey.flow.getConditionCard('heat_mode_is')
      .registerRunListener(async (args) => {
        return args.device.getCapabilityValue('clevertouch_heat_mode') === args.mode;
      });

    // Condition: Temperature compare
    this.homey.flow.getConditionCard('temperature_compare')
      .registerRunListener(async (args, state) => {
        const currentTemp = args.device.getCapabilityValue('measure_temperature');
        return currentTemp > args.temperature;
      });

    // Condition: Is boosting
    this.homey.flow.getConditionCard('is_boosting')
      .registerRunListener(async (args) => {
        return args.device.getCapabilityValue('clevertouch_heat_mode') === 'Boost';
      });
  }
}

module.exports = RadiatorDriver;
```

### In device.js (trigger firing)

```javascript
// Add to _updateFromData method

async _updateFromData(data) {
  // ... existing update code ...

  // Check for trigger conditions
  const oldMode = this.getCapabilityValue('clevertouch_heat_mode');
  const newMode = modeMap[parseInt(data.gv_mode)] || 'Off';
  
  if (oldMode !== newMode) {
    // Fire heat mode changed trigger
    await this.driver.triggerHeatModeChanged(this, { heat_mode: newMode });
    
    // Check for boost ended
    if (oldMode === 'Boost' && newMode !== 'Boost') {
      await this.driver.triggerBoostEnded(this);
    }
  }

  const oldHeating = this.getCapabilityValue('clevertouch_heating_active');
  const newHeating = data.heating_up === '1';
  
  if (oldHeating !== newHeating) {
    if (newHeating) {
      await this.driver.triggerHeatingStarted(this);
    } else {
      await this.driver.triggerHeatingStopped(this);
    }
  }

  // ... continue with capability updates ...
}
```

### Trigger card registration in driver.js

```javascript
// Add to driver onInit

async onInit() {
  // ... existing code ...

  // Register device triggers
  this._triggerHeatModeChanged = this.homey.flow.getDeviceTriggerCard('heat_mode_changed');
  this._triggerHeatingStarted = this.homey.flow.getDeviceTriggerCard('heating_started');
  this._triggerHeatingStopped = this.homey.flow.getDeviceTriggerCard('heating_stopped');
  this._triggerBoostEnded = this.homey.flow.getDeviceTriggerCard('boost_ended');
}

async triggerHeatModeChanged(device, tokens) {
  await this._triggerHeatModeChanged.trigger(device, tokens);
}

async triggerHeatingStarted(device) {
  await this._triggerHeatingStarted.trigger(device);
}

async triggerHeatingStopped(device) {
  await this._triggerHeatingStopped.trigger(device);
}

async triggerBoostEnded(device) {
  await this._triggerBoostEnded.trigger(device);
}
```

---

## Example Flows

### 1. Energy Saving at Night
- **When**: Time is 23:00
- **Then**: Set heat mode to "Eco" on Living Room Radiator

### 2. Morning Comfort
- **When**: Time is 06:30
- **Then**: Set heat mode to "Comfort" on Bedroom Radiator

### 3. Boost When Cold
- **When**: Temperature dropped below 18°C (Bathroom Radiator)
- **Then**: Activate boost for 1 hour at 24°C

### 4. Away Mode
- **When**: Homey detects everyone left
- **Then**: Set heat mode to "Frost" on all radiators

### 5. Notification on Heating
- **When**: Heating started (Any Radiator)
- **Then**: Send push notification "Heating active in {zone}"
