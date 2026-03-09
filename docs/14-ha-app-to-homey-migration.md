# 14 — Migrating a Home Assistant Integration to a Homey App

A step-by-step guide for porting a Home Assistant custom component to a native Homey Pro (2023) app. Covers source analysis, architecture mapping, implementation strategy, testing, and production deployment.

> **Case study**: This guide uses the [Solarman integration](../source/home_assistant_solarman/) → [Solarman Homey app](../solarman-app/) migration as a concrete example. Apply the same patterns to any HA integration.

---

## 1. Analyze the HA Source

Before writing any Homey code, inventory the HA integration to understand what needs to be ported.

### 1.1 Map the Source Files

Every HA custom component follows this layout:

```
custom_components/<domain>/
├── __init__.py          # HA entry point, platform setup
├── const.py             # Constants: domain, config keys, defaults
├── config_flow.py       # Config flow UI for adding/editing
├── sensor.py            # Sensor entities (or switch.py, climate.py, etc.)
├── services.py          # HA service calls (optional)
├── services.yaml        # HA service definitions (optional)
├── strings.json         # UI strings
├── manifest.json        # HACS/HA manifest
└── <data_files>/        # Any data files loaded at runtime
```

For each file, note:
- **Line count** — gives a rough sense of complexity
- **External dependencies** — Python packages that need Node.js equivalents
- **HA-specific code** — things that only exist in HA (e.g., `hass.states`, `config_entries`)
- **Portable logic** — protocol implementations, parsers, algorithms

> **Example**: The Solarman integration had ~940 lines of Python across 8 files. `solarman.py` (168 lines) wrapped the `pysolarmanv5` library; `parser.py` (210 lines) was pure data parsing with no HA dependencies.

### 1.2 Identify the Communication Pattern

Understand how the integration talks to devices:

| Pattern | HA Example | Homey Equivalent |
|---------|-----------|------------------|
| **Local LAN polling** | TCP/UDP sockets, mDNS | Same — Node.js `net`/`dgram` |
| **Cloud API** | REST with `aiohttp` | `fetch()` with AbortController |
| **OAuth2 cloud** | HA OAuth2 flow | `homey-oauth2app` library |
| **Websocket** | `websockets` library | Node.js `ws` or built-in |
| **Bluetooth/Zigbee/Z-Wave** | HA radio stack | Homey radio stack (different APIs) |

> **Example**: Solarman uses local TCP polling — Solarman V5 frames wrapping Modbus RTU over TCP port 8899. No cloud dependency.

### 1.3 Inventory Data Points

List all entities the HA integration exposes and their types:
- **sensor** → usually `measure_*` or `meter_*` capabilities in Homey
- **binary_sensor** → `alarm_*` or boolean capabilities
- **switch** → `onoff` capability
- **climate** → `target_temperature`, thermostat capabilities
- **number/select** → device settings or writable capabilities

> **Example**: Solarman exposes 40+ sensor entities (power, energy, temperature, voltage, current, frequency, status, faults). These map to ~15 Homey capabilities with sub-IDs like `measure_power.pv1`, `measure_voltage.grid`.

---

## 2. Architecture Mapping

### 2.1 Component-by-Component Translation

Every HA integration file has a Homey counterpart. Use this table as a starting point:

| HA Source | Homey Target | Approach |
|-----------|--------------|----------|
| `__init__.py` (entry point) | `app.js` | Usually much simpler — flow card registration, app-level setup |
| `const.py` (constants) | Inline in `device.js` / `driver.compose.json` | Homey doesn't need a central constants file |
| `config_flow.py` (config UI) | `driver.js` + pairing templates | Homey pairing wizard replaces HA config flow |
| `sensor.py` / `switch.py` / `climate.py` (entities) | `device.js` | **Biggest redesign** — HA entities → Homey capabilities |
| `services.py` (HA services) | Flow action cards in `app.js` | HA services ≈ Homey flow action cards |
| `strings.json` | `locales/en.json` | Different JSON structure |
| Protocol/API client library | `lib/*.js` | Port or rewrite depending on language gap |

### 2.2 Entity Model Translation

This is the most important conceptual difference:

| Concept | Home Assistant | Homey |
|---------|---------------|-------|
| **Device** | Device with many entities | Device with many capabilities |
| **Data point** | Entity (has its own state, history, UI card) | Capability (property of a device) |
| **Types** | `sensor`, `binary_sensor`, `switch`, `climate`, `number` | `measure_*`, `meter_*`, `alarm_*`, `onoff`, `target_temperature` |
| **Sub-devices** | Entity per channel | Sub-capability with suffix: `measure_power.pv1` |
| **Naming** | Friendly name strings | Capability IDs (snake_case, immutable after release) |

**Translation rules:**
1. **Instantaneous measurements** → `measure_<unit>` (e.g., `measure_power`, `measure_temperature`)
2. **Cumulative values** → `meter_<unit>` (e.g., `meter_power` for kWh)
3. **Boolean alerts** → `alarm_<type>` (e.g., `alarm_generic`)
4. **On/off control** → `onoff`
5. **Multi-channel** → Use sub-capability suffix: `measure_power.channel1`
6. **Enum values** → Custom capability with `type: "enum"` and `values` array
7. **String values** → Custom capability with `type: "string"`

> **Example**: Solarman's HA entity `sensor.grid_frequency` (a float sensor in Hz) became the Homey custom capability `solarman_grid_frequency` (type: number, unit: Hz). HA entity `sensor.inverter_status` (text state) became `solarman_inverter_status` (type: enum with values: standby, selfcheck, normal, fault, permanent).

### 2.3 Config Flow → Pairing Wizard

HA config flows collect user input in Python-defined steps. Homey uses JSON-defined pairing views:

| HA config_flow.py pattern | Homey pairing template |
|--------------------------|----------------------|
| Text inputs (host, port, API key) | `login_credentials` or custom view |
| Dropdown/select | `list_devices` |
| Auto-discovery | `list_devices` with pre-populated list |
| OAuth2 login | `login_oauth2` |
| Manual confirmation | `confirm` view |

> **Pitfall**: The `login_credentials` template emits a `login` event with `username` and `password` fields — not custom field names. If your HA flow collects `host` and `serial`, you must map them inside the `login` handler.

### 2.4 Decide: Port vs Rewrite

For each library/module from the HA source:

| Situation | Approach |
|-----------|----------|
| Pure logic, no HA/Python deps | **Direct port** — translate line-by-line to JS |
| Depends on a Python library with a Node.js equivalent | **Rewrite using JS library** |
| Depends on a Python library with no JS equivalent | **Rewrite from scratch** using protocol specs |
| HA-specific glue code | **Redesign** — use Homey SDK patterns |

> **Example**: Solarman's `parser.py` had zero HA dependencies — it was a direct port. `solarman.py` depended on `pysolarmanv5` (no Node.js equivalent) — it was rewritten from scratch using the protocol specification.

---

## 3. Implementation Strategy

### 3.1 Recommended Build Order

Build and test in layers, from protocol up to UI:

| Phase | What | Why |
|-------|------|-----|
| **1. Protocol/API client** | `lib/MyApiClient.js` | Validate communication independently of Homey |
| **2. CLI test tools** | `cli/test-connection.js` | Test against real hardware/API without deploying to Homey |
| **3. Data parser/mapper** | `lib/DataParser.js` | Verify data transformation matches HA output |
| **4. Driver + pairing** | `driver.js`, `driver.compose.json` | Get device discovered and added via Homey UI |
| **5. Device + polling** | `device.js` | Capabilities updating, poll loop, error handling |
| **6. Flow cards** | `.homeycompose/flow/` + `app.js` registration | Trigger, condition, action cards |
| **7. Live testing** | `homey app run --remote` | End-to-end on actual Homey hub |

**CLI-first development** is strongly recommended. It lets you iterate on protocol code without waiting for Homey app deploys. Keep CLI tools in a `cli/` folder (they won't be deployed to Homey).

### 3.2 Capability Mapping Table

Create a mapping table from HA entity names/IDs to Homey capability IDs. This becomes the bridge in your `device.js`:

```javascript
// Map HA entity names → Homey capability IDs
const CAPABILITY_MAP = {
  // HA entity name (from config/integration): Homey capability
  'power':           'measure_power',
  'energy_total':    'meter_power',
  'temperature':     'measure_temperature',
  'grid_frequency':  'myapp_grid_frequency',  // custom capability
  'status':          'myapp_device_status',    // custom enum capability
};
```

**Only update capabilities when values actually change** — avoids unnecessary Homey Insights writes:
```javascript
_updateCapability(name, value) {
  if (this.hasCapability(name) && this.getCapabilityValue(name) !== value) {
    this.setCapabilityValue(name, value)
      .catch(err => this.error(`Failed to set ${name}:`, err));
  }
}
```

### 3.3 Custom Capabilities

If Homey doesn't have a built-in capability for a data point, define custom ones in `.homeycompose/capabilities/`:

```json
{
  "type": "number",
  "title": { "en": "Grid Frequency" },
  "units": { "en": "Hz" },
  "insights": true,
  "getable": true,
  "setable": false,
  "umin": 0,
  "umax": 100,
  "decimals": 2
}
```

Custom capability naming: `<app_prefix>_<name>` (e.g., `solarman_grid_frequency`).

### 3.4 Enum Capabilities

For HA entities that return string states (like status, mode), use enum capabilities:

```json
{
  "type": "enum",
  "title": { "en": "Device Status" },
  "values": [
    { "id": "standby", "title": { "en": "Standby" } },
    { "id": "normal",  "title": { "en": "Normal"  } },
    { "id": "fault",   "title": { "en": "Fault"   } }
  ],
  "getable": true,
  "setable": false
}
```

> **Pitfall**: Never write a raw value to an enum capability if it's not in the `values` array — Homey will throw `Invalid enum capability value`. Always validate and skip unmapped values.

### 3.5 Dynamic Capabilities

If the HA integration supports multiple device models with different data points, use dynamic capabilities so a single driver supports all variants:

```javascript
async _ensureCapabilities(expectedCapabilities) {
  for (const cap of expectedCapabilities) {
    if (!this.hasCapability(cap)) {
      await this.addCapability(cap).catch(err =>
        this.error(`Failed to add ${cap}:`, err));
    }
  }
}
```

This lets users switch device models/profiles without re-pairing.

### 3.6 Settings Migration

| HA Concept | Homey Equivalent | Where Defined |
|------------|-----------------|---------------|
| Config entry options | Device settings | `driver.compose.json` `settings[]` |
| Config flow data (immutable) | Device data | Set at pairing via `addDevice()` |
| Options flow (user-changeable) | Device settings | `driver.compose.json` + `onSettings()` |

> The `onSettings()` callback receives `{ oldSettings, newSettings, changedKeys }`. **Pitfall**: `this.getSetting()` still returns the old value inside `onSettings()` — use `newSettings` directly.

---

## 4. Common Porting Pitfalls

Lessons learned across multiple HA → Homey migrations:

| Pitfall | Cause | Fix |
|---------|-------|-----|
| Pairing event name mismatch | `login_credentials` emits `login`, not your custom event name | Use `session.setHandler('login', ...)` |
| Device stuck "Unavailable" | Single try/catch wrapping all I/O — one failure marks entire device down | Per-operation error handling; only set unavailable on connection failures |
| Setting changes don't apply | `getSetting()` returns old value inside `onSettings()` | Use `newSettings[key]` from the callback parameter |
| Invalid enum values | Hardware returns unexpected value not in capability's `values` array | Validate before writing; skip unknown values |
| Timer leaks on reinstall | `setInterval`/`setTimeout` not cleared in `onUninit()` | Always clear all timers in `onUninit()` |
| API response type mismatch | API returns `"42"` (string), code expects `42` (number) | Always `parseInt()`/`parseFloat()` external data |
| Thundering herd on restart | All devices poll simultaneously after Homey reboot | Add random jitter (0–30s) before first poll |
| `fetch()` hangs forever | Homey's `fetch()` timeout parameter doesn't work | Use `AbortController` with `setTimeout()` |
| Capability ID renamed after users paired | Device data references old ID → device breaks | Never rename `driver_id` or capability IDs after first release |

---

## 5. Testing Checklist

### 5.1 Test Phases

| Phase | Method | What to Verify |
|-------|--------|---------------|
| **Protocol/API** | CLI test tools | Connection succeeds, data matches HA output |
| **Pairing** | `homey app run --remote` | Device appears, credentials accepted, device created |
| **Polling** | Live logs | Values update, errors handled gracefully |
| **Data accuracy** | Compare with HA / vendor app | Values match within expected precision |
| **Error recovery** | Disconnect device, invalid config | Device marks unavailable, recovers when back online |
| **Settings** | Change settings in Homey UI | New values apply without re-pairing |
| **Flow cards** | Create test flows | Triggers fire, conditions evaluate, actions execute |
| **Validation** | `homey app validate --level publish` | No errors (warnings acceptable) |

### 5.2 Data Verification

Always compare Homey values against the HA integration or the vendor's own app:

| Data Point | HA / Vendor Value | Homey Value | Match? |
|-----------|------------------|-------------|--------|
| *(fill in per integration)* | | | |

Pay special attention to:
- **Units** — some APIs return Fahrenheit×10, mW instead of W, etc.
- **Scale factors** — HA may apply different scaling than your port
- **Timestamps** — timezone handling differences between Python and Node.js

### 5.3 Homey Deploy Commands

```bash
homey select                        # Select target Homey device
homey app run --remote              # Dev mode (live logs, stops when terminal closes)
homey app install                   # Permanent install (survives reboots)
homey app validate --level debug    # Quick check during development
homey app validate --level publish  # Full validation for App Store readiness
```

---

## 6. Production Deployment Checklist

- [ ] Core API/protocol library tested independently (CLI or unit tests)
- [ ] Pairing flow works for all supported device types
- [ ] Polling is resilient (per-operation error handling)
- [ ] Data values verified against HA / vendor app
- [ ] Settings changes apply without re-pairing
- [ ] Dynamic capabilities work for multi-model support
- [ ] Flow cards registered and functional
- [ ] All timers cleared in `onUninit()`
- [ ] Polling uses jitter to avoid thundering herd
- [ ] `homey app validate --level publish` passes (or only has non-blocking warnings)
- [ ] `homey app install` — permanent installation tested

---

## 7. Project Structure Template

```
my-app/
├── app.js                          # Homey.App — flow card registration, app-level logic
├── app.json                        # Generated manifest (do not edit directly)
├── package.json                    # Dependencies
├── .homeycompose/
│   ├── app.json                    # App manifest source-of-truth
│   ├── capabilities/               # Custom capability JSON definitions
│   └── flow/
│       ├── triggers/
│       ├── conditions/
│       └── actions/
├── drivers/inverter/
│   ├── driver.js                   # Pairing flow (login_credentials + multi-probe)
│   ├── device.js                   # Device runtime (polling, capabilities, triggers)
│   ├── driver.compose.json         # Driver manifest (capabilities, settings, pairing)
│   └── assets/icon.svg
├── lib/                            # Core libraries (shared with CLI)
│   ├── MyApiClient.js              # Protocol/API client
│   ├── DataParser.js               # Data transformation (if needed)
│   └── DeviceScanner.js            # LAN/cloud discovery (if needed)
├── cli/                            # Command-line test tools (dev only)
│   ├── test-connection.js          # Validate API/protocol against real device
│   └── monitor.js                  # Continuous polling for debugging
├── locales/
│   └── en.json                     # English translations (required)
├── assets/
│   └── icon.svg                    # 960×960, transparent background
└── test_data/                      # Captured data fixtures (optional)
```

---

## 8. Case Study: Solarman (HA → Homey)

A concrete example of applying this guide. The [Solarman HA integration](../source/home_assistant_solarman/) (~940 lines Python) was migrated to a [Homey app](../solarman-app/) (~2,124 lines JavaScript).

### 8.1 Source → Target Mapping

```
HA Python Source                              Homey JavaScript Target
─────────────────                             ──────────────────────
__init__.py ──────────────────────────────────→ app.js
const.py ─────────────────────────────────────→ device.js (inline) + driver.compose.json
solarman.py (pysolarmanv5 wrapper) ───────────→ lib/SolarmanApi.js (native V5 impl)
parser.py (ParameterParser) ──────────────────→ lib/ParameterParser.js (direct port)
sensor.py (entities) ─────────────────────────→ drivers/inverter/device.js (redesign)
scanner.py (UDP discovery) ───────────────────→ lib/InverterScanner.js (rewrite)
config_flow.py ───────────────────────────────→ drivers/inverter/driver.js (redesign)
services.py (Modbus R/W) ────────────────────→ app.js flow action card (simplified)
inverter_definitions/*.yaml ──────────────────→ inverter_definitions/*.yaml (copied as-is)
```

### 8.2 Port vs Rewrite Decisions

| Component | Decision | Reason |
|-----------|----------|--------|
| `parser.py` → `ParameterParser.js` | **Direct port** | Pure data logic, no HA dependencies |
| `solarman.py` → `SolarmanApi.js` | **Full rewrite** | Python `pysolarmanv5` has no Node.js equivalent |
| `sensor.py` → `device.js` | **Redesign** | HA entity model fundamentally differs from Homey capabilities |
| `scanner.py` → `InverterScanner.js` | **Rewrite** | `asyncio` UDP → Node.js `dgram` |

### 8.3 Issues Encountered

All four pitfalls from Section 4 were hit during this migration:
1. **Pairing event mismatch** — `login_credentials` emits `login`, not `configure`
2. **Single try/catch** — one Modbus error marked entire device unavailable
3. **`getSetting()` in `onSettings()`** — returned old value, profile switch didn't apply
4. **Invalid enum** — status register 0xFF not in enum values array

### 8.4 Data Verification

| Parameter | Cloud Portal | Homey | Match |
|-----------|-------------|-------|-------|
| Output Power | 560 W | 560 W | ✅ |
| Total Production | 11.2 MWh | 11205.7 kWh | ✅ |
| Temperature | 21°C | 21 °C | ✅ |
| Grid Frequency | 50.02 Hz | 50.03 Hz | ✅ |
| Status | Normal | Normal | ✅ |

All values matched within expected precision. The app runs with 7/9 register ranges succeeding (2 battery ranges correctly fail on a string inverter and are handled gracefully).
