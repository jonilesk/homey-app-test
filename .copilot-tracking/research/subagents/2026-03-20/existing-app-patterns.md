# Existing App Patterns Research — For KEBA EV Charger App

**Date:** 2026-03-20
**Sources:** solarman-app, solcast-app, energy-analyzer-app, wattpilot plan

---

## 1. App Architecture Patterns

### 1.1 Standard File Structure (Solarman — LAN device)

```
solarman-app/
├── app.js                          # Flow card registration only
├── package.json                    # CLI scripts, minimal deps
├── .homeycompose/
│   ├── capabilities/               # Custom capability JSONs (prefixed: solarman_*)
│   └── flow/
│       ├── triggers/               # solar_production_changed, inverter_fault, etc.
│       ├── conditions/             # is_producing_solar, inverter_is_normal
│       └── actions/                # write_register
├── drivers/inverter/
│   ├── driver.compose.json         # Capabilities, capabilitiesOptions, energy, pair, settings
│   ├── driver.js                   # Pairing logic (LAN IP input + connection test)
│   ├── device.js                   # Polling, capability updates, flow triggers
│   └── assets/
├── lib/
│   ├── SolarmanApi.js              # TCP/Modbus protocol client
│   ├── ParameterParser.js          # Parse raw register data → named values
│   └── InverterScanner.js          # UDP broadcast discovery
├── cli/
│   ├── read-inverter.js            # Read all registers (commander CLI)
│   ├── monitor.js                  # Continuous monitoring
│   ├── discover.js                 # LAN device discovery
│   └── write-register.js           # Write a register value
└── inverter_definitions/           # YAML register maps per inverter model
```

### 1.2 Class Hierarchy

All apps use **SDK v3 classes** (not OAuth2):

- `app.js` → `extends Homey.App` — registers flow cards
- `driver.js` → `extends Homey.Driver` — pairing session handlers
- `device.js` → `extends Homey.Device` — polling, capability mgmt, cleanup

### 1.3 App.js Pattern (Flow Card Registration)

```javascript
class SolarmanApp extends Homey.App {
  async onInit() {
    this.log('App initialized');
    this._registerFlowCards();
  }

  _registerFlowCards() {
    // Triggers are device-level — just get the card reference
    this._trigger = this.homey.flow.getDeviceTriggerCard('my_trigger');

    // Conditions need registerRunListener
    this.homey.flow.getConditionCard('my_condition')
      .registerRunListener(async (args) => {
        return args.device.getCapabilityValue('some_cap') > 0;
      });

    // Actions need registerRunListener
    this.homey.flow.getActionCard('my_action')
      .registerRunListener(async (args) => {
        await args.device.doSomething(args.value);
        device._scheduleQuickPoll(); // Reflect changes quickly
      });
  }
}
```

---

## 2. Pairing Patterns (LAN Device — IP Input)

### 2.1 Using `login_credentials` Template for IP/Serial Input

The solarman app **repurposes** the built-in `login_credentials` template to collect IP address and serial number (no custom pairing views needed):

```json
// driver.compose.json → pair section
{
  "pair": [
    {
      "id": "configure",
      "template": "login_credentials",
      "options": {
        "logo": "../assets/icon.svg",
        "title": { "en": "Configure Inverter Connection" },
        "usernameLabel": { "en": "Inverter Host (IP Address)" },
        "usernamePlaceholder": { "en": "e.g. 192.168.1.100" },
        "passwordLabel": { "en": "Data Logger Serial Number" },
        "passwordPlaceholder": { "en": "e.g. 1234567890" }
      }
    },
    { "id": "list_devices", "template": "list_devices", "navigation": { "next": "add_devices" } },
    { "id": "add_devices", "template": "add_devices" }
  ]
}
```

### 2.2 Driver.js Pairing Handler

```javascript
session.setHandler('login', async (data) => {
  const host = (data.username || '').trim();    // IP from "username" field
  const serial = (data.password || '').trim();  // Serial from "password" field

  if (!host) throw new Error('Host is required');

  // Test connection before proceeding
  const api = new ProtocolClient({ host, port: defaultPort, timeout: 10000 });
  try {
    await api.connect();
    await api.testRead();    // Probe to verify device responds
    await api.disconnect();
    return true;
  } catch (error) {
    await api.disconnect().catch(() => {});
    throw new Error(`Connection failed: ${error.message}`);
  }
});

session.setHandler('list_devices', async () => {
  return [{
    name: `Device Name (${pairData.host})`,
    data: { id: `prefix_${pairData.uniqueId}` },  // Immutable identifier
    store: { host, port, ... },                     // Mutable connection params
    settings: { device_host: host, poll_interval: 60, ... },
  }];
});
```

### 2.3 Device Data Model (Three Tiers)

| Tier | Purpose | Example |
|------|---------|---------|
| **data** | Immutable identifiers (set at pairing) | `{ id: "solarman_1234567890" }` |
| **store** | Mutable cached state | `{ host, port, serial, slaveid, lookup }` |
| **settings** | User-configurable via Homey UI | `{ inverter_host, poll_interval, lookup_file }` |

---

## 3. Polling Patterns

### 3.1 Initialization with Jitter (Solarman)

```javascript
// Constants
const POLL_INTERVAL_NORMAL = 60 * 1000;
const POLL_INTERVAL_QUICK = 15 * 1000;
const QUICK_POLL_COUNT = 3;
const MIN_POLL_INTERVAL = 15 * 1000;
const POLL_INTERVAL_SLEEP = 5 * 60 * 1000;

async onInit() {
  this._createApiClient();

  // Start polling with jitter (0-30s)
  const jitter = Math.random() * 30000;
  this.log(`Starting polling with ${Math.round(jitter / 1000)}s jitter`);

  this.pollTimeout = this.homey.setTimeout(async () => {
    await this.poll();
    const interval = Math.max(
      (this.getSetting('poll_interval') || 60) * 1000,
      MIN_POLL_INTERVAL,
    );
    this.pollInterval = this.homey.setInterval(() => this.poll(), interval);
  }, jitter);
}
```

### 3.2 Quick Poll After User Changes

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

### 3.3 Restart Polling (Settings Change / Sleep Mode)

```javascript
_restartPolling(overrideInterval) {
  if (this.pollTimeout) { this.homey.clearTimeout(this.pollTimeout); this.pollTimeout = null; }
  if (this.pollInterval) { this.homey.clearInterval(this.pollInterval); this.pollInterval = null; }

  const interval = overrideInterval || Math.max(
    (this.getSetting('poll_interval') || 60) * 1000,
    MIN_POLL_INTERVAL,
  );
  this.pollInterval = this.homey.setInterval(() => this.poll(), interval);
}
```

### 3.4 Cleanup in onUninit

```javascript
async onUninit() {
  if (this.pollTimeout) { this.homey.clearTimeout(this.pollTimeout); this.pollTimeout = null; }
  if (this.pollInterval) { this.homey.clearInterval(this.pollInterval); this.pollInterval = null; }
  if (this.quickPollTimer) { this.homey.clearInterval(this.quickPollTimer); this.quickPollTimer = null; }
  if (this._api) { await this._api.disconnect().catch(() => {}); }
}
```

### 3.5 Energy Analyzer Polling (App-Level)

The energy-analyzer-app does polling at the **app level** (not device level) since it's a system-wide analyzer:

```javascript
startPolling() {
  const jitter = Math.random() * 30000;
  this.homey.setTimeout(() => {
    this.runAnalysis();
    this.pollInterval = this.homey.setInterval(() => this.runAnalysis(), 15 * 60 * 1000);
  }, jitter);
}
```

---

## 4. Capability Declaration Patterns

### 4.1 measure_power and meter_power in driver.compose.json

```json
{
  "class": "solarpanel",
  "capabilities": ["measure_power", "meter_power", ...],
  "capabilitiesOptions": {
    "measure_power": {
      "title": { "en": "Output Power" },
      "decimals": 0
    },
    "meter_power": {
      "title": { "en": "Total Production" },
      "decimals": 1
    }
  }
}
```

### 4.2 Sub-Capabilities (Solarman Pattern)

Sub-capabilities use dot notation in `capabilitiesOptions` — they are **not** listed in the top-level `capabilities` array but are **dynamically added** by `_ensureCapabilities()`:

```json
"capabilitiesOptions": {
  "measure_power.pv1": {
    "title": { "en": "PV1 Power" },
    "decimals": 0,
    "uiComponent": null        // Hidden from main device UI tile
  },
  "measure_power.grid": {
    "title": { "en": "Grid Power" },
    "decimals": 0               // No uiComponent: null → shown in UI
  },
  "meter_power.daily_production": {
    "title": { "en": "Daily Production" },
    "decimals": 2
  },
  "meter_power.total_production": {
    "title": { "en": "Total Production" },
    "decimals": 1,
    "uiComponent": null
  }
}
```

**Key insight for KEBA:** Use sub-capabilities like `measure_power.l1`, `measure_power.l2`, `measure_power.l3` for per-phase power and `meter_power.session` for session energy vs `meter_power` for lifetime energy.

### 4.3 Custom Capability JSON (in .homeycompose/capabilities/)

**Enum type (status):**

```json
// solarman_inverter_status.json
{
  "type": "enum",
  "title": { "en": "Inverter Status" },
  "getable": true,
  "setable": false,
  "uiComponent": "sensor",
  "icon": "/assets/capabilities/status.svg",
  "values": [
    { "id": "standby", "title": { "en": "Stand-by" } },
    { "id": "normal", "title": { "en": "Normal" } },
    { "id": "fault", "title": { "en": "FAULT" } }
  ]
}
```

**Number type (measurement):**

```json
// solarman_grid_frequency.json
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

**String type (simple read-only):**

```json
// solarman_work_mode.json
{
  "type": "string",
  "title": { "en": "Work Mode" },
  "getable": true,
  "setable": false,
  "uiComponent": "sensor"
}
```

### 4.4 Dynamic Capability Management (Migration Support)

```javascript
async _ensureCapabilities() {
  const neededCaps = new Set();
  // ... determine needed capabilities from device config ...

  for (const cap of neededCaps) {
    if (!this.hasCapability(cap)) {
      await this.addCapability(cap).catch(err =>
        this.error(`Failed to add ${cap}:`, err));
    }
  }
  this._neededCapabilities = neededCaps;
}
```

---

## 5. Energy Integration

### 5.1 Homey Energy Configuration in driver.compose.json

Both solarman and solcast use the same pattern:

```json
{
  "energy": {
    "cumulative": true,
    "cumulativeImportedCapability": "meter_power"
  }
}
```

**For KEBA EV charger**, this should be adapted to track imported energy (energy consumed by the charger):

```json
{
  "energy": {
    "cumulative": true,
    "cumulativeImportedCapability": "meter_power"
  }
}
```

### 5.2 Capability Update Pattern (Only When Changed)

Used consistently across all apps:

```javascript
_updateCapability(name, value) {
  if (this.hasCapability(name) && this.getCapabilityValue(name) !== value) {
    this.setCapabilityValue(name, value)
      .catch(err => this.error(`Failed to set ${name}:`, err));
  }
}
```

### 5.3 Sleep/Offline Handling (Solarman)

When the device is unreachable after having been connected:

```javascript
_handleSleep() {
  if (!this._sleeping) {
    this._sleeping = true;

    // Zero out instantaneous readings
    for (const cap of SLEEP_ZERO_CAPABILITIES) {
      this._updateCapability(cap, 0);
    }
    // Set status to standby
    this._updateCapability('status_cap', 'standby');
    // Slow down polling
    this._restartPolling(POLL_INTERVAL_SLEEP);
  }
  // Keep device available — user sees last cumulative values
}
```

**Key for KEBA:** When charger is idle/unreachable, zero `measure_power` but keep `meter_power` at its last value.

---

## 6. Protocol Client Patterns (LAN Communication)

### 6.1 SolarmanApi — TCP Client Structure

```javascript
class SolarmanApi {
  constructor({ host, port, serial, timeout, autoReconnect, logger }) {
    this._host = host;
    this._port = port;
    this._timeout = timeout;
    this._autoReconnect = autoReconnect;
    this._logger = logger;
    this._socket = null;
    this._connected = false;
    this._locked = false;      // Mutex for request serialization
    this._waiters = [];
  }

  async connect() {
    if (this._connected) return;
    // TCP socket with keepAlive, noDelay, connection timeout
    // Error/close handlers with cleanup
  }

  async disconnect() {
    this._connected = false;
    if (this._socket) {
      this._socket.removeAllListeners();
      this._socket.destroy();
      this._socket = null;
    }
  }
}
```

**Connection features:**
- TCP keepAlive (60s)
- Connection-phase timeout via `setTimeout`
- Socket `setNoDelay(true)` for low-latency
- Promise-based mutex for request serialization
- Clean disconnect with `removeAllListeners()` + `destroy()`

### 6.2 Logger Injection Pattern

All apps inject a custom logger scoped to the device:

```javascript
this._api = new ProtocolClient({
  host, port,
  logger: {
    log: (...args) => this.log('[API]', ...args),
    error: (...args) => this.error('[API]', ...args),
  },
});
```

### 6.3 LAN Discovery (UDP Broadcast)

```javascript
class InverterScanner {
  static async discover({ timeout = 2000, broadcastAddr = '255.255.255.255', port = 48899 }) {
    return new Promise((resolve) => {
      const devices = [];
      const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      // Send broadcast, collect responses, cleanup on timeout
    });
  }
}
```

**For KEBA:** KEBA KeContact uses UDP port 7090 for discovery and commands. Similar pattern applies.

---

## 7. CLI Test Tools Pattern

### 7.1 Structure (package.json scripts)

```json
{
  "scripts": {
    "discover": "node cli/discover.js",
    "read": "node cli/read-inverter.js",
    "write": "node cli/write-register.js",
    "monitor": "node cli/monitor.js"
  },
  "dependencies": {
    "commander": "^11.0.0"
  }
}
```

### 7.2 CLI Tool Pattern (Commander)

```javascript
const { Command } = require('commander');
const ProtocolClient = require('../lib/ProtocolClient');

const program = new Command();
program
  .name('read-device')
  .description('Read values from device')
  .requiredOption('--host <ip>', 'Device IP address')
  .option('--port <number>', 'Port', '7090')
  .option('--save', 'Save raw data to test_data/')
  .action(async (options) => {
    const client = new ProtocolClient({ host: options.host, port: parseInt(options.port) });
    await client.connect();
    // ... read and display data ...
    await client.disconnect();
  });

program.parse();
```

### 7.3 CLI Tool Categories

| Tool | Purpose | KEBA Equivalent |
|------|---------|-----------------|
| `discover.js` | UDP broadcast to find devices on LAN | Discover KEBA chargers on UDP 7090 |
| `read-inverter.js` | Read all registers, display parsed values | Read KEBA status report |
| `monitor.js` | Continuous monitoring with interval | Monitor KEBA charging session |
| `write-register.js` | Write a value to the device | Send KEBA commands (start/stop, set current) |

---

## 8. Flow Card Patterns

### 8.1 Trigger (fired from device.js)

```json
// .homeycompose/flow/triggers/solar_production_changed.json
{
  "id": "solar_production_changed",
  "title": { "en": "Solar production changed" },
  "tokens": [
    { "name": "power", "type": "number", "title": { "en": "Power (W)" }, "example": 1500 }
  ],
  "args": [
    { "type": "device", "name": "device", "filter": "driver_id=inverter" }
  ]
}
```

**Firing from device.js:**

```javascript
this.homey.flow.getDeviceTriggerCard('solar_production_changed')
  .trigger(this, { power: newPowerValue })
  .catch(err => this.error('[trigger]', err));
```

### 8.2 Condition

```json
// .homeycompose/flow/conditions/is_producing_solar.json
{
  "id": "is_producing_solar",
  "title": { "en": "Is producing solar energy" },
  "args": [
    { "type": "device", "name": "device", "filter": "driver_id=inverter" }
  ]
}
```

### 8.3 Action

```json
// .homeycompose/flow/actions/write_register.json
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

---

## 9. Wattpilot Plan — EV Charger-Specific Patterns

The wattpilot plan document provides an EV charger-specific reference architecture:

### 9.1 Recommended Device Class

```
"class": "evcharger"   // Not "sensor" or "solarpanel"
```

### 9.2 EV Charger Capabilities

| Capability | Type | Description |
|-----------|------|-------------|
| `measure_power` | number (W) | Live charging power |
| `meter_power` | number (kWh) | Cumulative energy (lifetime) |
| `onoff` | boolean | Charging allowed / enabled |
| Custom `charging_state` | enum | NO_CAR, READY, CHARGING, COMPLETE, ERROR |
| Custom `target_current` | number (A) | Requested charging current |
| Custom `charging_mode` | enum | DEFAULT, ECO, NEXT_TRIP |

### 9.3 Update Thresholds (Avoid Spam)

```
measure_power: update if changed by ≥ 10W or every 30s
meter_power: update if changed by ≥ 0.01 kWh or every 5 min
```

### 9.4 Reconnect Strategy

- Exponential backoff with jitter (1s, 2s, 4s, 8s… capped at 60s)
- Immediate reconnect on close unless device disabled
- Heartbeat/ping to detect half-open sockets
- Connection state flag for availability

### 9.5 Safety for Control Commands

- Clamp current to supported range (6–16A, configurable)
- Reject commands if device unavailable
- All I/O must be async

---

## 10. Settings Change Handling

```javascript
async onSettings({ oldSettings, newSettings, changedKeys }) {
  this.log('Settings changed:', changedKeys);

  const connectionKeys = ['device_host', 'device_port'];
  if (changedKeys.some(k => connectionKeys.includes(k))) {
    await this._api.disconnect().catch(() => {});
    this._createApiClient();
  }

  if (changedKeys.includes('poll_interval')) {
    this._restartPolling();
  }

  // Quick poll to verify new settings
  this._scheduleQuickPoll();
}
```

---

## 11. Summary: Reusable Patterns for KEBA App

### Direct Reuse

1. **Pairing via `login_credentials`** — IP input through username field, password for auth if needed
2. **Polling with jitter + quick poll** — identical pattern, just change intervals
3. **`_updateCapability` helper** — copy verbatim
4. **`onUninit` cleanup** — copy verbatim
5. **Energy config** — `{ cumulative: true, cumulativeImportedCapability: "meter_power" }`
6. **CLI tool structure** — discover, read-status, monitor, send-command
7. **Logger injection** — `{ log: (...args) => this.log('[API]', ...args), error: ... }`
8. **Settings change handler** — reconnect on connection param changes
9. **Flow card patterns** — triggers with tokens, conditions, actions with device filter

### Adapt for KEBA

1. **Protocol client** — KEBA uses UDP (not TCP/Modbus), so `KebaClient.js` will use `dgram` instead of `net`
2. **Device class** — use `"evcharger"` instead of `"solarpanel"` or `"sensor"`
3. **Sleep handling** — KEBA doesn't sleep at night, but may go idle; zero `measure_power` when not charging
4. **Discovery** — KEBA uses UDP broadcast on port 7090 (similar to InverterScanner but different protocol)
5. **Control commands** — KEBA supports `currtime`, `ena`, `setenergy` UDP commands (action flow cards)
6. **Custom capabilities** — `keba_charging_state`, `keba_cable_state`, `target_current`, etc.

### Recommended KEBA Driver.compose.json Skeleton

```json
{
  "name": { "en": "KEBA KeContact P30" },
  "class": "evcharger",
  "capabilities": [
    "measure_power",
    "meter_power",
    "onoff",
    "keba_charging_state",
    "keba_cable_state"
  ],
  "capabilitiesOptions": {
    "measure_power": { "title": { "en": "Charging Power" }, "decimals": 0 },
    "meter_power": { "title": { "en": "Total Energy" }, "decimals": 2 },
    "measure_power.l1": { "title": { "en": "L1 Power" }, "decimals": 0, "uiComponent": null },
    "measure_power.l2": { "title": { "en": "L2 Power" }, "decimals": 0, "uiComponent": null },
    "measure_power.l3": { "title": { "en": "L3 Power" }, "decimals": 0, "uiComponent": null },
    "meter_power.session": { "title": { "en": "Session Energy" }, "decimals": 3 }
  },
  "energy": {
    "cumulative": true,
    "cumulativeImportedCapability": "meter_power"
  },
  "pair": [
    {
      "id": "configure",
      "template": "login_credentials",
      "options": {
        "title": { "en": "Configure KEBA Charger" },
        "usernameLabel": { "en": "Charger IP Address" },
        "usernamePlaceholder": { "en": "e.g. 192.168.1.50" },
        "passwordLabel": { "en": "Password (if enabled)" },
        "passwordPlaceholder": { "en": "Leave empty if not set" }
      }
    },
    { "id": "list_devices", "template": "list_devices", "navigation": { "next": "add_devices" } },
    { "id": "add_devices", "template": "add_devices" }
  ]
}
```
