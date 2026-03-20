# KEBA KeContact Homey App — Reference Patterns Research

**Date:** 2026-03-20
**Status:** Complete
**Researcher:** Copilot subagent

---

## Research Topics

1. Solarman App Reference Patterns
2. Homey App Conventions from docs/
3. Solcast App Reference (alternative patterns)
4. Project Structure Conventions

---

## Topic 1: Solarman App Reference Patterns

### 1.1 `app.js` — Shared Resource Initialization

**File:** `solarman-app/app.js` (~55 lines)

The app entry point is minimal. It extends `Homey.App` and performs two tasks in `onInit()`:

1. **Logs initialization** — single `this.log()` call
2. **Registers flow cards** via `_registerFlowCards()`

**Flow card registration pattern:**

```javascript
_registerFlowCards() {
  // Triggers — get card references (triggers fired from device.js)
  this._solarProductionChangedTrigger = this.homey.flow.getDeviceTriggerCard('solar_production_changed');

  // Conditions — register run listeners inline
  this.homey.flow.getConditionCard('is_producing_solar')
    .registerRunListener(async (args) => {
      const power = args.device.getCapabilityValue('measure_power');
      return power !== null && power > 0;
    });

  // Actions — register run listeners that delegate to device methods
  this.homey.flow.getActionCard('write_register')
    .registerRunListener(async (args) => {
      const { device, register, value } = args;
      await device._api.connect();
      await device._api.writeHoldingRegister(register, value);
      device._scheduleQuickPoll();
    });
}
```

**Key pattern:** App-level flow card registration; triggers obtained as references (fired from `device.js`), conditions evaluated inline, actions delegate to device instance methods.

### 1.2 `drivers/inverter/device.js` — Polling with Jitter

**File:** `solarman-app/drivers/inverter/device.js` (~570 lines)

#### Constants

```javascript
const POLL_INTERVAL_NORMAL = 60 * 1000;    // 60s default, overridable via settings
const POLL_INTERVAL_QUICK = 15 * 1000;     // 15s after user change
const QUICK_POLL_COUNT = 3;                // Quick polls before returning to normal
const MIN_POLL_INTERVAL = 15 * 1000;       // Floor for user-configured interval
const POLL_INTERVAL_SLEEP = 5 * 60 * 1000; // 5min when device is sleeping/unreachable
```

#### `onInit()` Flow

1. Initialize trigger tracking state (`this._lastPower = undefined`, etc.)
2. Check for prior connection (from previous stored data) — sets `this._everConnected`
3. Load device definition (YAML inverter profile from `inverter_definitions/`)
4. Ensure capabilities match profile via `_ensureCapabilities()` (dynamic add)
5. Create API client instance via `_createApiClient()`
6. **Start polling with jitter:**

```javascript
const jitter = Math.random() * 30000; // 0-30s random
this.pollTimeout = this.homey.setTimeout(async () => {
  await this.poll();
  const interval = Math.max(
    (this.getSetting('poll_interval') || (POLL_INTERVAL_NORMAL / 1000)) * 1000,
    MIN_POLL_INTERVAL,
  );
  this.pollInterval = this.homey.setInterval(() => this.poll(), interval);
}, jitter);
```

#### `poll()` Flow

1. Connect to API (handle connection failure → sleep mode or unavailable)
2. Iterate over register ranges, parse each independently (per-range try/catch)
3. Map parsed values to capabilities via `CAPABILITY_MAP` constant
4. Handle enum values specially (validate against known map)
5. Set primary capabilities from sub-capabilities
6. Fire flow triggers for changed values
7. Mark device available on success

#### `_updateCapability()` Pattern

```javascript
_updateCapability(name, value) {
  if (this.hasCapability(name) && this.getCapabilityValue(name) !== value) {
    this.setCapabilityValue(name, value)
      .catch(err => this.error(`Failed to set ${name}:`, err));
  }
}
```

Only writes when value actually changes. Fire-and-forget with error logging.

#### Quick Poll Pattern

After user-initiated changes (settings, flow actions):

```javascript
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

#### `_restartPolling()` Pattern

Used to change polling interval dynamically (settings change or sleep mode):

```javascript
_restartPolling(overrideInterval) {
  // Clear existing timers
  if (this.pollTimeout) { this.homey.clearTimeout(this.pollTimeout); this.pollTimeout = null; }
  if (this.pollInterval) { this.homey.clearInterval(this.pollInterval); this.pollInterval = null; }
  // Set new interval
  const interval = overrideInterval || Math.max(
    (this.getSetting('poll_interval') || (POLL_INTERVAL_NORMAL / 1000)) * 1000,
    MIN_POLL_INTERVAL,
  );
  this.pollInterval = this.homey.setInterval(() => this.poll(), interval);
}
```

#### Sleep/Wake Pattern for Unreachable Devices

```javascript
_handleSleep() {
  if (!this._sleeping) {
    this._sleeping = true;
    // Zero instantaneous readings (power, current)
    for (const cap of SLEEP_ZERO_CAPABILITIES) {
      this._updateCapability(cap, 0);
    }
    // Set status to standby
    this._updateCapability('solarman_inverter_status', 'standby');
    // Slow down polling
    this._restartPolling(POLL_INTERVAL_SLEEP);
  }
  // Keep device available — user sees last known cumulative values
}
```

#### `onSettings()` Pattern

```javascript
async onSettings({ oldSettings, newSettings, changedKeys }) {
  // Check which categories of settings changed
  const connectionKeys = ['inverter_host', 'inverter_port', ...];
  const needsReconnect = changedKeys.some(k => connectionKeys.includes(k));
  // React to specific changes
  if (changedKeys.includes('lookup_file')) { /* reload definition */ }
  if (needsReconnect) { /* disconnect + recreate client */ }
  if (changedKeys.includes('poll_interval')) { /* restart polling */ }
  // Quick poll to verify new settings
  this._scheduleQuickPoll();
}
```

#### `onUninit()` Cleanup

```javascript
async onUninit() {
  if (this.pollTimeout) { this.homey.clearTimeout(this.pollTimeout); this.pollTimeout = null; }
  if (this.pollInterval) { this.homey.clearInterval(this.pollInterval); this.pollInterval = null; }
  if (this.quickPollTimer) { this.homey.clearInterval(this.quickPollTimer); this.quickPollTimer = null; }
  if (this._api) { await this._api.disconnect().catch(() => {}); }
}
```

#### Dynamic Capabilities Pattern

```javascript
async _ensureCapabilities() {
  const neededCaps = new Set();
  // Determine needed caps from loaded definition
  for (const group of this._definition.parameters) {
    for (const item of group.items) {
      const cap = CAPABILITY_MAP[item.name];
      if (cap) neededCaps.add(cap);
    }
  }
  // Add missing capabilities dynamically
  for (const cap of neededCaps) {
    if (!this.hasCapability(cap)) {
      await this.addCapability(cap).catch(err => this.error(`Failed to add ${cap}:`, err));
    }
  }
}
```

### 1.3 `drivers/inverter/driver.js` — Pairing with `login_credentials`

**File:** `solarman-app/drivers/inverter/driver.js` (~140 lines)

#### Pairing Flow

Uses `login_credentials` template, which emits a `login` event with `username` and `password` fields.

The driver remaps these fields to meaningful values:

```javascript
session.setHandler('login', async (data) => {
  const host = (data.username || data.host || '').trim();
  const serialRaw = (data.password || data.serial || '').toString().trim();
  const serial = Number.parseInt(serialRaw, 10);
  // Validate
  if (!host) throw new Error('Host is required');
  if (!Number.isFinite(serial)) throw new Error('Serial must be a valid number');
  // Store pair data
  pairData = { host, serial, port: 8899, slaveid: 1, lookup: 'sofar_lsw3.yaml' };
  // Test connection
  const api = new SolarmanApi({ ...pairData, timeout: 10000 });
  await api.connect();
  // Probe registers to verify
  // ... (multiple probes with fallback)
  return true;
});
```

#### `list_devices` Handler

Returns device objects with:

```javascript
return [{
  name: `Solarman Inverter (${pairData.host})`,
  data: { id: `solarman_${pairData.serial}` },     // Immutable identifier
  store: { host, port, serial, slaveid, lookup },   // Mutable cached state
  settings: { inverter_host, inverter_port, ... },  // User-configurable via UI
}];
```

**Key pattern:** `data` contains only the immutable device ID; `store` contains connection parameters that can be refreshed; `settings` mirrors store but is user-editable via Homey UI.

### 1.4 `lib/` — API Client Structure

Three files:

| File | Purpose | Lines |
|------|---------|-------|
| `SolarmanApi.js` | TCP/Modbus protocol client (V5 framing, request serialization, connect/disconnect) | ~350 |
| `ParameterParser.js` | Parses raw Modbus register arrays into named values using YAML definitions | ~250 |
| `InverterScanner.js` | UDP broadcast discovery of Solarman data loggers | ~100 |

**SolarmanApi pattern:**

- Constructor takes `{ host, port, serial, mbSlaveId, timeout, autoReconnect, logger }` — logger is injected
- Logger injected as `{ log: (...args) => this.log('[API]', ...args), error: ... }` from device.js
- Connect/disconnect lifecycle with auto-reconnect
- Promise-based mutex for request serialization
- All methods are async, throw on errors
- No Homey dependencies — pure Node.js (net, dgram)

### 1.5 `driver.compose.json` — Capabilities, Settings, Energy, Pairing

**Structure:**

```json
{
  "name": { "en": "Solarman Inverter" },
  "class": "solarpanel",
  "capabilities": [ "measure_power", "meter_power", "measure_temperature", "solarman_inverter_status", ... ],
  "capabilitiesOptions": {
    "measure_power": { "title": { "en": "Output Power" }, "decimals": 0 },
    "measure_power.pv1": { "title": { "en": "PV1 Power" }, "decimals": 0, "uiComponent": null },
    ...
  },
  "energy": {
    "cumulative": true,
    "cumulativeImportedCapability": "meter_power"
  },
  "pair": [
    { "id": "configure", "template": "login_credentials", "options": { ... } },
    { "id": "list_devices", "template": "list_devices" },
    { "id": "add_devices", "template": "add_devices" }
  ],
  "settings": [
    { "id": "inverter_host", "type": "text", ... },
    { "id": "inverter_port", "type": "number", "value": 8899, ... },
    { "id": "lookup_file", "type": "dropdown", "values": [...] },
    { "id": "poll_interval", "type": "number", "value": 60, ... }
  ]
}
```

**Key patterns:**

- `"class": "solarpanel"` — device class determines icon and Energy panel integration
- `"energy": { "cumulative": true, "cumulativeImportedCapability": "meter_power" }` — registers device with Homey Energy
- Sub-capabilities with `"uiComponent": null` are hidden from the main device card but accessible in detailed view
- Settings include host, port, serial, model dropdown, and poll interval
- Pairing uses `login_credentials` template with customized labels

### 1.6 `cli/` — Test Tool Patterns

**Files:**

| File | Purpose | Dependencies |
|------|---------|-------------|
| `discover.js` | UDP broadcast discovery | `InverterScanner` from lib |
| `read-inverter.js` | One-shot register read + parse | `SolarmanApi`, `ParameterParser`, `commander`, `js-yaml` |
| `monitor.js` | Continuous polling with live updates | Same + change detection |
| `write-register.js` | Write single register with verify | `SolarmanApi`, `commander` |

**Common patterns:**

- Use `commander` library for CLI argument parsing
- Load `.env` or use command-line args for credentials
- Import shared `lib/` modules (same code as the Homey app uses)
- Handle graceful shutdown (SIGINT)
- Format output for human readability
- `--save` flag to capture raw data to `test_data/` as JSON

**Package.json scripts:**

```json
"scripts": {
  "discover": "node cli/discover.js",
  "read": "node cli/read-inverter.js",
  "write": "node cli/write-register.js",
  "monitor": "node cli/monitor.js"
}
```

**Dependencies in package.json:**

```json
"dependencies": {
  "js-yaml": "^4.1.0",
  "commander": "^11.0.0"
}
```

Note: `homey` is NOT listed as a dependency — runtime provides it.

---

## Topic 2: Homey App Conventions from docs/

### 2.1 HA-to-Homey Migration Patterns (doc 14)

**Source:** `docs/14-ha-app-to-homey-migration.md`

#### Communication Pattern Mapping

| HA Pattern | Homey Equivalent |
|-----------|------------------|
| Local LAN polling (TCP/UDP) | Node.js `net`/`dgram` |
| Cloud REST API (`aiohttp`) | `fetch()` with `AbortController` |
| OAuth2 cloud | `homey-oauth2app` library |
| WebSocket | Node.js `ws` |

#### Entity-to-Capability Translation Rules

1. Instantaneous measurements → `measure_<unit>` (e.g., `measure_power` in W)
2. Cumulative values → `meter_<unit>` (e.g., `meter_power` in kWh)
3. Boolean alerts → `alarm_<type>`
4. On/off control → `onoff`
5. Multi-channel → Sub-capability suffix: `measure_power.channel1`
6. Enum values → Custom capability with `type: "enum"` and `values` array
7. String values → Custom capability with `type: "string"`

#### Recommended Build Order

1. Protocol/API client (`lib/`)
2. CLI test tools (`cli/`)
3. Data parser/mapper (`lib/`)
4. Driver + pairing (`driver.js`, `driver.compose.json`)
5. Device + polling (`device.js`)
6. Flow cards (`.homeycompose/flow/` + `app.js`)
7. Live testing (`homey app run --remote`)

#### Config Flow → Pairing Template Mapping

| HA config_flow.py pattern | Homey pairing template |
|--------------------------|----------------------|
| Text inputs (host, port, API key) | `login_credentials` |
| Dropdown/select | `list_devices` |
| Auto-discovery | `list_devices` with pre-populated list |
| OAuth2 login | `login_oauth2` |

#### Critical: `login_credentials` Pitfall

The `login_credentials` template emits `username` and `password` fields, NOT custom field names. Map them in the `login` handler:

```javascript
session.setHandler('login', async (data) => {
  const host = data.username;   // Mapped from "username" field
  const serial = data.password; // Mapped from "password" field
});
```

### 2.2 Device Class for EV Charger

**Source:** `docs/05-drivers-devices-capabilities.md`

While not explicitly listing `evcharger`, the docs establish:

- **Device class** determines icon and Energy panel behavior
- Standard Homey device classes include: `socket`, `light`, `thermostat`, `solarpanel`, etc.
- For EV chargers, use `"class": "evcharger"` (Homey SDK built-in class — not documented in our docs but exists in Homey SDK)

### 2.3 Energy Integration Patterns

**From driver.compose.json examples:**

```json
"energy": {
  "cumulative": true,
  "cumulativeImportedCapability": "meter_power"
}
```

- `cumulative: true` tells Homey this device tracks cumulative energy
- `cumulativeImportedCapability` points to the `meter_power` capability (kWh consumed)
- For devices that both consume and produce: use `cumulativeImportedCapability` AND `cumulativeExportedCapability`

**Power/Energy capability distinction (from docs):**

| Capability | Unit | Type |
|-----------|------|------|
| `measure_power` | W | Instantaneous |
| `meter_power` | kWh | Cumulative |

### 2.4 Dynamic Capability Patterns

From docs, confirmed by solarman-app implementation:

```javascript
// Add capabilities dynamically based on device model
for (const cap of requiredCapabilities) {
  if (!this.hasCapability(cap)) {
    await this.addCapability(cap).catch(err => this.error(`Failed to add ${cap}:`, err));
  }
}
// Remove deprecated capabilities
if (this.hasCapability('old_deprecated_capability')) {
  await this.removeCapability('old_deprecated_capability');
}
```

---

## Topic 3: Solcast App Reference (Alternative Patterns)

### 3.1 Differences from Solarman

| Aspect | Solarman | Solcast |
|--------|---------|---------|
| Protocol | Local TCP (Modbus over Solarman V5) | Cloud REST API (HTTPS) |
| Polling | Timer-based interval (default 60s) | Scheduled daily fetch + hourly cache refresh |
| Authentication | None (host + serial) | API key (stored as setting) |
| Data caching | None (live reads) | Store forecast cache in device store |
| Quota management | N/A | Tracks API usage, quota limits |
| Error recovery | Sleep/wake for night pattern | setUnavailable on API errors |

### 3.2 Solcast API Client Pattern (`lib/SolcastApi.js`)

- Uses `fetch()` with `AbortController` timeout (NOT `setTimeout` parameter)
- Retry with exponential backoff on 429 (quota exceeded)
- Custom error classes: `QuotaExceededError`, `AuthenticationError`
- API key passed as query parameter
- Tracks daily usage against configurable quota limit
- Sequential site fetching to respect rate limits

### 3.3 Solcast Polling Pattern

Instead of regular interval polling, uses:

1. **Daily scheduled fetch** at configurable hour (default 03:00 local)
2. **Hourly cache refresh** — recomputes capabilities from stored forecast data
3. **Midnight quota reset** — resets API usage counter at UTC midnight
4. **Manual trigger** via flow action card

```javascript
// Schedule daily fetch at specific local time
_scheduleDailyFetch() {
  const fetchHour = this.getSetting('fetch_hour');
  const msUntilFetch = this._msUntilLocalHour(fetchHour);
  this._dailyFetchTimer = this.homey.setTimeout(async () => {
    await this.updateForecast();
    this._scheduleDailyFetch(); // Re-schedule for next day
  }, msUntilFetch);
}
```

### 3.4 Solcast CLI Monitor Pattern

Simpler than solarman — reads `.env` for API key, polls at configurable interval, refreshes display from cached data between polls.

### 3.5 Solcast Driver Pairing

Same `login_credentials` template pattern but maps:
- `username` → API key
- `password` → daily quota limit

Validates by calling `api.getSites()` during pairing.

---

## Topic 4: Project Structure Conventions

### 4.1 `.homeycompose/` Directory Structure

**From `docs/02-project-structure-homey-compose.md`:**

```
.homeycompose/
  app.json                          # App manifest source (id, version, permissions)
  capabilities/                     # Custom capability JSON definitions
    <app_prefix>_<name>.json        # e.g., solarman_inverter_status.json
  flow/
    triggers/                       # Trigger card definitions
      <trigger_id>.json
    conditions/                     # Condition card definitions
      <condition_id>.json
    actions/                        # Action card definitions
      <action_id>.json
```

### 4.2 Custom Capability File Naming

Convention: `<app_prefix>_<capability_name>.json`

Example files from solarman:
- `solarman_inverter_status.json` — enum capability
- `solarman_grid_frequency.json` — number capability
- `solarman_battery_status.json` — enum capability
- `solarman_work_mode.json` — enum capability
- `solarman_fault_1.json` through `solarman_fault_5.json` — string/enum capabilities

**Number capability template:**

```json
{
  "type": "number",
  "title": { "en": "Grid Frequency" },
  "units": { "en": "Hz" },
  "getable": true,
  "setable": false,
  "uiComponent": "sensor",
  "decimals": 2,
  "icon": "/assets/capabilities/frequency.svg"
}
```

**Enum capability template:**

```json
{
  "type": "enum",
  "title": { "en": "Inverter Status" },
  "getable": true,
  "setable": false,
  "uiComponent": "sensor",
  "icon": "/assets/capabilities/status.svg",
  "values": [
    { "id": "standby", "title": { "en": "Stand-by" } },
    { "id": "normal", "title": { "en": "Normal" } }
  ]
}
```

### 4.3 Flow Card File Conventions

**Trigger card:**

```json
{
  "id": "solar_production_changed",
  "title": { "en": "Solar production changed" },
  "hint": { "en": "Triggers when solar power output changes" },
  "tokens": [
    { "name": "power", "type": "number", "title": { "en": "Power (W)" }, "example": 1500 }
  ],
  "args": [
    { "type": "device", "name": "device", "filter": "driver_id=inverter" }
  ]
}
```

**Condition card:**

```json
{
  "id": "is_producing_solar",
  "title": { "en": "Solar is producing power" },
  "args": [
    { "type": "device", "name": "device", "filter": "driver_id=inverter" }
  ]
}
```

**Action card (with parameters):**

```json
{
  "id": "write_register",
  "title": { "en": "Write Modbus register" },
  "args": [
    { "type": "device", "name": "device", "filter": "driver_id=inverter" },
    { "type": "number", "name": "register", "title": { "en": "Register Address" }, "min": 0, "max": 65535 },
    { "type": "number", "name": "value", "title": { "en": "Value" }, "min": 0, "max": 65535 }
  ]
}
```

### 4.4 `.homeycompose/app.json` Template

```json
{
  "id": "com.solarman.inverter",
  "version": "1.0.0",
  "compatibility": ">=5.0.0",
  "sdk": 3,
  "platforms": ["local"],
  "name": { "en": "Solarman" },
  "description": { "en": "Monitor solar inverters via Solarman WiFi data loggers" },
  "category": ["energy"],
  "brandColor": "#FF6600",
  "permissions": [],
  "images": {
    "small": "/assets/images/small.png",
    "large": "/assets/images/large.png",
    "xlarge": "/assets/images/xlarge.png"
  },
  "author": { "name": "..." }
}
```

### 4.5 `package.json` Conventions

- **No `homey` dependency** — runtime provides it
- CLI tools get their own dependencies (`commander`, etc.)
- Scripts section maps to cli tools for development convenience
- Main entry: `"main": "app.js"`

### 4.6 Driver Compose vs `.homeycompose/` Placement

- `driver.compose.json` lives **inside** `drivers/<driver_id>/` — NOT in `.homeycompose/drivers/`
- `.homeycompose/capabilities/` contains custom capability definitions
- `.homeycompose/flow/` contains flow card definitions
- `.homeycompose/app.json` is the app manifest source-of-truth

---

## Key Discoveries & Patterns Summary

### Pattern: Complete App Architecture

```
app.js                               # Flow card registration only
lib/
  <Protocol>Api.js                   # Protocol client (no Homey deps)
  <Data>Parser.js                    # Data transformation (no Homey deps)
  <Discovery>Scanner.js              # Device discovery (optional)
cli/
  discover.js                        # Network discovery tool
  read-<device>.js                   # One-shot read all data
  monitor.js                         # Continuous polling with live updates
  write-<register>.js                # Write operations (if applicable)
drivers/<driver_id>/
  driver.js                          # Pairing (login_credentials template)
  device.js                          # Polling, capability updates, error handling
  driver.compose.json                # Capabilities, settings, energy, pairing config
.homeycompose/
  app.json                           # App metadata
  capabilities/<prefix>_<name>.json  # Custom capabilities
  flow/triggers/<id>.json            # Trigger cards
  flow/conditions/<id>.json          # Condition cards
  flow/actions/<id>.json             # Action cards
```

### Pattern: Data Flow

```
Hardware → lib/Api.js → device.js poll() → CAPABILITY_MAP → _updateCapability() → Homey UI
                                         → _fireTriggers() → Flow cards
```

### Pattern: Timer Management

Three types of timers, all managed carefully:

1. **`pollTimeout`** — Initial jitter delay (clearTimeout)
2. **`pollInterval`** — Normal polling interval (clearInterval)
3. **`quickPollTimer`** — Temporary fast polling after changes (clearInterval)

All cleared in `onUninit()`.

### Pattern: Error Handling Strategy

```
Connection error (never connected)  → setUnavailable("message")
Connection error (previously ok)    → _handleSleep() → zero instantaneous, slow polling
Modbus error (register-level)       → Log and skip, continue to next range
Parse error                         → Log and continue
Successful poll                     → setAvailable() if was unavailable
```

### Pattern: KEBA-Relevant Capability Mapping for `evcharger`

For KEBA KeContact (EV charger), the analogous capabilities would be:

| KEBA Data Point | Homey Capability |
|----------------|------------------|
| Charging power (W) | `measure_power` |
| Total energy (kWh) | `meter_power` |
| Charging current (A) | `measure_current` |
| Voltage (V) | `measure_voltage` |
| Charging state | `keba_charging_state` (custom enum) |
| Max current setting | `keba_max_current` (custom number, setable) |
| Cable state | `keba_cable_state` (custom enum) |
| Error code | `keba_error` (custom enum) |
| Enable/disable | `onoff` (standard) |
| Session energy | `meter_power.session` (sub-capability) |

Energy config for EV charger:

```json
"energy": {
  "cumulative": true,
  "cumulativeImportedCapability": "meter_power"
}
```

---

## Source: KEBA KeContact HA Integration Structure

Located at `source/keba-kecontact/keba_kecontact/`:

| File | Purpose |
|------|---------|
| `__init__.py` | HA entry point |
| `const.py` | Constants |
| `connection.py` | UDP protocol client |
| `charging_station.py` | Device abstraction |
| `charging_station_info.py` | Info data model |
| `utils.py` | Utilities |
| `emulator.py` | Test emulator |
| `__main__.py` | CLI entry point |

**Communication:** Local UDP protocol (port 7090) — similar local LAN pattern to Solarman.

---

## Clarifying Questions

No clarifying questions — all research topics could be answered from workspace sources.

---

## Recommended Next Research

- [ ] **KEBA UDP Protocol Deep Dive** — Read `source/keba-kecontact/keba_kecontact/connection.py` and `charging_station.py` in detail to understand the exact UDP message format, commands, and response parsing.
- [ ] **KEBA Data Points Inventory** — Read `const.py` and `charging_station_info.py` to catalog all available data points and their types/units.
- [ ] **KEBA Emulator Patterns** — Read `emulator.py` to understand how the test emulator works and replicate for Homey CLI tools.
- [ ] **Homey `evcharger` Device Class** — Research exact Homey SDK capabilities available for `evcharger` class (built-in capabilities like `measure_power`, any charger-specific ones).
- [ ] **Existing Homey KEBA Apps** — Search the Homey App Store for any existing KEBA KeContact implementations.
- [ ] **KEBA KeContact UDP Specification** — Verify protocol documentation for all supported commands (report 1/2/3, enable/disable, setcurrent, etc.).
