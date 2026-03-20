# Research: Migration Guide Patterns & Homey Driver/Device Conventions

**Date:** 2026-03-20
**Sources:** `docs/14-ha-app-to-homey-migration.md`, `docs/05-drivers-devices-capabilities.md`, `docs/06-flows.md`, `docs/04-coding-guidelines.md`, `docs/02-project-structure-homey-compose.md`, `solarman-app/` (reference implementation), `wattpilot/wattipilot-plan-for-homey.md`

---

## 1. Migration Methodology (HA → Homey)

### 7-Phase Build Order

The migration guide prescribes a strict bottom-up, CLI-first dev methodology:

| Phase | Deliverable | Purpose |
|-------|-------------|---------|
| **1. Protocol/API client** | `lib/MyApiClient.js` | Validate communication independently of Homey |
| **2. CLI test tools** | `cli/test-connection.js` | Test against real hardware without deploying to Homey |
| **3. Data parser/mapper** | `lib/DataParser.js` | Verify data transformation matches HA output |
| **4. Driver + pairing** | `driver.js`, `driver.compose.json` | Get device discovered and added via Homey UI |
| **5. Device + polling** | `device.js` | Capabilities updating, poll loop, error handling |
| **6. Flow cards** | `.homeycompose/flow/` + `app.js` registration | Trigger, condition, action cards |
| **7. Live testing** | `homey app run --remote` | End-to-end on actual Homey hub |

### Pre-Migration Analysis Steps

Before any code:

1. **Map HA source files** — inventory line count, external deps, HA-specific vs portable code
2. **Identify communication pattern** — local LAN polling, cloud API, OAuth2, WebSocket, BLE/Zigbee/Z-Wave
3. **Inventory data points** — list all HA entities, map type (sensor→`measure_*`, binary_sensor→`alarm_*`, switch→`onoff`, etc.)
4. **Port vs rewrite decision** per module:
   - Pure logic / no HA deps → **direct port** (line-by-line JS translation)
   - Python lib with Node.js equivalent → **rewrite using JS library**
   - Python lib with no JS equivalent → **rewrite from scratch** using protocol specs
   - HA-specific glue → **redesign** using Homey SDK patterns

### Component-by-Component Translation Table

| HA Source | Homey Target |
|-----------|-------------|
| `__init__.py` | `app.js` (simpler — flow card registration, app setup) |
| `const.py` | Inline in `device.js` / `driver.compose.json` |
| `config_flow.py` | `driver.js` + pairing templates |
| `sensor.py` / `switch.py` / `climate.py` | `device.js` (**biggest redesign** — entities → capabilities) |
| `services.py` | Flow action cards in `app.js` |
| `strings.json` | `locales/en.json` (different structure) |
| Protocol/API client | `lib/*.js` |

---

## 2. UDP/LAN Device Pairing

### Discovery Pattern (from solarman reference)

For local-network UDP devices, the pattern uses `dgram` with broadcast:

```javascript
const dgram = require('dgram');
const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
socket.bind(0, () => {
  socket.setBroadcast(true);
  const message = Buffer.from(DISCOVERY_MESSAGE);
  socket.send(message, 0, message.length, port, broadcastAddr);
});
// Listen for responses, parse, collect into devices array
// Resolve after timeout
```

**Key aspects:**
- Use `reuseAddr: true` on socket
- Broadcast to `255.255.255.255` or subnet broadcast address
- Set a timeout (typically 2–5 seconds) and resolve with found devices
- Track `seen` serials to deduplicate responses
- Wrap entire discovery in error handlers — resolve empty array on failure, never reject

### Pairing Templates & Views

Three pairing templates are used in sequence for LAN devices:

1. **`login_credentials`** — collects connection info (host/IP, serial/password)
   - **Critical pitfall:** This template emits a `login` event with `username`/`password` fields — NOT custom field names
   - Override labels via `options.usernameLabel`, `options.passwordLabel`, `options.usernamePlaceholder`, etc.
   - Map fields in handler: `data.username` → host, `data.password` → serial

2. **`list_devices`** — shows discovered/validated devices for selection
   - Feed devices via `session.setHandler('list_devices', ...)` returning array of `{ name, data, settings, store }`

3. **`add_devices`** — confirmation step

### Pairing Flow Pattern (from solarman driver.js)

```javascript
async onPair(session) {
  let pairData = {};

  // 1. Handle login_credentials → validate connection
  session.setHandler('login', async (data) => {
    const host = (data.username || '').trim();
    const serial = parseInt(data.password, 10);
    // Validate, test connection, throw on failure
    pairData = { host, serial, port: 8899 };
    return true;
  });

  // 2. Provide device list
  session.setHandler('list_devices', async () => {
    return [{
      name: `Device (${pairData.host})`,
      data: { id: `${pairData.serial}` },  // immutable
      store: { /* mutable cached state */ },
      settings: { host: pairData.host, port: pairData.port },
    }];
  });
}
```

### Pairing Config in `driver.compose.json`

```json
"pair": [
  {
    "id": "configure",
    "template": "login_credentials",
    "options": {
      "logo": "../assets/icon.svg",
      "title": { "en": "Configure Connection" },
      "usernameLabel": { "en": "Host (IP Address)" },
      "passwordLabel": { "en": "Serial / Password" }
    }
  },
  { "id": "list_devices", "template": "list_devices", "navigation": { "next": "add_devices" } },
  { "id": "add_devices", "template": "add_devices" }
]
```

---

## 3. Capability Conventions

### Standard vs Custom Capabilities

**Standard capabilities** (built-in to Homey — prefer these whenever possible):

| Capability | Type | Unit | Use Case |
|------------|------|------|----------|
| `measure_power` | number | W | Instantaneous power |
| `meter_power` | number | kWh | Cumulative energy |
| `measure_temperature` | number | °C | Temperature |
| `measure_voltage` | number | V | Voltage |
| `measure_current` | number | A | Current |
| `onoff` | boolean | — | On/off control |
| `alarm_generic` | boolean | — | Boolean alert |

**Custom capabilities** — only when Homey has no built-in match:

- File location: `.homeycompose/capabilities/<capability_id>.json`
- Naming convention: `<app_prefix>_<name>` (e.g., `solarman_grid_frequency`)
- Never rename after first release — breaks existing installs

### Custom Capability JSON Structure

**Number type:**
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

**Enum type:**
```json
{
  "type": "enum",
  "title": { "en": "Inverter Status" },
  "getable": true,
  "setable": false,
  "uiComponent": "sensor",
  "values": [
    { "id": "standby", "title": { "en": "Stand-by" } },
    { "id": "normal", "title": { "en": "Normal" } },
    { "id": "fault", "title": { "en": "FAULT" } }
  ]
}
```

**Enum pitfall:** Never write a raw value not in the `values` array — Homey throws `Invalid enum capability value`. Always validate and skip unmapped values.

### Sub-Capabilities (Multi-Channel)

Sub-capabilities use dot-suffix notation: `<standard_capability>.<suffix>`

Examples from solarman reference:

| Sub-capability | Title | Purpose |
|---------------|-------|---------|
| `measure_power.pv1` | PV1 Power | Solar string 1 |
| `measure_power.pv2` | PV2 Power | Solar string 2 |
| `measure_power.grid` | Grid Power | Grid import/export |
| `measure_power.load` | Load Power | House consumption |
| `measure_power.battery` | Battery Power | Battery charge/discharge |
| `measure_voltage.l1` | L1 Voltage | Phase 1 voltage |
| `measure_current.l1` | L1 Current | Phase 1 current |
| `meter_power.daily_production` | Daily Production | Today's energy |
| `meter_power.total_production` | Total Production | Lifetime energy |

**Declaration in `driver.compose.json`:**

- Capabilities array lists only the **base** capabilities (not sub-capabilities)
- Sub-capabilities are declared in `capabilitiesOptions` with customized titles, decimals, and optionally `"uiComponent": null` to hide from main device card

```json
{
  "capabilities": ["measure_power", "meter_power", "measure_temperature"],
  "capabilitiesOptions": {
    "measure_power.pv1": {
      "title": { "en": "PV1 Power" },
      "decimals": 0,
      "uiComponent": null
    },
    "measure_current.phase1": {
      "title": { "en": "Phase 1 Current" },
      "decimals": 2,
      "uiComponent": null
    }
  }
}
```

### Dynamic Capability Management

Add/remove capabilities at runtime without re-pairing:

```javascript
async _ensureCapabilities(expectedCapabilities) {
  for (const cap of expectedCapabilities) {
    if (!this.hasCapability(cap)) {
      await this.addCapability(cap).catch(err => this.error(`Failed to add ${cap}:`, err));
    }
  }
}
```

### Capability Update Pattern

**Only write when value changes** to avoid unnecessary Insights writes:

```javascript
_updateCapability(name, value) {
  if (this.hasCapability(name) && this.getCapabilityValue(name) !== value) {
    this.setCapabilityValue(name, value)
      .catch(err => this.error(`Failed to set ${name}:`, err));
  }
}
```

---

## 4. Device Class & Energy Configuration (EV Charger)

### Device Class

For an EV charger, set `"class": "evcharger"` in `driver.compose.json`.

### Energy Configuration

To integrate with Homey Energy, declare the `energy` object in `driver.compose.json`:

```json
{
  "class": "evcharger",
  "energy": {
    "cumulative": true,
    "cumulativeImportedCapability": "meter_power"
  }
}
```

**Key points** (from solarman reference + wattpilot plan):
- `"cumulative": true` tells Homey this device reports cumulative energy
- `"cumulativeImportedCapability": "meter_power"` points to the kWh capability
- Provide `measure_power` updates continuously for real-time power display
- Provide `meter_power` as a monotonically increasing value (kWh)
- For bidirectional devices, also use `"cumulativeExportedCapability"` if applicable

### Required Capabilities for EV Charger

| Capability | Type | Purpose |
|------------|------|---------|
| `measure_power` | number (W) | Live charging power |
| `meter_power` | number (kWh) | Cumulative energy consumed |
| `onoff` | boolean | Enable/disable charging |
| Custom `charging_state` | enum | Charging status (NO_CAR, READY, CHARGING, COMPLETE, ERROR) |
| Custom `target_current` | number (A) | Requested charging current (setable) |

---

## 5. Flow Card Patterns

### File Organization

Flow cards are defined as JSON files under `.homeycompose/flow/`:

```
.homeycompose/flow/
├── triggers/
│   ├── status_changed.json
│   └── charging_started.json
├── conditions/
│   ├── is_charging.json
│   └── is_car_connected.json
└── actions/
    ├── set_charging_current.json
    └── enable_charging.json
```

### Trigger Card Pattern

```json
{
  "id": "inverter_status_changed",
  "title": { "en": "Inverter status changed" },
  "hint": { "en": "Triggers when inverter status changes" },
  "tokens": [
    {
      "name": "status",
      "type": "string",
      "title": { "en": "Status" },
      "example": "Normal"
    }
  ],
  "args": [
    {
      "type": "device",
      "name": "device",
      "filter": "driver_id=inverter"
    }
  ]
}
```

**Registration in `app.js`:**
```javascript
this.homey.flow.getTriggerCard('inverter_status_changed');
```

**Firing from `device.js`:**
```javascript
this.driver.ready().then(() => {
  this.homey.flow.getTriggerCard('inverter_status_changed')
    .trigger(this, { status: newStatus });
});
```

### Condition Card Pattern

```json
{
  "id": "is_producing_solar",
  "title": { "en": "Solar is producing power" },
  "args": [
    { "type": "device", "name": "device", "filter": "driver_id=inverter" }
  ]
}
```

**Registration with handler:**
```javascript
this.homey.flow.getConditionCard('is_producing_solar')
  .registerRunListener(async (args) => {
    const power = args.device.getCapabilityValue('measure_power');
    return power > 0;
  });
```

### Action Card Pattern

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

### EV Charger Flow Card Ideas

| Type | Card | Tokens/Args |
|------|------|-------------|
| **Trigger** | Charging started | `power` (W) |
| **Trigger** | Charging completed | `energy` (kWh) |
| **Trigger** | Car connected/disconnected | `state` (string) |
| **Trigger** | Charging state changed | `state` (enum string) |
| **Condition** | Is currently charging | — |
| **Condition** | Is car connected | — |
| **Action** | Set charging current | `current` (number, A) |
| **Action** | Enable/disable charging | `enabled` (boolean) |

### Design Guidelines

- Keep titles short and user-friendly
- Validate arguments early, return helpful errors
- Action cards must be idempotent (safe to run multiple times)
- Keep execution fast; offload slow I/O to async
- Log flow execution start + outcome with correlation info
- Localize titles, hints, and argument labels

---

## 6. Settings, Store, and Data Tiers

### Three-Tier Device Data Model

| Tier | Mutability | Where Set | Use Case | Example |
|------|-----------|-----------|----------|---------|
| **data** | **Immutable** | Pairing (`addDevice()`) | Unique identifiers | `{ deviceId, serialNumber, homeId }` |
| **store** | **Mutable** (programmatic) | `setStoreValue()` | Cached operational state | `{ firmwareVersion, lastSeen, zoneName }` |
| **settings** | **Mutable** (user or code) | Homey UI or `onSettings()` | User-configurable params | `{ pollInterval, debugLogging, host }` |

### Settings Definition in `driver.compose.json`

```json
"settings": [
  {
    "id": "inverter_host",
    "type": "text",
    "label": { "en": "Host" },
    "value": "",
    "hint": { "en": "IP address of the device" }
  },
  {
    "id": "inverter_port",
    "type": "number",
    "label": { "en": "Port" },
    "value": 8899,
    "min": 1,
    "max": 65535
  },
  {
    "id": "lookup_file",
    "type": "dropdown",
    "label": { "en": "Device Model" },
    "value": "default.yaml",
    "values": [
      { "id": "model_a.yaml", "label": { "en": "Model A" } },
      { "id": "model_b.yaml", "label": { "en": "Model B" } }
    ]
  }
]
```

### Settings Pitfall

**`getSetting()` returns old value inside `onSettings()` callback.** Always use `newSettings[key]` from the callback parameter:

```javascript
async onSettings({ oldSettings, newSettings, changedKeys }) {
  // WRONG: this.getSetting('host') — returns OLD value
  // RIGHT: newSettings.host — returns NEW value
  if (changedKeys.includes('host')) {
    await this.reconnect(newSettings.host);
  }
}
```

### Best Practices

- **data**: set once at pairing, never change — device identity
- **store**: connection secrets (host, auth tokens) — updatable programmatically
- **settings**: user-facing config (poll interval, debug mode, model selection) — visible in Homey UI
- Never store secrets in settings if they should not be user-visible; use store instead
- **Never log tokens, passwords, or API keys**

---

## 7. Error Handling, Polling & Cleanup Patterns

### Error Handling (from `docs/04-coding-guidelines.md`)

- **Wrap all I/O in `try/catch`** — never throw uncaught from device callbacks
- **Per-operation error handling** — don't wrap everything in a single try/catch (one failure shouldn't mark the entire device down)
- **Fail soft**: mark device unavailable rather than crashing
- **Backoff retries** with caps (linear or exponential)
- Always `parseInt()`/`parseFloat()` external data (API responses are often strings)

### Polling Pattern

```javascript
async onInit() {
  // Jitter: 0–30s random delay to prevent thundering herd
  const jitter = Math.random() * 30000;
  this.pollTimeout = this.homey.setTimeout(async () => {
    await this.poll();
    this.pollInterval = this.homey.setInterval(() => this.poll(), POLL_INTERVAL_NORMAL);
  }, jitter);
}
```

**Quick-poll after user action:**
- 15s × 3 polls after user changes, then back to normal (≥180s)

### HTTP/Fetch Timeout (Critical)

`fetch()` timeout parameter does NOT work on Homey. Always use `AbortController`:

```javascript
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 10000);
try {
  const response = await fetch(url, { signal: controller.signal });
} finally {
  clearTimeout(timeout);
}
```

### Cleanup in `onUninit()`

Clear ALL timers and connections:

```javascript
async onUninit() {
  if (this.pollTimeout) { this.homey.clearTimeout(this.pollTimeout); this.pollTimeout = null; }
  if (this.pollInterval) { this.homey.clearInterval(this.pollInterval); this.pollInterval = null; }
  if (this.quickPollTimer) { this.homey.clearInterval(this.quickPollTimer); this.quickPollTimer = null; }
  // Close sockets/connections if applicable
}
```

---

## 8. File Organization (from `docs/02-project-structure-homey-compose.md`)

### Source of Truth

- `.homeycompose/` files are **authoritative** — they generate `app.json`
- `driver.compose.json` lives INSIDE `drivers/<id>/` (NOT in `.homeycompose/drivers/`)
- `.homeybuild/` is generated output — must be in `.gitignore`
- Root `app.json` is required and merged with `.homeycompose/app.json`
- Do NOT add `homey` as a dependency in `package.json` — runtime provides it

### Reference Project Structure (for migration)

```
my-app/
├── app.js                          # Homey.App
├── app.json                        # Generated (do not edit directly)
├── package.json
├── .homeycompose/
│   ├── app.json                    # Source-of-truth manifest
│   ├── capabilities/               # Custom capability JSONs
│   └── flow/
│       ├── triggers/
│       ├── conditions/
│       └── actions/
├── drivers/<driver_id>/
│   ├── driver.js                   # Pairing flow
│   ├── device.js                   # Device runtime
│   ├── driver.compose.json         # Driver manifest
│   └── assets/icon.svg
├── lib/                            # Core libraries (shared with CLI)
│   ├── ApiClient.js
│   ├── DataParser.js
│   └── DeviceScanner.js
├── cli/                            # CLI test tools (dev only)
├── locales/en.json
├── assets/icon.svg                 # 960×960, transparent
└── test_data/                      # Captured data fixtures
```

---

## Identified Gaps & Further Research Needed

### Gaps in Current Documentation

1. **No explicit `evcharger` device class documentation** — the migration guide uses `solarpanel` as the example class. The wattpilot plan mentions `evcharger` but without detailed Homey SDK documentation on what standard capabilities it expects. Need to verify Homey's built-in expectations for `evcharger` class devices.

2. **WebSocket-based devices not covered** — the migration guide only covers TCP/UDP polling and cloud API patterns. For devices using local WebSocket connections (like Wattpilot), there's no detailed reconnection pattern in the docs. The wattpilot plan has this but it's not in the core guides.

3. **Sub-capability declaration nuance** — the docs don't explicitly explain whether sub-capabilities (e.g., `measure_power.pv1`) need to be listed in the `capabilities` array or only in `capabilitiesOptions`. From the solarman reference, only base capabilities appear in the array; sub-capabilities are implicitly added and configured via `capabilitiesOptions`. This should be explicitly documented.

4. **Energy configuration options** — only `cumulative`/`cumulativeImportedCapability` are shown. The full set of energy config options (e.g., `cumulativeExportedCapability`, `batteries`, `approximation` settings) are not documented.

5. **Flow card registration lifecycle** — the docs describe the JSON definition but not the full lifecycle of registering run listeners in `app.js` vs `driver.js` vs `device.js`. The solarman reference shows registration in `app.js`, but it's unclear when driver-scoped vs app-scoped flow cards are appropriate.

6. **No coverage of the `charging_state` capability** — for EV chargers, there's no standard Homey capability for charging state. Need to verify if Homey has a built-in one or if a custom enum capability is always needed.

### Recommendations

1. **For EV charger implementation**: Use `"class": "evcharger"` with `measure_power`, `meter_power`, `onoff`, and custom enum for charging state. Declare energy config with `cumulative: true`.

2. **For UDP discovery**: Follow the InverterScanner pattern — broadcast, timeout-based, deduplicate, error-tolerant. Wrap in pairing flow as auto-discovery step before `list_devices`.

3. **For capability naming**: Stick to `<app_prefix>_<capability_name>` for custom capabilities. Use standard capabilities with sub-IDs (`measure_power.phase1`) for multi-channel standard measurements.

4. **For multi-phase EV chargers**: Use sub-capabilities like `measure_power.l1`, `measure_current.l1`, `measure_voltage.l1` for per-phase data, following the solarman pattern.

5. **CLI-first development is strongly recommended** — build and test the protocol client and parser before integrating with Homey SDK. Keep CLI tools in `cli/` folder.
