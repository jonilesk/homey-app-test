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

## Reference Implementation

See `clevertouch-app/` for a complete working example implementing all patterns in this guide.

## Additional Resources

- OAuth2App Documentation: https://athombv.github.io/node-homey-oauth2app
- Homey Apps SDK: https://apps.developer.homey.app
- Flow Cards: https://apps.developer.homey.app/the-basics/app/flow-cards
