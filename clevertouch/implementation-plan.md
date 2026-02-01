# CleverTouch Homey App Implementation Plan

## Overview

Build a Homey SDK v3 app for CleverTouch radiators and smart devices (lights, outlets). The app will use the CleverTouch cloud API to control devices.

**Target:** Homey Pro (2023), SDK v3, compatibility >=5.0.0

---

## What We Know

### CleverTouch API
- **OAuth2 + OpenID Connect** authentication
- **Cloud polling** — no local API
- **Multiple brands** supported (Purmo, Frico, Fenix, etc.)
- **Endpoints documented**: auth, user read, home read, query push
- **Token management**: 5-minute access token, 30-minute refresh token
- **Rate limiting**: Use 180s polling interval, 15s quick updates after changes

### Device Types
| Type | API ID | Homey Class | Key Capabilities |
|------|--------|-------------|------------------|
| Radiator | R | thermostat | measure_temperature, target_temperature, heat_mode |
| Light | L | light | onoff |
| Outlet | O | socket | onoff |

### Data Model
```
Account → User → Home(s) → Zone(s) + Device(s)
```

### Temperature Handling
- **Unit**: Celsius × 10 (device units)
- **Step**: 0.5°C
- **Range**: 5°C – 30°C
- **Conversion**: `deviceValue / 10` for display

### Heat Modes
| Mode | gv_mode | Description |
|------|---------|-------------|
| Off | 0 | Heating disabled |
| Frost | 1 | Frost protection |
| Eco | 2 | Energy saving |
| Comfort | 3 | Normal comfort |
| Program | 4 | Schedule-based |
| Boost | 5 | Temporary override |

---

## Architectural Decisions

### OAuth2 Strategy ✅ DECIDED

**DECISION: Use homey-oauth2app (Option A)**

Per Homey coding guidelines and for best practices:
- Automatic token lifecycle management
- Built-in token refresh and secure storage
- Standard Homey pattern, well-tested
- Less custom code to maintain
- App extends `OAuth2App`, Devices extend `OAuth2Device`

**Impact if using homey-oauth2app:**
- Phase 1.2: Implement `OAuth2Client` class instead of `CleverTouchApi`
- Phase 2: Devices extend `OAuth2Device` instead of `Homey.Device`
- Add dependency: `homey-oauth2app` to package.json
- Simplifies token management significantly

### Brand/Model Selection Scope ✅ DECIDED

**DECISION: App-wide brand selection**
- Brand is selected during first device pairing
- Stored in `homey.settings` as `model_id`
- All devices use the same brand/API endpoint
- To use multiple brands, need separate app installations

**Rationale:** Simpler implementation, most users have single brand

### API Base URL Mapping

Different brands use different API endpoints:

```javascript
const API_BASES = {
  'purmo': 'https://purmo.dpm-portal.com',
  'frico': 'https://frico.dpm-portal.com',
  'fenix': 'https://fenix.dpm-portal.com',
  // Add other brands as needed
};
```

### Token Timing Verification ⏰

**IMPORTANT:** Per plan, token lifetimes are:
- Access token: 5 minutes
- Refresh token: 30 minutes

**⚠️ VERIFY DURING PHASE 1:** These seem very short (especially refresh token requiring re-auth every 30min).
Validate actual token lifetimes during API client implementation and update plan if different.

### Multiple Homes Support

**Approach:**
- Each pairing session adds devices from ONE home
- Users can pair multiple times for multiple homes
- Each device stores its `homeId` in device data
- Home is selected during pairing flow

---

## Implementation Phases

### Phase 1: App Scaffold & API Client

| ID | Task | Status |
|----|------|--------|
| 1.1 | Create app structure with Homey Compose | ⬜ |
| 1.2 | Implement CleverTouchApi class (auth, token refresh) | ⬜ |
| 1.3 | Add brand/model selector support | ⬜ |
| 1.4 | Implement API methods (read user, read home, write query) | ⬜ |
| 1.5 | Add proper error handling and retry logic | ⬜ |
| 1.6 | Validate with `homey app validate --level debug` | ⬜ |

**Deliverables:**
- `app.js` — App entry, initializes API client
- `app.json` — Root manifest
- `.homeycompose/app.json` — Full metadata
- `package.json` — Dependencies (node-fetch, homey-oauth2app optional)
- `lib/clevertouch-api.js` — API client class

### Phase 2: Radiator Driver (Primary)

| ID | Task | Status |
|----|------|--------|
| 2.1 | Create radiator driver scaffold | ⬜ |
| 2.2 | Implement pairing flow (login → select home → list devices) | ⬜ |
| 2.3 | Register standard capabilities (measure_temperature, target_temperature) | ⬜ |
| 2.4 | Create custom capability: clevertouch_heat_mode | ⬜ |
| 2.5 | Create custom capability: clevertouch_heating_active | ⬜ |
| 2.6 | Implement capability setters (set temperature, set mode) | ⬜ |
| 2.7 | Implement polling refresh (180s normal, 15s after changes) | ⬜ |
| 2.8 | Add device settings (comfort/eco/frost temperatures) | ⬜ |
| 2.9 | Test pairing and control on Homey Pro | ⬜ |

**Deliverables:**
- `drivers/radiator/driver.js` — Pairing logic
- `drivers/radiator/device.js` — Device runtime
- `drivers/radiator/driver.compose.json` — Driver manifest
- `.homeycompose/capabilities/clevertouch_heat_mode.json`
- `.homeycompose/capabilities/clevertouch_heating_active.json`

### Phase 3: On/Off Device Drivers

| ID | Task | Status |
|----|------|--------|
| 3.1 | Create light driver (class: light, capability: onoff) | ⬜ |
| 3.2 | Create outlet driver (class: socket, capability: onoff) | ⬜ |
| 3.3 | Reuse pairing flow from radiator | ⬜ |
| 3.4 | Test on/off control | ⬜ |

### Phase 4: Flow Cards

| ID | Task | Status |
|----|------|--------|
| 4.1 | Add trigger: temperature_changed | ⬜ |
| 4.2 | Add trigger: heat_mode_changed | ⬜ |
| 4.3 | Add trigger: heating_started / heating_stopped | ⬜ |
| 4.4 | Add trigger: boost_ended | ⬜ |
| 4.5 | Add condition: is_heating | ⬜ |
| 4.6 | Add condition: heat_mode_is | ⬜ |
| 4.7 | Add action: set_heat_mode | ⬜ |
| 4.8 | Add action: start_boost | ⬜ |
| 4.9 | Test flow cards in Homey app | ⬜ |

### Phase 5: Polish & Testing

| ID | Task | Status |
|----|------|--------|
| 5.1 | Add locales (en.json, fi.json) | ⬜ |
| 5.2 | Create app and driver icons | ⬜ |
| 5.3 | Add app images (small.png, large.png) | ⬜ |
| 5.4 | Long-running stability test (24h+) | ⬜ |
| 5.5 | Document in README.md | ⬜ |
| 5.6 | Final validation and install | ⬜ |

---

## File Structure

```
clevertouch-app/
├── app.js                          # App entry point
├── app.json                        # Root manifest (id, version, sdk)
├── package.json                    # Dependencies
├── .homeycompose/
│   ├── app.json                    # Full app metadata
│   ├── capabilities/
│   │   ├── clevertouch_heat_mode.json
│   │   ├── clevertouch_heating_active.json
│   │   └── clevertouch_boost_remaining.json
│   └── flow/
│       ├── triggers/
│       │   ├── temperature_changed.json
│       │   ├── heat_mode_changed.json
│       │   ├── heating_started.json
│       │   ├── heating_stopped.json
│       │   └── boost_ended.json
│       ├── conditions/
│       │   ├── is_heating.json
│       │   └── heat_mode_is.json
│       └── actions/
│           ├── set_heat_mode.json
│           └── start_boost.json
├── lib/
│   └── clevertouch-api.js          # API client
├── drivers/
│   ├── radiator/
│   │   ├── device.js
│   │   ├── driver.js
│   │   ├── driver.compose.json
│   │   └── assets/
│   │       └── icon.svg
│   ├── light/
│   │   ├── device.js
│   │   ├── driver.js
│   │   ├── driver.compose.json
│   │   └── assets/
│   └── outlet/
│       ├── device.js
│       ├── driver.js
│       ├── driver.compose.json
│       └── assets/
├── locales/
│   ├── en.json
│   └── fi.json
└── assets/
    ├── icon.svg
    └── images/
        ├── small.png
        └── large.png
```

---

## Critical Implementation Details

### 1. API Client Pattern

```javascript
// lib/clevertouch-api.js
class CleverTouchApi {
  constructor(homey) {
    this.homey = homey;
    // Load stored credentials
    this.refreshToken = homey.settings.get('refresh_token');
    this.modelId = homey.settings.get('model_id') || 'purmo';
  }

  // OAuth2 flow
  async authenticate(email, password, modelId) { ... }
  async refreshAccessToken() { ... }
  
  // API calls with auto-refresh
  async apiCall(method, endpoint, data) {
    await this.ensureValidToken();
    // Make request with Bearer token
    // Handle errors, retry on 401
  }
  
  // Data fetching
  async getUser() { ... }
  async getHome(homeId) { ... }
  async getDevices(homeId) { ... }
  
  // Device control
  async setDeviceMode(homeId, deviceLocalId, mode) { ... }
  async setDeviceTemperature(homeId, deviceLocalId, type, value) { ... }
}
```

### 2. App Entry Point with Flow Cards

```javascript
// app.js
'use strict';

const Homey = require('homey');
const CleverTouchApi = require('./lib/clevertouch-api');

class CleverTouchApp extends Homey.App {
  async onInit() {
    this.api = new CleverTouchApi(this.homey);

    // Try to restore session
    const hasSession = await this.api.init();
    if (hasSession) {
      this.log('Session restored from stored credentials');
    }

    // Register flow cards
    this._registerFlowCards();

    this.log('CleverTouch app initialized');
  }

  _registerFlowCards() {
    // Action: Set heat mode
    this.homey.flow.getActionCard('set_heat_mode')
      .registerRunListener(async (args) => {
        await args.device.setCapabilityValue('clevertouch_heat_mode', args.mode);
        return true;
      });

    // Action: Start boost
    this.homey.flow.getActionCard('start_boost')
      .registerRunListener(async (args) => {
        await args.device.setCapabilityValue('clevertouch_heat_mode', 'Boost');
        return true;
      });

    // Condition: Is heating
    this.homey.flow.getConditionCard('is_heating')
      .registerRunListener(async (args) => {
        return args.device.getCapabilityValue('clevertouch_heating_active') === true;
      });

    // Condition: Heat mode is
    this.homey.flow.getConditionCard('heat_mode_is')
      .registerRunListener(async (args) => {
        const currentMode = args.device.getCapabilityValue('clevertouch_heat_mode');
        return currentMode === args.mode;
      });

    this.log('Flow cards registered');
  }
}

module.exports = CleverTouchApp;
```

**Note:** Trigger cards (temperature_changed, heat_mode_changed, heating_started, heating_stopped, boost_ended) are triggered from device code, not registered in app.js.

### 3. Pairing Flow Structure

**driver.compose.json pair configuration:**

```json
{
  "pair": [
    {
      "id": "login_credentials",
      "template": "login_credentials",
      "options": {
        "logo": "../../../assets/icon.svg",
        "title": {"en": "Login to CleverTouch", "fi": "Kirjaudu CleverTouch"}
      }
    },
    {
      "id": "select_brand",
      "template": "list_devices",
      "navigation": {
        "next": "select_home"
      }
    },
    {
      "id": "select_home",
      "template": "list_devices",
      "navigation": {
        "next": "list_devices"
      }
    },
    {
      "id": "list_devices",
      "template": "list_devices",
      "navigation": {
        "next": "add_devices"
      }
    },
    {
      "id": "add_devices",
      "template": "add_devices"
    }
  ]
}
```

**Pairing Flow Implementation (driver.js):**

```javascript
async onPair(session) {
  let selectedBrand = null;
  let selectedHome = null;
  let apiClient = null;

  // Step 1: Login with credentials
  session.setHandler('login', async (data) => {
    try {
      apiClient = new CleverTouchApi(this.homey);
      await apiClient.authenticate(data.username, data.password, 'purmo');
      return true;
    } catch (error) {
      throw new Error(this.homey.__('auth.failed'));
    }
  });

  // Step 2: List brands (if multi-brand support needed)
  session.setHandler('list_devices', async () => {
    if (!selectedBrand) {
      // Return brand list
      return [
        { name: 'Purmo', data: { id: 'purmo' } },
        { name: 'Frico', data: { id: 'frico' } },
        { name: 'Fenix', data: { id: 'fenix' } }
      ];
    }

    // Step 3: List homes
    if (!selectedHome) {
      const user = await apiClient.getUser();
      return user.homes.map(home => ({
        name: home.name,
        data: { id: home.id }
      }));
    }

    // Step 4: List devices from selected home
    const devices = await apiClient.getDevices(selectedHome.id);

    // Filter by driver type (R for radiator, L for light, O for outlet)
    const driverType = this.id.includes('radiator') ? 'R' :
                       this.id.includes('light') ? 'L' : 'O';

    return devices
      .filter(device => device.type === driverType)
      .map(device => ({
        name: device.name || `${device.type} ${device.localId}`,
        data: {
          id: device.deviceId,
          homeId: selectedHome.id,
          deviceLocalId: device.localId,
          deviceType: device.type
        },
        store: {
          modelId: selectedBrand
        },
        settings: {
          // Initial settings
        }
      }));
  });

  // Handle list_devices item selection
  session.setHandler('list_devices_selection', async (selection) => {
    if (!selectedBrand) {
      selectedBrand = selection[0].data.id;
    } else if (!selectedHome) {
      selectedHome = selection[0].data;
    }
  });
}
```

**Device Data Structure:**

Each device stores:
- `data.id` — Unique device identifier (from API)
- `data.homeId` — Home ID for API calls
- `data.deviceLocalId` — Local device ID within home
- `data.deviceType` — R/L/O type identifier
- `store.modelId` — Brand identifier for API base URL
- `settings.*` — User-configurable settings

### 4. Device Runtime with Lifecycle Management

```javascript
// drivers/radiator/device.js
class RadiatorDevice extends Homey.Device {
  async onInit() {
    this.api = this.homey.app.api;

    // Register capability listeners
    this.registerCapabilityListener('target_temperature', this.onSetTemperature.bind(this));
    this.registerCapabilityListener('clevertouch_heat_mode', this.onSetHeatMode.bind(this));

    // Add random jitter (0-30s) to avoid thundering herd when multiple devices init
    const jitter = Math.random() * 30000;

    this.log(`Starting polling with ${Math.round(jitter / 1000)}s jitter`);

    // Start polling after jitter
    this.pollInterval = this.homey.setTimeout(async () => {
      await this.poll();  // Initial poll

      // Then start regular interval
      this.pollInterval = this.homey.setInterval(
        () => this.poll(),
        180 * 1000  // 3 minutes
      );
    }, jitter);
  }

  async poll() {
    try {
      const data = await this.api.getDeviceData(
        this.getData().homeId,
        this.getData().deviceId
      );

      // Track previous heat mode for boost detection
      const oldMode = this.getCapabilityValue('clevertouch_heat_mode');

      // Update capabilities only if changed
      this._updateCapability('measure_temperature', data.currentTemp / 10);
      this._updateCapability('target_temperature', data.targetTemp / 10);
      this._updateCapability('clevertouch_heat_mode', data.heatMode);
      this._updateCapability('clevertouch_heating_active', data.heatingUp);

      // Boost mode tracking
      if (data.heatMode === 'Boost' && data.boostEndsAt) {
        const remaining = Math.max(0, (data.boostEndsAt - Date.now()) / 1000 / 60);
        this._updateCapability('clevertouch_boost_remaining', remaining);
      } else if (oldMode === 'Boost' && data.heatMode !== 'Boost') {
        // Boost ended - trigger flow card
        await this.homey.flow.getDeviceTriggerCard('boost_ended')
          .trigger(this)
          .catch(this.error);
      }

      // Mark device as available if it was unavailable
      if (!this.getAvailable()) {
        await this.setAvailable();
        this.log('Device is available again');
      }

    } catch (error) {
      this.error('Poll failed:', error.message);

      // Only mark unavailable if was previously available
      if (this.getAvailable()) {
        await this.setUnavailable(error.message);
        this.log('Device marked unavailable due to error');
      }
      // Continue polling - will retry on next interval
    }
  }

  _updateCapability(name, value) {
    if (this.hasCapability(name) && this.getCapabilityValue(name) !== value) {
      this.setCapabilityValue(name, value)
        .catch(err => this.error(`Failed to set ${name}:`, err));
    }
  }

  async onSetTemperature(value) {
    const currentMode = this.getCapabilityValue('clevertouch_heat_mode');

    // Map mode to temperature type - update the appropriate preset
    const tempType = {
      'Comfort': 'comfort',
      'Eco': 'eco',
      'Frost': 'frost',
      'Program': 'comfort',  // Update comfort as default for program
      'Boost': 'comfort',
      'Off': 'comfort'
    }[currentMode] || 'comfort';

    await this.api.setDeviceTemperature(
      this.getData().homeId,
      this.getData().deviceLocalId,
      tempType,
      Math.round(value * 10)
    );

    // Quick poll after change
    this._scheduleQuickPoll();
  }

  async onSetHeatMode(mode) {
    const modeValue = {
      'Off': 0,
      'Frost': 1,
      'Eco': 2,
      'Comfort': 3,
      'Program': 4,
      'Boost': 5
    }[mode];

    await this.api.setDeviceMode(
      this.getData().homeId,
      this.getData().deviceLocalId,
      modeValue
    );

    this._scheduleQuickPoll();
  }

  async onSettings({ oldSettings, newSettings, changedKeys }) {
    // Handle temperature preset changes
    if (changedKeys.includes('comfortTemp') ||
        changedKeys.includes('ecoTemp') ||
        changedKeys.includes('frostTemp')) {

      this.log('Updating device presets:', newSettings);

      await this.api.setDevicePresets(
        this.getData().homeId,
        this.getData().deviceLocalId,
        {
          comfort: Math.round(newSettings.comfortTemp * 10),
          eco: Math.round(newSettings.ecoTemp * 10),
          frost: Math.round(newSettings.frostTemp * 10)
        }
      );

      // Quick poll to confirm changes
      this._scheduleQuickPoll();
    }
  }

  async onUninit() {
    this.log('Device uninitializing');

    // Clear intervals
    if (this.pollInterval) {
      this.homey.clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    if (this.quickPollTimer) {
      this.homey.clearInterval(this.quickPollTimer);
      this.quickPollTimer = null;
    }
  }

  async onDeleted() {
    this.log('Device deleted from Homey');
    // Additional cleanup if needed
  }
}
```

### 5. Polling Strategy

```javascript
const POLL_INTERVAL_NORMAL = 180 * 1000;   // 3 minutes
const POLL_INTERVAL_QUICK = 15 * 1000;      // 15 seconds after change
const QUICK_POLL_COUNT = 3;

// After a write operation:
_scheduleQuickPoll() {
  this.quickPollsRemaining = QUICK_POLL_COUNT;
  
  if (!this.quickPollTimer) {
    this.quickPollTimer = this.homey.setInterval(() => {
      this.poll();
      this.quickPollsRemaining--;
      
      if (this.quickPollsRemaining <= 0) {
        this.homey.clearInterval(this.quickPollTimer);
        this.quickPollTimer = null;
      }
    }, POLL_INTERVAL_QUICK);
  }
}
```

### 6. Custom Capabilities

**clevertouch_heat_mode.json:**
```json
{
  "type": "enum",
  "title": { "en": "Heat Mode", "fi": "Lämmitystila" },
  "values": [
    { "id": "Off", "title": { "en": "Off", "fi": "Pois" } },
    { "id": "Frost", "title": { "en": "Frost", "fi": "Halla" } },
    { "id": "Eco", "title": { "en": "Eco", "fi": "Eco" } },
    { "id": "Comfort", "title": { "en": "Comfort", "fi": "Mukavuus" } },
    { "id": "Program", "title": { "en": "Program", "fi": "Ohjelma" } },
    { "id": "Boost", "title": { "en": "Boost", "fi": "Tehostus" } }
  ],
  "getable": true,
  "setable": true,
  "uiComponent": "picker"
}
```

### 7. Error Handling Pattern with Timeout

```javascript
async apiCall(method, endpoint, data) {
  const maxRetries = 3;
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await this.ensureValidToken();

      // Setup abort controller for timeout
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      try {
        const response = await fetch(this.apiBase + endpoint, {
          method,
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: data ? new URLSearchParams(data) : undefined,
          signal: controller.signal
        });

        clearTimeout(timeout);

        if (response.status === 401) {
          // Token expired, refresh and retry
          await this.refreshAccessToken();
          continue;
        }

        if (!response.ok) {
          throw new Error(`API error: ${response.status}`);
        }

        return await response.json();

      } catch (fetchError) {
        clearTimeout(timeout);

        if (fetchError.name === 'AbortError') {
          throw new Error('Request timeout after 10 seconds');
        }
        throw fetchError;
      }

    } catch (error) {
      lastError = error;
      this.homey.log(`API call failed (attempt ${attempt}):`, error.message);

      if (attempt < maxRetries) {
        // Backoff with jitter (linear backoff + random 0-500ms)
        await this._sleep(1000 * attempt + Math.random() * 500);
      }
    }
  }

  throw lastError;
}

_sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

### 8. Device Settings UI (Radiator)

**driver.compose.json settings:**

```json
{
  "settings": [
    {
      "id": "comfortTemp",
      "type": "number",
      "label": {
        "en": "Comfort Temperature",
        "fi": "Mukavuuslämpötila"
      },
      "hint": {
        "en": "Target temperature for Comfort mode",
        "fi": "Tavoitelämpötila Mukavuus-tilassa"
      },
      "value": 21,
      "min": 5,
      "max": 30,
      "step": 0.5,
      "units": {
        "en": "°C"
      }
    },
    {
      "id": "ecoTemp",
      "type": "number",
      "label": {
        "en": "Eco Temperature",
        "fi": "Eco-lämpötila"
      },
      "hint": {
        "en": "Target temperature for Eco mode",
        "fi": "Tavoitelämpötila Eco-tilassa"
      },
      "value": 18,
      "min": 5,
      "max": 30,
      "step": 0.5,
      "units": {
        "en": "°C"
      }
    },
    {
      "id": "frostTemp",
      "type": "number",
      "label": {
        "en": "Frost Protection Temperature",
        "fi": "Hallansuojauslämpötila"
      },
      "hint": {
        "en": "Target temperature for Frost protection mode",
        "fi": "Tavoitelämpötila Hallansuoja-tilassa"
      },
      "value": 7,
      "min": 5,
      "max": 15,
      "step": 0.5,
      "units": {
        "en": "°C"
      }
    }
  ]
}
```

**Note:** Settings changes are handled by the `onSettings()` method in device.js (see Section 4).

---

## Asset and Localization Specifications

### Icon Requirements

**App Icon** (`/assets/icon.svg`)
- Dimensions: 500×500px
- Format: Clean SVG, optimized
- Style: Single color preferred, represents brand/app
- Used in Homey app store and app list

**Driver Icons** (`/drivers/*/assets/icon.svg`)
- Dimensions: 500×500px each
- Format: SVG
- Icons needed:
  - `radiator/assets/icon.svg` — Radiator/thermostat symbol
  - `light/assets/icon.svg` — Light bulb symbol
  - `outlet/assets/icon.svg` — Power outlet symbol

**App Images** (`/assets/images/`)
- `small.png` — 250×175px (app store tile)
- `large.png` — 500×350px (app details page)
- Show app features or supported devices

### Localization Checklist

**Files:** `locales/en.json`, `locales/fi.json`

**Required translations:**
- [ ] App name and description
- [ ] All driver names (radiator, light, outlet)
- [ ] Custom capability titles and enum values:
  - `clevertouch_heat_mode` (Off, Frost, Eco, Comfort, Program, Boost)
  - `clevertouch_heating_active` (Yes/No or Active/Inactive)
  - `clevertouch_boost_remaining` (unit: minutes)
- [ ] Flow card titles, descriptions, and argument labels:
  - Triggers: temperature_changed, heat_mode_changed, heating_started, heating_stopped, boost_ended
  - Conditions: is_heating, heat_mode_is
  - Actions: set_heat_mode, start_boost
- [ ] Device settings labels, hints:
  - comfortTemp, ecoTemp, frostTemp
- [ ] Pairing flow strings (login prompt, home selection, etc.)
- [ ] Error messages shown to users:
  - Authentication failures
  - Connection errors
  - Device unavailability reasons

**Pattern:** Use `this.homey.__('key.subkey')` for all user-facing strings in code.

---

## Dependencies Update

### Static Checks
- [ ] `npm ci` installs cleanly
- [ ] `homey app build` succeeds
- [ ] `homey app validate --level debug` passes
- [ ] No `homey` in package.json dependencies

### On-Device Tests
- [ ] App installs on Homey Pro
- [ ] Pairing flow completes (login → home → devices)
- [ ] Radiator shows temperature correctly
- [ ] Temperature control works
- [ ] Heat mode control works
- [ ] Polling updates values
- [ ] App recovers from API errors
- [ ] Token refresh works after 5+ minutes
- [ ] Flow cards function correctly

### Stability Tests
- [ ] 24-hour soak test without crashes
- [ ] Memory stable (no leaks)
- [ ] Handles network outages gracefully
- [ ] Handles invalid credentials gracefully

---

## Dependencies

**package.json:**

```json
{
  "dependencies": {
    "node-fetch": "^2.6.9"
  },
  "devDependencies": {
    "homey": "^3.0.0"
  }
}
```

**If using homey-oauth2app (recommended):**

```json
{
  "dependencies": {
    "node-fetch": "^2.6.9",
    "homey-oauth2app": "^5.0.0"
  },
  "devDependencies": {
    "homey": "^3.0.0"
  }
}
```

**IMPORTANT:**
- `homey` should **ONLY** be in `devDependencies` (for types/intellisense)
- **NEVER** add `homey` to `dependencies` — it's provided by the Homey runtime
- Use `^` for semver ranges to allow patch updates while locking major/minor versions

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| API changes without notice | Breaking | Monitor for 4xx errors, alert user |
| Token refresh fails | Auth loss | Fall back to re-login prompt |
| Rate limiting | Temporary block | Backoff, reduce poll frequency |
| No local API | Cloud dependency | Document limitation, handle offline |
| Multi-home setup | Complexity | Support home selector in pairing |

---

## Next Steps

1. **Start Phase 1** — Create app scaffold and API client
2. **Test auth flow** — Verify OAuth2 works with real credentials
3. **Implement radiator driver** — Core functionality first
4. **Iterate** — Add features incrementally with validation

---

## Reference Documents

- [01-authentication.md](docs/01-authentication.md) — OAuth2 flow details
- [02-api-endpoints.md](docs/02-api-endpoints.md) — API endpoint reference
- [03-api-library-analysis.md](docs/03-api-library-analysis.md) — Python library patterns
- [04-data-model.md](docs/04-data-model.md) — Data structures
- [05-capabilities-mapping.md](docs/05-capabilities-mapping.md) — HA→Homey mapping
- [06-homey-app-design.md](docs/06-homey-app-design.md) — Detailed design
- [07-flow-cards.md](docs/07-flow-cards.md) — Flow card definitions

## Homey Development Reference

- [../docs/04-coding-guidelines.md](../docs/04-coding-guidelines.md) — Error handling, logging, polling
- [../docs/03-dev-loop-run-install-debug.md](../docs/03-dev-loop-run-install-debug.md) — Dev workflow
- [../docs/02-project-structure-homey-compose.md](../docs/02-project-structure-homey-compose.md) — File structure

---

## Changelog: Plan Improvements

This updated plan incorporates 18+ critical improvements from code review:

### Architectural Decisions Added ⚠️
- **OAuth2 Strategy**: Document decision between homey-oauth2app vs custom (recommend homey-oauth2app)
- **Brand Selection Scope**: Clarified app-wide brand selection approach
- **API Base URL Mapping**: Added brand-to-endpoint mapping
- **Token Timing Verification**: Flagged need to verify 5min/30min token lifetimes
- **Multiple Homes Support**: Clarified one-home-per-pairing approach

### Implementation Improvements ✅
1. **Pairing Flow Structure**: Full driver.compose.json pair config with templates and handlers
2. **Device Data Storage**: Explicit structure for data/store/settings in pairing
3. **Device Lifecycle**: Added onUninit(), onDeleted(), onSettings() methods
4. **Temperature Type Logic**: Fixed hardcoded 'comfort' → dynamic based on current mode
5. **Polling Jitter**: Added 0-30s random jitter to avoid thundering herd
6. **Re-availability Strategy**: Improved error handling with proper state transitions
7. **Fetch Timeout**: Fixed with AbortController pattern (fetch doesn't support timeout param)
8. **Boost Mode Tracking**: Added logic for boost remaining time and boost_ended trigger
9. **Device Settings UI**: Full settings specification for comfort/eco/frost temperatures
10. **Flow Card Registration**: Complete _registerFlowCards() implementation in app.js
11. **Error Handling**: Improved _updateCapability() with hasCapability() check
12. **Dependencies**: Proper version pinning and devDependencies structure

### Documentation Enhancements 📝
- **Icon Requirements**: Specified dimensions and formats for all assets
- **Localization Checklist**: Complete list of required translations
- **Asset Specifications**: Size requirements for app images
- **Code Comments**: Better documentation of intent in all examples

### What Changed in Code Examples
- Section 2 (App Entry): Added complete flow card registration
- Section 3 (Pairing): Complete multi-step pairing with brand/home selection
- Section 4 (Device Runtime): Added lifecycle methods, jitter, boost tracking, onSetHeatMode
- Section 7 (Error Handling): Fixed timeout implementation with AbortController
- Section 8 (NEW): Device settings UI specification

### Ready for Implementation ✅

The plan now includes:
- **All architectural decisions** documented and flagged for review
- **Complete code patterns** for all major components
- **Proper error handling** throughout
- **Best practices** from Homey coding guidelines
- **Validation checklists** for testing

**Next Action:** Review architectural decisions (especially OAuth2 strategy), then proceed with Phase 1 implementation.
