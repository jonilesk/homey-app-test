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

### 2. App Entry Point

```javascript
// app.js
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
}
```

### 3. Pairing Flow

**Step 1: Login (pair/login.html)**
- Email, password, brand selector
- Validate credentials via API
- Store tokens on success

**Step 2: Select Home (pair/select_home.html)**
- List homes from API
- User selects one home
- Store home_id for filtering

**Step 3: List Devices (pair/list_devices)**
- Fetch devices from selected home
- Filter by driver type (R/L/O)
- User selects devices to add

### 4. Device Runtime

```javascript
// drivers/radiator/device.js
class RadiatorDevice extends Homey.Device {
  async onInit() {
    this.api = this.homey.app.api;
    
    // Register capability listeners
    this.registerCapabilityListener('target_temperature', this.onSetTemperature.bind(this));
    this.registerCapabilityListener('clevertouch_heat_mode', this.onSetHeatMode.bind(this));
    
    // Start polling
    this.pollInterval = this.homey.setInterval(
      () => this.poll(),
      180 * 1000  // 3 minutes
    );
    
    // Initial fetch
    await this.poll();
  }
  
  async poll() {
    try {
      const data = await this.api.getDeviceData(this.getData().homeId, this.getData().deviceId);
      
      // Update capabilities only if changed
      this._updateCapability('measure_temperature', data.currentTemp / 10);
      this._updateCapability('target_temperature', data.targetTemp / 10);
      this._updateCapability('clevertouch_heat_mode', data.heatMode);
      this._updateCapability('clevertouch_heating_active', data.heatingUp);
      
      if (!this.getAvailable()) {
        await this.setAvailable();
      }
    } catch (error) {
      this.error('Poll failed:', error);
      await this.setUnavailable(error.message);
    }
  }
  
  _updateCapability(name, value) {
    if (this.getCapabilityValue(name) !== value) {
      this.setCapabilityValue(name, value).catch(this.error);
    }
  }
  
  async onSetTemperature(value) {
    await this.api.setDeviceTemperature(
      this.getData().homeId,
      this.getData().deviceLocalId,
      'comfort',  // or determined by current mode
      Math.round(value * 10)
    );
    // Quick poll after change
    this._scheduleQuickPoll();
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

### 7. Error Handling Pattern

```javascript
async apiCall(method, endpoint, data) {
  const maxRetries = 3;
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await this.ensureValidToken();
      
      const response = await fetch(this.apiBase + endpoint, {
        method,
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: data ? new URLSearchParams(data) : undefined,
        timeout: 10000  // 10 second timeout
      });
      
      if (response.status === 401) {
        // Token expired, refresh and retry
        await this.refreshAccessToken();
        continue;
      }
      
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }
      
      return await response.json();
      
    } catch (error) {
      lastError = error;
      this.homey.log(`API call failed (attempt ${attempt}):`, error.message);
      
      if (attempt < maxRetries) {
        // Backoff with jitter
        await this._sleep(1000 * attempt + Math.random() * 500);
      }
    }
  }
  
  throw lastError;
}
```

---

## Validation Checklist

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

```json
{
  "dependencies": {
    "node-fetch": "^2.6.9"
  }
}
```

**Note:** Do NOT add `homey` as a dependency — it's provided by runtime.

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
