<!-- markdownlint-disable-file -->
# Implementation Details: KEBA KeContact Homey App

## Context Reference

Sources:
* `.copilot-tracking/research/2026-03-20/keba-kecontact-homey-app-research.md` — Protocol spec, data points, capability mapping
* `.copilot-tracking/research/subagents/2026-03-20/keba-reference-patterns-research.md` — Solarman/Solcast patterns
* `source/keba-kecontact/keba_kecontact/` — Python source library (v4.3.0)

## Implementation Phase 1: Protocol Client Library (`lib/`)

<!-- parallelizable: false -->

### Step 1.1: Create `lib/KebaUdpClient.js` — Singleton UDP socket manager

Port `connection.py` (`KebaKeContact` class) to Node.js using the `dgram` module.

**Architecture:**
* Singleton class owned by `app.js`, shared across all device instances
* Binds to UDP port 7090 with `SO_BROADCAST` enabled
* Routes incoming datagrams to registered device callbacks by source IP address
* Enforces 100ms minimum between sends (per Python source `connection.py` line 72)
* Send queue with promise-based serialization (matches Python `asyncio.Lock` pattern)

**Key methods:**
* `async init()` — Create UDP4 socket, bind to port 7090, enable broadcast, start listening
* `async send(host, command)` — Encode command, queue send with 100ms spacing, return promise
* `registerDevice(host, callback)` — Register a device callback for datagrams from `host`
* `unregisterDevice(host)` — Remove device callback
* `async discover(broadcastAddr, timeout)` — Send "i" broadcast, collect responses for `timeout` ms, return array of parsed responses
* `async close()` — Close socket, clear all callbacks

**Data flow:**
1. Socket receives datagram → extract source IP from `rinfo.address`
2. Look up registered callback for that IP → if found, call `callback(message, rinfo)`
3. If no callback registered (e.g., discovery response), check pending discovery promise

**Error handling:**
* Socket error event → log error, attempt rebind after 5s delay
* Send failure → reject promise, caller handles retry

**Reference files:**
* `source/keba-kecontact/keba_kecontact/connection.py` — Lines 1-120 for socket lifecycle, send, and routing
* `solarman-app/lib/SolarmanApi.js` — Lines 1-50 for constructor/logger injection pattern

Files:
* `keba-app/lib/KebaUdpClient.js` — New file (~150 lines)

Discrepancy references:
* DR-02: cp437 encoding — use UTF-8 for ASCII commands, validate in Phase 2 CLI testing

Success criteria:
* UDP socket binds to port 7090 without error
* `send()` delivers commands and respects 100ms minimum spacing
* `discover()` receives broadcast responses
* Multiple device callbacks can be registered and receive routed datagrams

Context references:
* `source/keba-kecontact/keba_kecontact/connection.py` (Lines 20-55) — Socket init and bind
* `source/keba-kecontact/keba_kecontact/connection.py` (Lines 55-80) — Send with lock and 100ms delay
* `source/keba-kecontact/keba_kecontact/connection.py` (Lines 80-120) — Callback routing by host IP

Dependencies:
* Node.js `dgram` module (built-in)

### Step 1.2: Create `lib/KebaDataParser.js` — Report parsing and data scaling

Port data transformation logic from `charging_station.py` `datagram_received()` method.

**Functions to implement:**

`parseReport2(data)` — Parse Report 2 JSON:
* `State` → `decodeChargingState(raw)` → `{ stateOn: boolean, stateDetail: string }`
* `Plug` → `decodePlugState(raw)` → `{ plugCS, plugLocked, plugEV }`
* `Enable sys` → system enable state
* `Max curr` → raw / 1000 → Amperes
* `Curr HW` → raw / 1000 → Amperes
* `Curr user` → raw / 1000 → Amperes
* `Curr FS` → raw / 1000 → Amperes
* `Tmo FS` → raw > 0 → failsafe active

`parseReport3(data)` — Parse Report 3 JSON (meter data):
* `U1`, `U2`, `U3` → Volts (no scaling)
* `I1`, `I2`, `I3` → raw / 1000 → Amperes
* `P` → raw / 1000000 → kW, then × 1000 → W (for `measure_power`)
* `PF` → raw / 1000 → ratio (0–1)
* `E pres` → raw / 10000 → kWh (precision 2)
* `E total` → raw / 10000 → kWh (precision 2)

`decodePlugState(raw)` — Decode plug integer to state:
* 0 → `no_cable`
* 1 → `cable_cs`
* 3 → `cable_locked`
* 5 → `cable_ev`
* 7 → `cable_locked_ev`

`decodeChargingState(raw)` — Decode state integer:
* 0 → `{ stateOn: false, stateDetail: 'starting' }`
* 1 → `{ stateOn: false, stateDetail: 'not_ready' }`
* 2 → `{ stateOn: false, stateDetail: 'ready' }`
* 3 → `{ stateOn: true, stateDetail: 'charging' }`
* 4 → `{ stateOn: false, stateDetail: 'error' }`
* 5 → `{ stateOn: false, stateDetail: 'auth_rejected' }`

`getResponseType(message)` — Determine response type from raw UDP message:
* Starts with `"TCH-OK"` → `'tch-ok'`
* Starts with `"TCH-ERR"` → `'tch-err'`
* JSON with `ID` field → report type based on content (1, 2, 3, or 100+)
* Non-JSON string → `'basic_info'` (firmware info from discovery)

`validateCurrent(amperes)` — Validate current value: 0 or 6–63 A range

Files:
* `keba-app/lib/KebaDataParser.js` — New file (~200 lines)

Success criteria:
* All scaling factors match Python source `charging_station.py` `datagram_received()`
* Plug state 0/1/3/5/7 decoded correctly
* Charging state 0–5 decoded correctly
* Power conversion: raw → kW → W matches expected values
* Energy conversion: raw → kWh matches expected values

Context references:
* `source/keba-kecontact/keba_kecontact/charging_station.py` (Lines 85-175) — Data transformation in datagram_received
* `source/keba-kecontact/keba_kecontact/utils.py` (Lines 1-50) — Response type detection, validation functions
* `.copilot-tracking/research/2026-03-20/keba-kecontact-homey-app-research.md` (Lines 145-190) — Data Point Inventory table

Dependencies:
* Step 1.1 not required — this module is pure data transformation

### Step 1.3: Create `lib/KebaDeviceInfo.js` — Product string parsing and feature detection

Port `charging_station_info.py` to Node.js.

**Main function:** `parseProductInfo(report1)`

Input: Report 1 JSON object with `Product`, `Serial`, `Firmware` fields.

Product string format: `PREFIX-MODEL-VERSION_FEATURES` (e.g., "KC-P30-ES230001-00R")

**Parsing logic:**
1. Split product string by `-`
2. Determine manufacturer:
   * `KC` prefix → KEBA
   * `BMW` prefix → BMW
3. Determine model:
   * Contains `P20` → P20
   * Contains `P30` → P30
   * BMW prefix → Wallbox Connect or Wallbox Plus based on features
4. Detect features from product string components:
   * `meterIntegrated`: P30 always (except DE variant), P20 depends on version digit, BMW always
   * `displayAvailable`: P30 only (not DE variant)
   * `authAvailable`: P30, P20 R-variant, BMW
   * `dataLogger`: P30, BMW
   * `phaseSwitch`: All except BMW

**Return object:**
```javascript
{
  manufacturer: 'KEBA' | 'BMW',
  model: 'P20' | 'P30' | 'Wallbox Connect' | 'Wallbox Plus',
  serial: string,
  firmware: string,
  meterIntegrated: boolean,
  displayAvailable: boolean,
  authAvailable: boolean,
  dataLogger: boolean,
  phaseSwitch: boolean
}
```

Files:
* `keba-app/lib/KebaDeviceInfo.js` — New file (~80 lines)

Success criteria:
* Product string "KC-P30-ES230001-00R" → KEBA P30, all features true
* Product string "KC-P20-ES2000e1-00R" → KEBA P20 e-series, meter false, auth true (R-variant)
* Product string "BMW-10-ES230001-000" → BMW, meter true, display false, phaseSwitch false

Context references:
* `source/keba-kecontact/keba_kecontact/charging_station_info.py` (Lines 1-80) — Full parsing logic
* `.copilot-tracking/research/2026-03-20/keba-kecontact-homey-app-research.md` (Lines 195-210) — Device Model Variations table

Dependencies:
* No dependencies on other steps

## Implementation Phase 2: CLI Test Tools (`cli/`)

<!-- parallelizable: false -->

### Step 2.1: Create `cli/discover.js` — UDP broadcast discovery tool

Send UDP broadcast "i" command, collect and display responding chargers.

**Implementation:**
* Use `commander` for CLI args: `--broadcast` (default `255.255.255.255`), `--timeout` (default 3000ms)
* Import `KebaUdpClient` from `../lib/KebaUdpClient.js`
* Call `client.discover(broadcastAddr, timeout)`
* Display each response: IP, firmware info string
* Graceful shutdown on SIGINT

**Output format:**
```
Discovering KEBA chargers on 255.255.255.255...
Found 2 charger(s):
  10.1.1.13    — KC-P30-ES230001-00R (Serial: 22269889)
  192.168.42.1 — KC-P20-ES200010-000 (Serial: 32510794)
```

Files:
* `keba-app/cli/discover.js` — New file (~60 lines)

Success criteria:
* Discovers KEBA chargers on broadcastable network segments
* Handles zero-response timeout gracefully

Context references:
* `solarman-app/cli/discover.js` — Reference CLI discovery pattern
* `source/keba-kecontact/keba_kecontact/connection.py` (Lines 95-110) — discover_devices method

Dependencies:
* Step 1.1 (`KebaUdpClient`)

### Step 2.2: Create `cli/read-status.js` — One-shot report reader

Send `report 1`, `report 2`, `report 3` to a specific charger IP and display parsed values.

**Implementation:**
* Use `commander` for CLI args: `--host` (required), `--save` (optional, save raw JSON to `test_data/`)
* Import `KebaUdpClient`, `KebaDataParser`, `KebaDeviceInfo`
* Send each report command, wait for response with timeout (5s)
* Display parsed values in structured format
* Optionally save raw responses to `test_data/` directory

**Output format:**
```
KEBA Charger at 10.1.1.13
Model: KEBA P30 (KC-P30-ES230001-00R)
Serial: 22269889
Features: meter=yes display=yes auth=yes dataLogger=yes phaseSwitch=yes

Status (Report 2):
  State: ready (not charging)
  Plug: cable_locked_ev (cable locked, EV connected)
  Max current: 32.0 A
  User current: 16.0 A

Metering (Report 3):
  Power: 0.000 kW (0 W)
  Energy (session): 12.34 kWh
  Energy (total): 1234.56 kWh
  Phase 1: 230 V / 0.000 A
  Phase 2: 231 V / 0.000 A
  Phase 3: 229 V / 0.000 A
```

Files:
* `keba-app/cli/read-status.js` — New file (~120 lines)

Success criteria:
* Reports 1/2/3 fetched and parsed for metered charger
* Reports 1/2 only for non-metered charger (report 3 timeout handled gracefully)
* Raw data saved to `test_data/` with `--save` flag

Context references:
* `solarman-app/cli/read-inverter.js` — Reference CLI read pattern

Dependencies:
* Steps 1.1, 1.2, 1.3

### Step 2.3: Create `cli/monitor.js` — Continuous polling monitor

Continuously poll a charger and display live updates.

**Implementation:**
* Use `commander` for CLI args: `--host`, `--interval` (default 30s)
* Import all `lib/` modules
* Poll at configured interval, display changed values only
* Track previous values for change detection
* Graceful shutdown on SIGINT (close UDP socket)

Files:
* `keba-app/cli/monitor.js` — New file (~100 lines)

Success criteria:
* Continuously polls and displays only changed values
* Clean shutdown on SIGINT

Context references:
* `solarman-app/cli/monitor.js` — Reference CLI monitor pattern

Dependencies:
* Steps 1.1, 1.2, 1.3

### Step 2.4: Validate Phase 2 — Test CLI tools against real KEBA charger

Run CLI tools against known test chargers:
* Airaksela: `10.1.1.13:7090` (serial 22269889)
* Riitekatu: `192.168.42.1:7090` (serial 32510794)

Test commands:
```bash
node cli/discover.js
node cli/read-status.js --host 10.1.1.13 --save
node cli/monitor.js --host 10.1.1.13 --interval 5
```

Verify:
* Discovery finds charger(s)
* Reports parse correctly — values match what Python CLI shows
* Power values scale correctly (match physical charger display)
* Saved test data usable for future offline testing

## Implementation Phase 3: App Scaffold and Compose Files

<!-- parallelizable: true -->

### Step 3.1: Create project scaffold

Create `keba-app/` directory with:

**`package.json`:**
```json
{
  "name": "fi.leskinen.keba-kecontact",
  "version": "1.0.0",
  "main": "app.js",
  "scripts": {
    "discover": "node cli/discover.js",
    "read": "node cli/read-status.js",
    "monitor": "node cli/monitor.js"
  },
  "dependencies": {
    "commander": "^11.0.0"
  }
}
```

Note: `homey` is NOT a dependency — Homey runtime provides it.

**`.homeycompose/app.json`:**
```json
{
  "id": "fi.leskinen.keba-kecontact",
  "version": "1.0.0",
  "compatibility": ">=5.0.0",
  "sdk": 3,
  "platforms": ["local"],
  "name": { "en": "KEBA KeContact" },
  "description": { "en": "Control and monitor KEBA KeContact EV chargers (P20, P30, BMW Wallbox)" },
  "brandColor": "#00A651",
  "category": ["energy"],
  "permissions": [],
  "images": {
    "small": "/assets/images/small.png",
    "large": "/assets/images/large.png",
    "xlarge": "/assets/images/xlarge.png"
  },
  "author": {
    "name": "Joni Leskinen"
  }
}
```

**`app.js`:**
Extends `Homey.App`. In `onInit()`:
1. Create `KebaUdpClient` singleton instance
2. Call `await this.udpClient.init()`
3. Register flow cards via `_registerFlowCards()`

In `onUninit()`:
1. Close UDP client: `await this.udpClient.close()`

Store UDP client reference as `this.udpClient` for device access via `this.homey.app.udpClient`.

**`assets/icon.svg`:**
Simple KEBA-branded EV charger icon, 960×960, transparent background.

Files:
* `keba-app/package.json` — New file
* `keba-app/.homeycompose/app.json` — New file
* `keba-app/app.js` — New file (~60 lines)
* `keba-app/assets/icon.svg` — New file
* `keba-app/.gitignore` — Include `.homeybuild/`, `node_modules/`

Success criteria:
* `npm install` succeeds
* App structure matches Homey compose conventions

Context references:
* `solarman-app/package.json` — Reference package structure
* `solarman-app/app.js` — Reference app.js pattern (Lines 1-55)
* `docs/02-project-structure-homey-compose.md` — Project structure conventions

Dependencies:
* Phase 1 lib files must exist (referenced by app.js)

### Step 3.2: Create custom capabilities in `.homeycompose/capabilities/`

Define custom capabilities for KEBA-specific data points that don't map to standard Homey capabilities.

**Files to create:**

`keba_charging_state.json`:
```json
{
  "type": "enum",
  "title": { "en": "Charging State" },
  "getable": true,
  "setable": false,
  "uiComponent": "sensor",
  "values": [
    { "id": "starting", "title": { "en": "Starting" } },
    { "id": "not_ready", "title": { "en": "Not Ready" } },
    { "id": "ready", "title": { "en": "Ready" } },
    { "id": "charging", "title": { "en": "Charging" } },
    { "id": "error", "title": { "en": "Error" } },
    { "id": "auth_rejected", "title": { "en": "Authorization Rejected" } }
  ]
}
```

`keba_cable_state.json`:
```json
{
  "type": "enum",
  "title": { "en": "Cable State" },
  "getable": true,
  "setable": false,
  "uiComponent": "sensor",
  "values": [
    { "id": "no_cable", "title": { "en": "No Cable" } },
    { "id": "cable_cs", "title": { "en": "Cable at Station" } },
    { "id": "cable_locked", "title": { "en": "Cable Locked" } },
    { "id": "cable_ev", "title": { "en": "Cable + EV Connected" } },
    { "id": "cable_locked_ev", "title": { "en": "Cable Locked + EV" } }
  ]
}
```

`keba_current_limit.json`:
```json
{
  "type": "number",
  "title": { "en": "Current Limit" },
  "units": { "en": "A" },
  "getable": true,
  "setable": true,
  "uiComponent": "slider",
  "min": 6,
  "max": 63,
  "step": 1,
  "decimals": 0
}
```

`keba_max_current.json`:
```json
{
  "type": "number",
  "title": { "en": "Max Current" },
  "units": { "en": "A" },
  "getable": true,
  "setable": false,
  "uiComponent": "sensor",
  "decimals": 0
}
```

`keba_power_factor.json`:
```json
{
  "type": "number",
  "title": { "en": "Power Factor" },
  "getable": true,
  "setable": false,
  "uiComponent": "sensor",
  "decimals": 2,
  "min": 0,
  "max": 1
}
```

Files:
* `keba-app/.homeycompose/capabilities/keba_charging_state.json`
* `keba-app/.homeycompose/capabilities/keba_cable_state.json`
* `keba-app/.homeycompose/capabilities/keba_current_limit.json`
* `keba-app/.homeycompose/capabilities/keba_max_current.json`
* `keba-app/.homeycompose/capabilities/keba_power_factor.json`

Success criteria:
* All custom capabilities have valid JSON structure
* Enum values match `KebaDataParser.js` output values exactly
* Slider range for current limit matches KEBA spec (6–63 A)

Context references:
* `.copilot-tracking/research/2026-03-20/keba-kecontact-homey-app-research.md` (Lines 215-245) — Capability mapping table
* `.copilot-tracking/research/subagents/2026-03-20/keba-reference-patterns-research.md` (Lines 370-410) — Capability file naming conventions

Dependencies:
* None

### Step 3.3: Create `drivers/keba/driver.compose.json`

Driver manifest defining capabilities, energy integration, pairing, and settings.

**Key sections:**

Device class: `"evcharger"` — critical for Homey Energy integration.

Base capabilities (always present):
* `onoff` — Enable/disable charging
* `keba_charging_state` — Enum: starting, not_ready, ready, charging, error, auth_rejected
* `keba_cable_state` — Enum: no_cable, cable_cs, cable_locked, cable_ev, cable_locked_ev

Dynamic capabilities (added per model features in device.js):
* `measure_power` — Instantaneous power in W (if meter integrated)
* `meter_power` — Cumulative energy in kWh (if meter integrated)
* `meter_power.session` — Session energy in kWh (if meter integrated)
* `measure_current.phase1/2/3` — Phase currents in A (if meter integrated)
* `measure_voltage.phase1/2/3` — Phase voltages in V (if meter integrated)
* `keba_current_limit` — User-settable current limit in A
* `keba_max_current` — System max current in A
* `keba_power_factor` — Power factor 0–1 (if meter integrated)

Energy config:
```json
"energy": {
  "cumulative": true,
  "cumulativeImportedCapability": "meter_power"
}
```

Pairing: `login_credentials` template with IP address as "username" and optional serial as "password".

Settings:
* `host` — text, charger IP address
* `poll_interval` — number, default 30, min 10, max 300

Files:
* `keba-app/drivers/keba/driver.compose.json` — New file

Discrepancy references:
* DD-01: Poll interval minimum set to 10s (research recommends 30s default, which is preserved)
* DR-05: evcharger class expectations not fully verified; using standard capabilities

Success criteria:
* `homey app validate` accepts the driver compose file
* Energy integration object present and correct
* Pairing template renders with correct labels

Context references:
* `.copilot-tracking/research/2026-03-20/keba-kecontact-homey-app-research.md` (Lines 585-678) — Complete driver.compose.json design
* `.copilot-tracking/research/subagents/2026-03-20/keba-reference-patterns-research.md` (Lines 280-310) — Solarman driver.compose.json patterns

Dependencies:
* Step 3.2 (custom capability definitions must exist)

## Implementation Phase 4: Driver and Device

<!-- parallelizable: false -->

### Step 4.1: Create `drivers/keba/driver.js` — Pairing flow

**Pairing flow implementation:**

1. `session.setHandler('login', async (data) => { ... })`:
   * Extract host from `data.username`, optional serial from `data.password`
   * Validate IP format (basic regex or net module)
   * Get UDP client from `this.homey.app.udpClient`
   * Send `report 1` to host via UDP client
   * Wait for response with 5s timeout
   * Parse response with `KebaDeviceInfo.parseProductInfo()`
   * Store pair data: `{ host, serial, product, features }`
   * Return `true` on success

2. `session.setHandler('list_devices', async () => { ... })`:
   * Return device array from stored pair data:
   ```javascript
   [{
     name: `KEBA ${info.model} (${pairData.host})`,
     data: { id: `keba_${info.serial}` },
     store: {
       host: pairData.host,
       serial: info.serial,
       product: info.product,
       meterIntegrated: info.meterIntegrated,
       displayAvailable: info.displayAvailable,
       authAvailable: info.authAvailable,
       phaseSwitch: info.phaseSwitch
     },
     settings: {
       host: pairData.host,
       poll_interval: 30
     }
   }]
   ```

**Error handling:**
* Connection failure → `throw new Error('Could not connect to KEBA charger at {host}')`
* Invalid response → `throw new Error('Device at {host} is not a KEBA KeContact charger')`

Files:
* `keba-app/drivers/keba/driver.js` — New file (~100 lines)

Success criteria:
* Pairing completes with valid KEBA charger IP
* Device created with correct data, store, and settings
* Connection failure shows user-friendly error message

Context references:
* `solarman-app/drivers/inverter/driver.js` (Lines 1-140) — Reference pairing pattern
* `source/keba-kecontact/keba_kecontact/connection.py` (Lines 85-95) — setup_charging_station validation

Dependencies:
* Phase 1 lib files
* Step 3.3 driver.compose.json (for pairing template definition)

### Step 4.2: Create `drivers/keba/device.js` — Polling lifecycle

**Constants:**
```javascript
const POLL_INTERVAL_NORMAL = 30 * 1000;  // 30s default
const POLL_INTERVAL_QUICK = 15 * 1000;   // 15s after command
const QUICK_POLL_COUNT = 3;
const MIN_POLL_INTERVAL = 10 * 1000;     // 10s floor
const MAX_CONSECUTIVE_FAILURES = 5;      // Mark unavailable after 5 failures
```

**`async onInit()`:**
1. Get UDP client reference: `this._udpClient = this.homey.app.udpClient`
2. Get host from settings: `this._host = this.getSetting('host')`
3. Load stored features: `this._meterIntegrated = this.getStoreValue('meterIntegrated')`
4. Ensure dynamic capabilities via `_ensureCapabilities()`:
   * If meter: add `measure_power`, `meter_power`, `meter_power.session`, phase currents/voltages, `keba_power_factor`
   * Always: add `keba_current_limit`, `keba_max_current`
5. Register capability listeners:
   * `onoff` → send `ena 1` or `ena 0`
   * `keba_current_limit` → send `curr {value * 1000}` (convert A → mA)
6. Register with UDP manager: `this._udpClient.registerDevice(this._host, (msg) => this._handleMessage(msg))`
7. Initialize polling with jitter:
   ```javascript
   const jitter = Math.random() * 30000;
   this.pollTimeout = this.homey.setTimeout(async () => {
     await this.poll();
     const interval = Math.max(
       (this.getSetting('poll_interval') || 30) * 1000,
       MIN_POLL_INTERVAL
     );
     this.pollInterval = this.homey.setInterval(() => this.poll(), interval);
   }, jitter);
   ```
8. Initialize tracking state: `this._lastChargingState = null`, `this._lastPlugState = null`, `this._consecutiveFailures = 0`

**`async poll()`:**
1. Send `report 2` via UDP client, wait for response (5s timeout)
2. If meter integrated: send `report 3`, wait for response
3. On success: parse reports, update capabilities, fire triggers, reset failure count
4. On failure: increment failure count, log error
5. If failures >= MAX_CONSECUTIVE_FAILURES: `await this.setUnavailable('Charger not responding')`

**`_handleMessage(msg)`:**
* Determine response type via `KebaDataParser.getResponseType(msg)`
* Route to appropriate handler:
  * Report 2 → `_processReport2(data)`
  * Report 3 → `_processReport3(data)`
  * TCH-OK → resolve pending command promise
  * TCH-ERR → reject pending command promise

**`_processReport2(data)`:**
* Parse with `KebaDataParser.parseReport2(data)`
* Update capabilities:
  * `keba_charging_state` from `stateDetail`
  * `keba_cable_state` from plug state
  * `keba_current_limit` from `Curr user`
  * `keba_max_current` from `Max curr`
  * `onoff` from `Enable sys`
* Fire triggers on state changes:
  * `charging_started` when stateOn transitions false → true
  * `charging_stopped` when stateOn transitions true → false
  * `cable_connected` when plugEV transitions false → true
  * `cable_disconnected` when plugEV transitions true → false
  * `charging_state_changed` on any state detail change
  * `error_occurred` when stateDetail becomes 'error'

**`_processReport3(data)`:**
* Parse with `KebaDataParser.parseReport3(data)`
* Update capabilities (only when meter integrated):
  * `measure_power` — power in W
  * `meter_power` — total energy in kWh
  * `meter_power.session` — session energy in kWh
  * `measure_current.phase1/2/3` — phase currents
  * `measure_voltage.phase1/2/3` — phase voltages
  * `keba_power_factor` — power factor

**`_updateCapability(name, value)`:**
```javascript
if (this.hasCapability(name) && this.getCapabilityValue(name) !== value) {
  this.setCapabilityValue(name, value)
    .catch(err => this.error(`Failed to set ${name}:`, err));
}
```

**`_scheduleQuickPoll()`:**
Per solarman-app pattern — 15s × 3 after user commands.

**`_restartPolling(overrideInterval)`:**
Clear existing timers, set new interval.

**`async onSettings({ oldSettings, newSettings, changedKeys })`:**
* If `host` changed: unregister old host, register new host, reconnect
* If `poll_interval` changed: restart polling with new interval
* Schedule quick poll to verify new settings

**`async onUninit()`:**
```javascript
if (this.pollTimeout) { this.homey.clearTimeout(this.pollTimeout); this.pollTimeout = null; }
if (this.pollInterval) { this.homey.clearInterval(this.pollInterval); this.pollInterval = null; }
if (this.quickPollTimer) { this.homey.clearInterval(this.quickPollTimer); this.quickPollTimer = null; }
this._udpClient.unregisterDevice(this._host);
```

Files:
* `keba-app/drivers/keba/device.js` — New file (~400 lines)

Discrepancy references:
* DD-01: Poll interval minimum 10s
* DD-02: Quick poll 15s × 3 (not 5s × 6)

Success criteria:
* Device initializes with correct capabilities for model
* Polling starts with random jitter (0–30s)
* Capability values update only when changed
* Quick poll fires after commands
* All timers cleaned up in onUninit
* Device marked unavailable after 5 consecutive failures
* Flow triggers fire on state transitions

Context references:
* `solarman-app/drivers/inverter/device.js` (Lines 1-570) — Full reference device pattern
* `source/keba-kecontact/keba_kecontact/charging_station.py` (Lines 85-175) — Data transformation
* `source/keba-kecontact/keba_kecontact/charging_station.py` (Lines 200-450) — Service commands

Dependencies:
* Phase 1 lib files
* Step 3.2 custom capabilities
* Step 3.3 driver.compose.json

## Implementation Phase 5: Flow Cards

<!-- parallelizable: false -->

### Step 5.1: Create flow trigger cards

**`.homeycompose/flow/triggers/charging_started.json`:**
```json
{
  "id": "charging_started",
  "title": { "en": "Charging started" },
  "hint": { "en": "Triggers when the charger begins actively charging a vehicle" },
  "tokens": [
    { "name": "power", "type": "number", "title": { "en": "Power (W)" }, "example": 7400 }
  ],
  "args": [
    { "type": "device", "name": "device", "filter": "driver_id=keba" }
  ]
}
```

**`charging_stopped.json`:**
```json
{
  "id": "charging_stopped",
  "title": { "en": "Charging stopped" },
  "hint": { "en": "Triggers when charging ends" },
  "tokens": [
    { "name": "energy", "type": "number", "title": { "en": "Session Energy (kWh)" }, "example": 12.34 }
  ],
  "args": [
    { "type": "device", "name": "device", "filter": "driver_id=keba" }
  ]
}
```

**`cable_connected.json`:**
```json
{
  "id": "cable_connected",
  "title": { "en": "Car connected" },
  "hint": { "en": "Triggers when an EV is plugged into the charger" },
  "args": [
    { "type": "device", "name": "device", "filter": "driver_id=keba" }
  ]
}
```

**`cable_disconnected.json`:**
```json
{
  "id": "cable_disconnected",
  "title": { "en": "Car disconnected" },
  "hint": { "en": "Triggers when the EV is unplugged from the charger" },
  "args": [
    { "type": "device", "name": "device", "filter": "driver_id=keba" }
  ]
}
```

**`charging_state_changed.json`:**
```json
{
  "id": "charging_state_changed",
  "title": { "en": "Charging state changed" },
  "hint": { "en": "Triggers when the charger state changes" },
  "tokens": [
    { "name": "state", "type": "string", "title": { "en": "State" }, "example": "charging" }
  ],
  "args": [
    { "type": "device", "name": "device", "filter": "driver_id=keba" }
  ]
}
```

**`error_occurred.json`:**
```json
{
  "id": "error_occurred",
  "title": { "en": "Charger error occurred" },
  "hint": { "en": "Triggers when the charger reports an error" },
  "tokens": [
    { "name": "details", "type": "string", "title": { "en": "Error Details" }, "example": "error" }
  ],
  "args": [
    { "type": "device", "name": "device", "filter": "driver_id=keba" }
  ]
}
```

Files:
* `keba-app/.homeycompose/flow/triggers/charging_started.json`
* `keba-app/.homeycompose/flow/triggers/charging_stopped.json`
* `keba-app/.homeycompose/flow/triggers/cable_connected.json`
* `keba-app/.homeycompose/flow/triggers/cable_disconnected.json`
* `keba-app/.homeycompose/flow/triggers/charging_state_changed.json`
* `keba-app/.homeycompose/flow/triggers/error_occurred.json`

Success criteria:
* All trigger cards validate in `homey app validate`
* Token types match capability value types
* Device filter correctly targets `keba` driver

Context references:
* `.copilot-tracking/research/2026-03-20/keba-kecontact-homey-app-research.md` (Lines 560-580) — Flow triggers table
* `.copilot-tracking/research/subagents/2026-03-20/keba-reference-patterns-research.md` (Lines 440-470) — Flow card file conventions

Dependencies:
* Step 3.3 driver.compose.json (driver_id reference)

### Step 5.2: Create flow condition cards

**`.homeycompose/flow/conditions/is_charging.json`:**
```json
{
  "id": "is_charging",
  "title": { "en": "Is currently charging" },
  "hint": { "en": "Check if the charger is actively charging a vehicle" },
  "args": [
    { "type": "device", "name": "device", "filter": "driver_id=keba" }
  ]
}
```

**`is_car_connected.json`:**
```json
{
  "id": "is_car_connected",
  "title": { "en": "Is car connected" },
  "hint": { "en": "Check if an EV is plugged into the charger" },
  "args": [
    { "type": "device", "name": "device", "filter": "driver_id=keba" }
  ]
}
```

Files:
* `keba-app/.homeycompose/flow/conditions/is_charging.json`
* `keba-app/.homeycompose/flow/conditions/is_car_connected.json`

Success criteria:
* Condition cards validate in `homey app validate`

Dependencies:
* Step 3.3 driver.compose.json

### Step 5.3: Create flow action cards

**`.homeycompose/flow/actions/set_charging_current.json`:**
```json
{
  "id": "set_charging_current",
  "title": { "en": "Set charging current" },
  "hint": { "en": "Set the maximum charging current in Amperes (6-63 A)" },
  "args": [
    { "type": "device", "name": "device", "filter": "driver_id=keba" },
    { "type": "number", "name": "current", "min": 6, "max": 63, "step": 1, "title": { "en": "Current (A)" }, "placeholder": { "en": "16" } }
  ]
}
```

**`set_energy_limit.json`:**
```json
{
  "id": "set_energy_limit",
  "title": { "en": "Set session energy limit" },
  "hint": { "en": "Set the energy limit for the current charging session in kWh. Set to 0 to disable limit." },
  "args": [
    { "type": "device", "name": "device", "filter": "driver_id=keba" },
    { "type": "number", "name": "energy", "min": 0, "max": 100, "step": 0.1, "title": { "en": "Energy (kWh)" }, "placeholder": { "en": "20" } }
  ]
}
```

**`enable_charging.json`:**
```json
{
  "id": "enable_charging",
  "title": { "en": "Enable charging" },
  "hint": { "en": "Enable the charger to begin or continue charging" },
  "args": [
    { "type": "device", "name": "device", "filter": "driver_id=keba" }
  ]
}
```

**`disable_charging.json`:**
```json
{
  "id": "disable_charging",
  "title": { "en": "Disable charging" },
  "hint": { "en": "Disable the charger to stop or prevent charging" },
  "args": [
    { "type": "device", "name": "device", "filter": "driver_id=keba" }
  ]
}
```

Files:
* `keba-app/.homeycompose/flow/actions/set_charging_current.json`
* `keba-app/.homeycompose/flow/actions/set_energy_limit.json`
* `keba-app/.homeycompose/flow/actions/enable_charging.json`
* `keba-app/.homeycompose/flow/actions/disable_charging.json`

Success criteria:
* Action cards validate in `homey app validate`
* Number ranges match KEBA protocol constraints (current: 6–63 A, energy: 0–100 kWh)

Context references:
* `.copilot-tracking/research/2026-03-20/keba-kecontact-homey-app-research.md` (Lines 587-600) — Flow actions table

Dependencies:
* Step 3.3 driver.compose.json

### Step 5.4: Register flow cards in `app.js`

Add `_registerFlowCards()` to `app.js`:

```javascript
_registerFlowCards() {
  // Triggers — get card references (fired from device.js)
  this._chargingStartedTrigger = this.homey.flow.getDeviceTriggerCard('charging_started');
  this._chargingStoppedTrigger = this.homey.flow.getDeviceTriggerCard('charging_stopped');
  this._cableConnectedTrigger = this.homey.flow.getDeviceTriggerCard('cable_connected');
  this._cableDisconnectedTrigger = this.homey.flow.getDeviceTriggerCard('cable_disconnected');
  this._chargingStateChangedTrigger = this.homey.flow.getDeviceTriggerCard('charging_state_changed');
  this._errorOccurredTrigger = this.homey.flow.getDeviceTriggerCard('error_occurred');

  // Conditions
  this.homey.flow.getConditionCard('is_charging')
    .registerRunListener(async (args) => {
      return args.device.getCapabilityValue('keba_charging_state') === 'charging';
    });

  this.homey.flow.getConditionCard('is_car_connected')
    .registerRunListener(async (args) => {
      const cable = args.device.getCapabilityValue('keba_cable_state');
      return cable === 'cable_ev' || cable === 'cable_locked_ev';
    });

  // Actions
  this.homey.flow.getActionCard('set_charging_current')
    .registerRunListener(async (args) => {
      await args.device.setChargingCurrent(args.current);
    });

  this.homey.flow.getActionCard('set_energy_limit')
    .registerRunListener(async (args) => {
      await args.device.setEnergyLimit(args.energy);
    });

  this.homey.flow.getActionCard('enable_charging')
    .registerRunListener(async (args) => {
      await args.device.enableCharging();
    });

  this.homey.flow.getActionCard('disable_charging')
    .registerRunListener(async (args) => {
      await args.device.disableCharging();
    });
}
```

Flow trigger firing from device.js uses:
```javascript
await this.homey.app._chargingStartedTrigger.trigger(this, { power: currentPower });
```

Files:
* `keba-app/app.js` — Update existing (add flow card registration)

Success criteria:
* All condition run listeners return correct boolean values
* All action run listeners delegate to device methods
* Trigger references available for device.js to fire

Context references:
* `solarman-app/app.js` (Lines 10-55) — Reference flow card registration pattern

Dependencies:
* Steps 5.1, 5.2, 5.3 (flow card definitions)
* Step 4.2 device.js (exposes setChargingCurrent, setEnergyLimit, enableCharging, disableCharging methods)

## Implementation Phase 6: Localization

<!-- parallelizable: true -->

### Step 6.1: Create `locales/en.json`

English translations for all user-facing strings:

```json
{
  "errors": {
    "connection_failed": "Could not connect to KEBA charger at {{host}}",
    "not_keba_device": "Device at {{host}} is not a KEBA KeContact charger",
    "command_failed": "Failed to send command to charger",
    "charger_unavailable": "Charger is not responding"
  },
  "pairing": {
    "title": "Configure KEBA Charger",
    "ip_label": "Charger IP Address",
    "ip_placeholder": "e.g. 192.168.1.50",
    "serial_label": "Serial Number (optional)",
    "serial_placeholder": "Leave empty to auto-detect"
  },
  "settings": {
    "host_label": "IP Address",
    "host_hint": "IP address of the KEBA charger on your local network",
    "poll_interval_label": "Poll Interval (seconds)",
    "poll_interval_hint": "How often to query the charger status"
  }
}
```

Files:
* `keba-app/locales/en.json` — New file

Success criteria:
* All user-facing strings have English translations
* Template variables use `{{variable}}` Homey format

Dependencies:
* None

## Implementation Phase 7: Validation

<!-- parallelizable: false -->

### Step 7.1: Run full project validation

Execute all validation commands:
* `cd keba-app && npm install`
* `homey app validate --level publish`
* `homey app run --remote` on test Homey

Verify:
* App starts without errors
* UDP socket binds successfully on Homey
* Pairing flow works with real KEBA charger IP
* Polling produces correct capability values
* `measure_power` and `meter_power` appear in Homey Energy
* Flow cards appear in flow editor

### Step 7.2: Fix minor validation issues

Iterate on:
* Validation errors (missing fields, incorrect types)
* Capability mismatch between compose and runtime
* Encoding issues in UDP communication
* Timer/interval precision issues

### Step 7.3: Report blocking issues

When validation reveals issues beyond minor fixes:
* Document UDP sandbox restrictions if `dgram.bind()` fails on Homey
* Document encoding edge cases with non-ASCII characters
* Provide user with next steps and recommended investigation

## Dependencies

* Node.js `dgram` module (built-in)
* `commander` npm package (~11.x)
* Homey SDK runtime (provided by Homey at runtime)
* Homey CLI tool (`homey`)

## Success Criteria

* All CLI tools work against real KEBA charger
* Homey app pairs, polls, and controls KEBA charger
* Homey Energy shows power and energy readings
* `homey app validate --level publish` passes
* Flow cards functional for charging automation
