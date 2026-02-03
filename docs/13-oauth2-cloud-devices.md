# OAuth2 Apps & Cloud-Connected Devices

This guide documents patterns and lessons learned from building OAuth2-based cloud-connected Homey apps, using the CleverTouch app as a reference implementation.

## When to Use OAuth2App

Use `homey-oauth2app` when your app:
- Connects to a cloud API requiring OAuth2 authentication
- Needs automatic token refresh handling
- Has devices that make API calls using the authenticated client
- Requires per-user authentication (not app-wide API keys)

**Reference:** https://athombv.github.io/node-homey-oauth2app

## Project Structure

```
your-app/
├── app.js                           # Extends OAuth2App
├── lib/
│   └── YourOAuth2Client.js          # Extends OAuth2Client
└── drivers/
    └── device-type/
        ├── driver.js                # Extends OAuth2Driver
        └── device.js                # Extends OAuth2Device
```

## OAuth2Client Implementation

### Token Persistence Issue

**Critical Learning:** The `homey-oauth2app` library doesn't always persist tokens reliably across app restarts. Implement backup storage:

```javascript
async onGetTokenByCredentials({ username, password }) {
  // ... get token from API ...

  // IMPORTANT: Store tokens as backup in homey.settings
  if (tokenData.access_token) {
    this.homey.settings.set('myapp_access_token', tokenData.access_token);
  }
  if (tokenData.refresh_token) {
    this.homey.settings.set('myapp_refresh_token', tokenData.refresh_token);
  }
  
  // Store expiration timestamp for proactive refresh
  const expiresAt = Date.now() + (tokenData.expires_in * 1000);
  this.homey.settings.set('myapp_token_expires_at', expiresAt);

  return new OAuth2Token({ ... });
}

async onRefreshToken() {
  // Try to get refresh token from token object first, then from settings backup
  let refreshToken = this.getToken()?.refresh_token;
  
  if (!refreshToken) {
    this.log('No refresh token in token object, trying settings backup...');
    refreshToken = this.homey.settings.get('myapp_refresh_token');
  }
  
  // ... refresh token ...
  
  // Update backup tokens after refresh
  if (tokenData.access_token) {
    this.homey.settings.set('myapp_access_token', tokenData.access_token);
  }
  if (tokenData.refresh_token) {
    this.homey.settings.set('myapp_refresh_token', tokenData.refresh_token);
  }
}

// In API calls, fall back to settings backup
async _apiCall(method, path, data) {
  let accessToken = this.getToken()?.access_token;
  if (!accessToken) {
    accessToken = this.homey.settings.get('myapp_access_token');
  }
  // ... make API call ...
}
```

### Proactive Token Refresh

Refresh tokens before they expire to avoid failed API calls:

```javascript
const TOKEN_REFRESH_THRESHOLD = 0.8; // Refresh at 80% of lifetime

async _ensureValidToken() {
  const expiresAt = this.homey.settings.get('myapp_token_expires_at');
  const now = Date.now();
  const timeUntilExpiry = expiresAt - now;
  const totalLifetime = 300000; // 5 min default
  const refreshThreshold = totalLifetime * (1 - TOKEN_REFRESH_THRESHOLD);

  if (timeUntilExpiry < refreshThreshold) {
    this.log('Token near expiration, proactively refreshing...');
    const newToken = await this.onRefreshToken();
    this.setToken(newToken);
    await this.save();
  }
}
```

### Basic Pattern

```javascript
const { OAuth2Client } = require('homey-oauth2app');
const fetch = require('node-fetch');

class YourOAuth2Client extends OAuth2Client {

  // Define token endpoint (required)
  static get TOKEN_URL() {
    return 'https://api.example.com/oauth/token';
  }

  // Define API base (required)
  static get API_URL() {
    return 'https://api.example.com';
  }

  // Make API calls with automatic token refresh
  async getDevices() {
    return this._apiCall('GET', '/api/devices');
  }

  // Internal API call method with timeout and retry
  async _apiCall(method, path, data) {
    const maxRetries = 3;
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Setup abort controller for timeout
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        try {
          const response = await fetch(this.apiBaseUrl + path, {
            method,
            headers: {
              'Authorization': `Bearer ${this.getAccessToken()}`,
              'Content-Type': 'application/json'
            },
            body: data ? JSON.stringify(data) : undefined,
            signal: controller.signal
          });

          clearTimeout(timeout);

          if (response.status === 401) {
            // Token expired - OAuth2App will automatically refresh
            throw new Error('Unauthorized');
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
        this.log(`API call failed (attempt ${attempt}/${maxRetries}):`, error.message);

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
}
```

### Key Points

1. **Timeout Handling**: Native `fetch()` doesn't support timeout parameter
   - Use `AbortController` with `setTimeout`
   - Clear timeout after request completes

2. **Token Refresh**: OAuth2App handles this automatically
   - Detect 401 responses
   - Throw error to trigger refresh
   - OAuth2App will retry with new token

3. **Retry Logic**:
   - 3 attempts max (configurable)
   - Linear backoff + jitter (1s, 2s, 3s + random)
   - Prevents thundering herd

## OAuth2Device Implementation

### Device Lifecycle

```javascript
const { OAuth2Device } = require('homey-oauth2app');

class YourDevice extends OAuth2Device {

  async onOAuth2Init() {
    this.log('Device initialized');

    // Register capability listeners
    this.registerCapabilityListener('onoff', this.onSetOnOff.bind(this));
    this.registerCapabilityListener('target_temperature', this.onSetTemperature.bind(this));

    // Add random jitter (0-30s) to avoid thundering herd
    const jitter = Math.random() * 30000;
    this.log(`Starting polling with ${Math.round(jitter / 1000)}s jitter`);

    // Start polling after jitter
    this.pollTimeout = this.homey.setTimeout(async () => {
      await this.poll();  // Initial poll

      // Then start regular interval
      this.pollInterval = this.homey.setInterval(
        () => this.poll(),
        180 * 1000  // 3 minutes
      );
    }, jitter);
  }

  async onOAuth2Uninit() {
    this.log('Device uninitializing');

    // Clear all intervals and timeouts
    if (this.pollTimeout) {
      this.homey.clearTimeout(this.pollTimeout);
      this.pollTimeout = null;
    }

    if (this.pollInterval) {
      this.homey.clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    if (this.quickPollTimer) {
      this.homey.clearInterval(this.quickPollTimer);
      this.quickPollTimer = null;
    }
  }

  async onOAuth2Deleted() {
    this.log('Device deleted from Homey');
    // Additional cleanup if needed
  }
}
```

### Polling Strategy

#### Normal vs Quick Polling

```javascript
const POLL_INTERVAL_NORMAL = 180 * 1000;   // 3 minutes
const POLL_INTERVAL_QUICK = 15 * 1000;     // 15 seconds
const QUICK_POLL_COUNT = 3;                // Number of quick polls

async poll() {
  try {
    const data = await this.oAuth2Client.getDeviceData(this.getData().id);

    // Update capabilities
    this._updateCapability('measure_temperature', data.currentTemp);
    this._updateCapability('target_temperature', data.targetTemp);

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

// Schedule quick polling after user changes
_scheduleQuickPoll() {
  this.quickPollsRemaining = QUICK_POLL_COUNT;

  if (!this.quickPollTimer) {
    this.log(`Starting quick poll (${POLL_INTERVAL_QUICK / 1000}s interval)`);

    this.quickPollTimer = this.homey.setInterval(() => {
      this.poll();
      this.quickPollsRemaining--;

      if (this.quickPollsRemaining <= 0) {
        this.log('Quick poll complete, returning to normal interval');
        this.homey.clearInterval(this.quickPollTimer);
        this.quickPollTimer = null;
      }
    }, POLL_INTERVAL_QUICK);
  }
}
```

#### Why Use Jitter?

Without jitter, all devices initialize simultaneously:
```
Device 1: Poll at 00:00, 03:00, 06:00...
Device 2: Poll at 00:00, 03:00, 06:00...
Device 3: Poll at 00:00, 03:00, 06:00...
→ API gets 3 requests at once (thundering herd)
```

With jitter (0-30s random delay):
```
Device 1: Poll at 00:05, 03:05, 06:05...
Device 2: Poll at 00:18, 03:18, 06:18...
Device 3: Poll at 00:23, 03:23, 06:23...
→ API gets 3 requests spread over 30 seconds
```

### Capability Updates

```javascript
_updateCapability(name, value) {
  if (this.hasCapability(name)) {
    const currentValue = this.getCapabilityValue(name);
    if (currentValue !== value) {
      this.setCapabilityValue(name, value)
        .catch(err => this.error(`Failed to set ${name}:`, err));
    }
  }
}
```

**Why check before updating?**
- Reduces unnecessary writes
- Prevents capability change events when value hasn't changed
- Improves performance

## Pairing Flow

### OAuth2Driver Pattern

```javascript
const { OAuth2Driver } = require('homey-oauth2app');

class YourDriver extends OAuth2Driver {

  async onPairListDevices({ oAuth2Client }) {
    this.log('Listing devices for pairing');

    try {
      // Get devices from API using authenticated client
      const devices = await oAuth2Client.getDevices();

      // Map to Homey device format
      return devices.map(device => ({
        name: device.name,
        data: {
          id: device.id,           // Unique device ID
          // Store any IDs needed for API calls
        },
        store: {
          // Non-critical data (can be lost)
        },
        settings: {
          // Initial settings values
        }
      }));

    } catch (error) {
      this.error('Error listing devices:', error);
      throw new Error(this.homey.__('pair.error.list_devices'));
    }
  }
}
```

### Device Data Structure

**data** (critical, immutable):
- Unique device identifier
- IDs needed for API calls
- Cannot be changed after pairing

**store** (non-critical):
- Cached data that can be refreshed
- User-friendly labels
- Can be updated via `setStoreValue()`

**settings** (user-configurable):
- User preferences
- Configuration values
- Modified via Homey UI

## Device Settings with API Sync

```javascript
async onSettings({ oldSettings, newSettings, changedKeys }) {
  this.log('Settings changed:', changedKeys);

  // Handle temperature preset changes
  if (changedKeys.includes('comfortTemp') ||
      changedKeys.includes('ecoTemp')) {

    try {
      // Sync to device via API
      await this.oAuth2Client.setDevicePresets(
        this.getData().id,
        {
          comfort: newSettings.comfortTemp,
          eco: newSettings.ecoTemp
        }
      );

      this.log('Device presets updated successfully');

      // Quick poll to confirm changes
      this._scheduleQuickPoll();

    } catch (error) {
      this.error('Error updating presets:', error);
      throw new Error(this.homey.__('errors.set_presets_failed'));
    }
  }
}
```

## Unit Conversion Patterns

### Temperature Units - VERIFY WITH ACTUAL API!

**Critical Learning:** Don't assume temperature encoding! Some APIs return:
- Celsius × 10 (common)
- **Fahrenheit × 10** (CleverTouch uses this!)
- Raw Celsius/Fahrenheit

Always verify with real data by comparing API values to the official app/website:

```javascript
// Example: CleverTouch API returns Fahrenheit × 10
// API: 470 → 47°F → 8.3°C (matches web portal showing 8.3°C)

const toDeciCelsius = (deciF) => {
  const fahrenheit = parseInt(deciF, 10) / 10;
  const celsius = (fahrenheit - 32) * 5 / 9;
  return Math.round(celsius * 10) / 10; // Round to 1 decimal
};

// When setting temperature, convert back
const toDeciFahrenheit = (celsius) => {
  const fahrenheit = (celsius * 9 / 5) + 32;
  return Math.round(fahrenheit * 10);
};
```

### Mode Mapping - VERIFY WITH ACTUAL API!

**Critical Learning:** Mode values often differ from documentation or assumptions:

```javascript
// WRONG assumption (from initial docs):
// 0=Off, 1=Frost, 2=Eco, 3=Comfort

// ACTUAL CleverTouch API (verified by comparing with web portal):
// 0=Off, 1=Eco, 2=Frost, 3=Comfort, 4=Program, 5=Boost

const VALUE_TO_HEAT_MODE = {
  0: 'Off',
  1: 'Eco',      // Was incorrectly assumed to be Frost!
  2: 'Frost',    // Was incorrectly assumed to be Eco!
  3: 'Comfort',
  4: 'Program',
  5: 'Boost'
};
```

**How to verify:** Compare what the API returns to what the official app shows. If API returns mode=2 and the app shows "Frost Protection", then 2=Frost.

### Hierarchical Data Structures

**Critical Learning:** Real-time data may be nested differently than summary data:

```javascript
// API response structure:
{
  "devices": [...],          // Flat array - may contain STALE data!
  "zones": [
    {
      "zone_label": "Kitchen",
      "devices": [...]       // Nested array - has REAL-TIME data!
    }
  ]
}

// WRONG: Using flat devices array (stale temperatures)
const devices = homeData.devices;

// CORRECT: Extract from zones for real-time data
async getDevices(homeId) {
  const homeData = await this.getHome(homeId);
  const devices = [];
  
  for (const zone of homeData.zones || []) {
    for (const device of zone.devices || []) {
      device._zoneName = zone.zone_label;  // Preserve zone info
      devices.push(device);
    }
  }
  
  return devices;
}
```

### Home-Level Mode Overrides

Some systems have global modes that override device-level settings:

```javascript
async poll() {
  const deviceData = await this.oAuth2Client.getDeviceData(this.getData().id);
  
  // Home general_mode may override device gv_mode
  let effectiveMode = deviceData.gv_mode;
  
  const homeGeneralMode = parseInt(deviceData._homeGeneralMode, 10);
  // 0 = no override, 1+ = active mode override
  if (!isNaN(homeGeneralMode) && homeGeneralMode >= 1 && homeGeneralMode <= 5) {
    effectiveMode = homeGeneralMode;
    this.log(`Using home mode ${homeGeneralMode} instead of device mode ${deviceData.gv_mode}`);
  }
  
  const heatMode = VALUE_TO_HEAT_MODE[effectiveMode];
  this._updateCapability('heat_mode', heatMode);
}
```

### Temperature (×10 encoding)

Some APIs encode temperatures as integers (×10):
```javascript
// API returns: 215 (means 21.5°C)
// Homey expects: 21.5

// From API to Homey
const homeyTemp = apiValue / 10;
this.setCapabilityValue('measure_temperature', homeyTemp);

// From Homey to API
const apiValue = Math.round(homeyValue * 10);
await client.setTemperature(apiValue);
```

### Boolean States

Handle various boolean representations:
```javascript
// API might return: true, 1, "on", "true"
const isOn = deviceData.state === true ||
             deviceData.state === 1 ||
             deviceData.state === 'on';

this.setCapabilityValue('onoff', isOn);
```

## Dynamic Capability Handling

### Mode-Based Temperature Selection

```javascript
async onSetTemperature(value) {
  const currentMode = this.getCapabilityValue('heat_mode');

  // Map mode to temperature type
  const tempType = {
    'comfort': 'comfort',
    'eco': 'eco',
    'frost': 'frost',
    'program': 'comfort',  // Default to comfort
    'boost': 'comfort',
    'off': 'comfort'
  }[currentMode] || 'comfort';

  await this.oAuth2Client.setDeviceTemperature(
    this.getData().id,
    tempType,
    Math.round(value * 10)
  );

  this._scheduleQuickPoll();
}
```

**Why?** User expects temperature slider to affect the current mode's target, not always the same preset.

## Error Messages & Localization

### Pattern

**Device code**:
```javascript
throw new Error(this.homey.__('errors.set_temperature_failed'));
```

**locales/en.json**:
```json
{
  "errors": {
    "set_temperature_failed": "Failed to set temperature. Please try again.",
    "device_not_found": "Device not found in your account.",
    "api_timeout": "Request timed out. Check your connection."
  }
}
```

**locales/fi.json**:
```json
{
  "errors": {
    "set_temperature_failed": "Lämpötilan asetus epäonnistui. Yritä uudelleen.",
    "device_not_found": "Laitetta ei löytynyt tililtäsi.",
    "api_timeout": "Pyyntö aikakatkaistiin. Tarkista yhteytesi."
  }
}
```

## Custom Capabilities

### Capability Migration for Existing Devices

Add new capabilities to existing devices without requiring re-pairing:

```javascript
async onOAuth2Init() {
  // Ensure all required capabilities are present (migration support)
  const requiredCapabilities = [
    'measure_temperature',
    'target_temperature',
    'custom_heat_mode',
    'custom_heating_active',
    'custom_zone',           // NEW capability
    'meter_power',           // NEW: built-in power capability
    'custom_error'           // NEW capability
  ];

  for (const cap of requiredCapabilities) {
    if (!this.hasCapability(cap)) {
      this.log(`Adding missing capability: ${cap}`);
      await this.addCapability(cap).catch(err => this.error(`Failed to add ${cap}:`, err));
    }
  }

  // Remove deprecated capabilities
  if (this.hasCapability('old_capability')) {
    this.log('Removing deprecated capability');
    await this.removeCapability('old_capability').catch(err => this.error('Failed to remove:', err));
  }
}
```

### Useful Additional Capabilities

**Zone/Room Name** (string sensor):
```json
{
  "type": "string",
  "title": { "en": "Zone" },
  "getable": true,
  "setable": false,
  "uiComponent": "sensor"
}
```

**Power Consumption** (use built-in `meter_power`):
```javascript
// Show power when heating, 0 when idle
const heatingActive = String(deviceData.heating_up) === '1';
const powerWatts = parseInt(deviceData.puissance_app, 10) || 0;
const currentPower = heatingActive ? powerWatts : 0;
this._updateCapability('meter_power', currentPower);
```

**Error Indicator** (boolean sensor):
```json
{
  "type": "boolean",
  "title": { "en": "Error" },
  "getable": true,
  "setable": false,
  "uiComponent": "sensor",
  "insights": false
}
```

```javascript
// Check error code from API
const errorCode = parseInt(deviceData.error_code, 10) || 0;
const hasError = errorCode !== 0;
this._updateCapability('custom_error', hasError);
```

### Enum Capability (Mode Selector)

**.homeycompose/capabilities/custom_mode.json**:
```json
{
  "type": "enum",
  "title": {
    "en": "Heat Mode",
    "fi": "Lämmitystila"
  },
  "values": [
    {
      "id": "off",
      "title": {
        "en": "Off",
        "fi": "Pois"
      }
    },
    {
      "id": "comfort",
      "title": {
        "en": "Comfort",
        "fi": "Mukavuus"
      }
    }
  ],
  "getable": true,
  "setable": true,
  "uiComponent": "picker"
}
```

### Boolean Sensor

```json
{
  "type": "boolean",
  "title": {
    "en": "Heating Active",
    "fi": "Lämmittää"
  },
  "getable": true,
  "setable": false,
  "uiComponent": "sensor"
}
```

## Testing Checklist

### OAuth2 Flow
- [ ] Login succeeds with valid credentials
- [ ] Login fails gracefully with invalid credentials
- [ ] Token automatically refreshes after 5+ minutes
- [ ] App re-authenticates if refresh token expires
- [ ] **Tokens persist across app restarts (check settings backup)**

### Data Accuracy
- [ ] **Temperature matches official app/website exactly**
- [ ] **Mode matches official app (verify mapping is correct)**
- [ ] Setpoints/targets match official app
- [ ] Status indicators match reality (heating on/off)

### Device Operations
- [ ] Pairing lists all available devices
- [ ] Device capabilities reflect actual state
- [ ] Capability changes sync to device
- [ ] Device becomes unavailable when API fails
- [ ] Device recovers when API is available again

### Polling
- [ ] Initial poll happens after jitter
- [ ] Regular polling continues at normal interval
- [ ] Quick polling triggers after user changes
- [ ] Multiple devices don't poll simultaneously

### Settings
- [ ] Settings UI shows current values
- [ ] Settings changes sync to device
- [ ] Invalid settings are rejected
- [ ] Settings persist across app restarts

### Error Handling
- [ ] App doesn't crash on API errors
- [ ] User sees meaningful error messages
- [ ] Devices mark unavailable on persistent errors
- [ ] Retry logic works (check logs)

## Common Pitfalls

### ❌ Don't: Compare API response codes as-is
```javascript
// BAD: API returns "8" (string), comparing to 8 (number) fails!
if (response.code?.code !== 8) {
  throw new Error('API error');
}
```

### ✅ Do: Parse response codes to integers
```javascript
// GOOD: Parse string to number before comparing
const code = parseInt(response.code?.code);
if (code !== 1 && code !== 8) {
  throw new Error('API error');
}
```

---

### ❌ Don't: Use wrong power capability
```javascript
// BAD: meter_power is cumulative energy (kWh) - not instantaneous!
this._updateCapability('meter_power', currentPowerWatts);  // Shows "0 kWh"
```

### ✅ Do: Use measure_power for instantaneous watts
```javascript
// GOOD: measure_power shows current power draw in Watts
this._updateCapability('measure_power', currentPowerWatts);  // Shows "500 W"
```

**Capability reference:**
- `meter_power` = cumulative energy consumption (kWh) - for energy tracking
- `measure_power` = instantaneous power draw (W) - for current status

---

### ❌ Don't: Assume temperature units
```javascript
// BAD: Assumes Celsius × 10
const temp = apiValue / 10;  // WRONG if API uses Fahrenheit!
```

### ✅ Do: Verify with actual data
```javascript
// GOOD: Compare API value with official app to determine unit
// If API=470 and official app shows 8.3°C, then it's Fahrenheit×10
const toDeciCelsius = (deciF) => {
  const fahrenheit = parseInt(deciF, 10) / 10;
  return Math.round((fahrenheit - 32) * 5 / 9 * 10) / 10;
};
```

---

### ❌ Don't: Trust API documentation for mode values
```javascript
// BAD: Using assumed mapping from docs
const modes = { 1: 'Frost', 2: 'Eco' };  // May be WRONG!
```

### ✅ Do: Verify mode mapping with real data
```javascript
// GOOD: Compare API mode value with what official app shows
// Log the raw value and compare: "API gv_mode=2, app shows 'Frost'"
this.log(`Raw mode: ${deviceData.gv_mode}`);
// Then fix mapping based on actual behavior
```

---

### ❌ Don't: Assume flat data arrays have real-time data
```javascript
// BAD: Using top-level devices array
const devices = apiResponse.devices;  // May be stale/cached!
```

### ✅ Do: Check nested structures for real-time data
```javascript
// GOOD: Extract from zones/rooms for fresh data
const devices = [];
for (const zone of apiResponse.zones) {
  devices.push(...zone.devices);
}
```

---

### ❌ Don't: Rely solely on OAuth2App token persistence
```javascript
// BAD: Assumes tokens are always available
const token = this.getToken().access_token;
```

### ✅ Do: Backup tokens in homey.settings
```javascript
// GOOD: Fallback to settings backup
let token = this.getToken()?.access_token;
if (!token) {
  token = this.homey.settings.get('myapp_access_token');
}
```

---

### ❌ Don't: Hardcode temperature types
```javascript
// BAD: Always updates comfort temp
await client.setTemperature('comfort', value);
```

### ✅ Do: Use dynamic selection
```javascript
// GOOD: Updates temp based on current mode
const mode = this.getCapabilityValue('heat_mode');
const tempType = MODE_TO_TEMP_TYPE[mode];
await client.setTemperature(tempType, value);
```

---

### ❌ Don't: Poll without jitter
```javascript
// BAD: All devices poll at once
this.pollInterval = setInterval(() => this.poll(), 180000);
```

### ✅ Do: Add jitter
```javascript
// GOOD: Spread polls over time
const jitter = Math.random() * 30000;
setTimeout(() => {
  this.poll();
  this.pollInterval = setInterval(() => this.poll(), 180000);
}, jitter);
```

---

### ❌ Don't: Forget to clear intervals
```javascript
// BAD: Leaks memory
async onOAuth2Uninit() {
  this.log('Bye!');
}
```

### ✅ Do: Clean up properly
```javascript
// GOOD: Clears all timers
async onOAuth2Uninit() {
  if (this.pollInterval) {
    clearInterval(this.pollInterval);
    this.pollInterval = null;
  }
}
```

---

### ❌ Don't: Use fetch timeout parameter
```javascript
// BAD: This doesn't work!
fetch(url, { timeout: 10000 })
```

### ✅ Do: Use AbortController
```javascript
// GOOD: Proper timeout handling
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 10000);
try {
  const response = await fetch(url, { signal: controller.signal });
  clearTimeout(timeout);
} catch (error) {
  clearTimeout(timeout);
  if (error.name === 'AbortError') {
    throw new Error('Timeout');
  }
  throw error;
}
```

## Deployment

### Development Mode vs Installed App

| Command | Purpose | Persistence |
|---------|---------|-------------|
| `homey app run` | Development/debugging | Stops when terminal closes |
| `homey app install` | Permanent installation | Survives reboots |

### Development Workflow

```bash
# Development - run with live logs (stops when you Ctrl+C)
homey app run

# When ready - install permanently on Homey
homey app install

# Update after changes
homey app install  # Reinstalls with new code
```

### What `homey app install` Does
- Packages your app (validates, bundles)
- Uploads to Homey
- Installs and starts the app
- App survives Homey reboots
- No terminal connection needed

### Checking Installed App
```bash
# List installed apps
homey app list

# View app logs (even when installed)
homey app log
```

## Reference Implementation

See `clevertouch-app/` for a complete working example implementing all patterns in this guide.

## Additional Resources

- OAuth2App Documentation: https://athombv.github.io/node-homey-oauth2app
- Homey Apps SDK: https://apps.developer.homey.app
- Flow Cards: https://apps.developer.homey.app/the-basics/app/flow-cards
