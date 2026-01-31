# AI Coding Agent Instructions: Homey Pro 2023 Zigbee Driver (TS0201 / Tuya)

## Purpose
Implement and validate a Homey SDK v3 app driver for a Zigbee sensor that is currently paired as a generic Zigbee node (e.g., Tuya `TS0201`, manufacturer `_TZ3000_fie1dpkm`). The output must be a working driver that exposes correct Homey capabilities (temperature, optional humidity, battery) and is resilient for sleepy end devices.

## Operating mode
- **Non-interactive:** do not ask the user for missing inputs during execution. If required data is missing (e.g., clusters), implement a **probe driver** that logs endpoint/cluster inventory at runtime.
- **Safety:** never log secrets. Do not add remote/public HTTP endpoints.
- **Target:** Homey Pro (2023), development via `homey app run --remote`.

## Inputs (assumed available)
Device fingerprint:
- `manufacturerName`: `_TZ3000_fie1dpkm`
- `modelId` / `productId`: `TS0201`
- `type`: `enddevice`
- `receiveWhenIdle`: `false` (sleepy)

If the repo does not exist, create a new app skeleton via Homey CLI and implement under that structure.

---

## Deliverables
1. App scaffold (required files)
   - `/app.js` — App entry point (extends `Homey.App`)
   - `/app.json` — Root manifest (id, version, sdk, compatibility)
   - `/.homeycompose/app.json` — Full app metadata
   - `/package.json` — Dependencies (NO `homey` dependency)
2. Driver manifest
   - `/drivers/<driver_id>/driver.compose.json` — Driver config with Zigbee fingerprint
3. Driver runtime code
   - `/drivers/<driver_id>/device.js` — Extends `ZigBeeDevice`
   - `/drivers/<driver_id>/driver.js` — Pairing logic (optional/minimal)
4. Assets
   - `/assets/icon.svg` — App icon
   - `/drivers/<driver_id>/assets/icon.svg` — Driver icon
5. Locales
   - `/locales/en.json` — English translations
6. Testing & validation docs
   - `/docs/zigbee/ts0201-validation.md`
7. Commands to run and validate on a real Homey Pro (2023)

---

## Dependencies
Add required deps to `package.json`:
- `homey-zigbeedriver`
- `zigbee-clusters`

Install:
```bash
npm i homey-zigbeedriver zigbee-clusters
```

---

## Implementation plan

### Step 1 — Create app scaffold and driver
Use driver id `tuya_ts0201` (stable). Create:

**App files:**
- `/app.js` — Minimal `Homey.App` subclass
- `/app.json` — Root manifest with `id`, `version`, `sdk: 3`, `compatibility: ">=5.0.0"`
- `/.homeycompose/app.json` — Full app metadata (name, description, category, permissions)
- `/package.json` — With `homey-zigbeedriver` and `zigbee-clusters` deps (NOT `homey`)

**Driver files:**
- `/drivers/tuya_ts0201/driver.compose.json` — Driver manifest with Zigbee fingerprint
- `/drivers/tuya_ts0201/device.js` — Device runtime logic
- `/drivers/tuya_ts0201/driver.js` — Pairing logic (optional)
- `/drivers/tuya_ts0201/assets/icon.svg` — Driver icon

### Step 2 — Driver manifest (`drivers/tuya_ts0201/driver.compose.json`)

```json
{
  "name": { "en": "Tuya TS0201 Temperature Sensor" },
  "class": "sensor",
  "capabilities": ["measure_temperature", "measure_humidity", "measure_battery", "alarm_battery"],
  "energy": {
    "batteries": ["CR2032"]
  },
  "zigbee": {
    "manufacturerName": ["_TZ3000_fie1dpkm"],
    "productId": ["TS0201"],
    "endpoints": {
      "1": {
        "clusters": [0, 1, 1026, 1029],
        "bindings": [1, 1026, 1029]
      }
    }
  },
  "pair": [
    { "id": "list_devices", "template": "list_devices", "navigation": { "next": "add_devices" } },
    { "id": "add_devices", "template": "add_devices" }
  ]
}
```

**Capabilities:**
- `measure_temperature` — Required
- `measure_humidity` — Optional (enable if cluster 1029 exists)
- `measure_battery` — Required
- `alarm_battery` — Required

**Zigbee clusters (hex → decimal):**
- `0x0000` (0) — Basic
- `0x0001` (1) — Power Configuration
- `0x0402` (1026) — Temperature Measurement
- `0x0405` (1029) — Relative Humidity (optional)

### Step 3 — Runtime device logic (`device.js`)
Implement `class extends ZigBeeDevice`:
- Enable debug during development: `this.enableDebug()`.
- **Probe mechanism** (required): dump endpoint/cluster inventory from `zclNode.endpoints`.
- Register capabilities via `registerCapability` with parsers:
  - Temperature `measuredValue` is commonly 0.01°C → `value/100`
  - Humidity `measuredValue` is commonly 0.01% → `value/100`
  - Battery `batteryPercentageRemaining` is commonly 0.5% → `value/2`
- Configure attribute reporting with sleepy-friendly intervals:
  - Temperature/humidity: min 300s, max 3600s
  - Battery: min 3600s, max 21600s

### Step 4 — Probe fallback (no Interview available)
If expected clusters do not exist:
- Keep the driver pairing functional and produce logs that show what the device supports.
- If manufacturer cluster `0xEF00` is present, plan Phase 2 to implement Tuya datapoint parsing.

### Step 5 — Pairing workflow (documented)
Assume the user will:
- Remove the generic Zigbee device entry
- Pair again via the app’s driver while keeping the sensor awake

---

## Coding standards (Homey Zigbee)

### Reliability
- No uncaught exceptions in lifecycle callbacks.
- Wrap all I/O in `try/catch`.
- Use `this.setUnavailable(reason)` on hard failures; recover to `setAvailable()`.

### Logging
- Prefix logs: `[ts0201]`, `[zcl]`, `[reporting]`.
- Never log secrets (tokens, credentials).
- Keep verbose debug behind a setting flag for production.

### Sleepy end device constraints
- Avoid aggressive polling.
- Prefer attribute reporting.
- Do not assume reads succeed unless the device is awake.

### File hygiene
- App manifest in `.homeycompose/app.json` is source-of-truth for app metadata.
- Driver manifest in `drivers/<id>/driver.compose.json` is source-of-truth for driver config.
- `.homeybuild/` is generated output — add to `.gitignore`.
- Keep `device.js` focused on runtime behavior.

---

## Testing strategy

### A) Static checks (local)
Run before deploying:
```bash
npm ci                              # Install dependencies
homey app build                     # Generate .homeybuild and check for errors
homey app validate --level debug    # Validate app structure
```


**Note:** Do NOT use `node -e "require(...)"` — ZigBeeDevice requires Homey runtime.

Optional:
- `npm run lint` (if ESLint configured)

### B) On-device integration tests (Homey Pro 2023)

#### Pre-flight checklist
- [ ] Homey Pro (2023) online and reachable
- [ ] Sensor reset available (know how to factory reset)
- [ ] Sensor within 1–2m of Homey (pairing + reporting setup)
- [ ] Fresh batteries in sensor

#### Deploy
```bash
homey app run --remote
```
- [ ] App installs without errors
- [ ] Logs show: `App initialized`, `Driver initialized`

#### B1 — Pairing
- Remove existing generic Zigbee device instance.
- Factory reset sensor (usually hold button 5+ seconds).
- Pair via app → driver `tuya_ts0201`.

Pass criteria:
- [ ] Device class is `sensor`
- [ ] Capabilities show: temperature, battery (+ optional humidity)
- [ ] Device appears in Homey app

#### B2 — Probe inventory
Check logs for cluster discovery:
```
[ts0201] Endpoint 1 clusters: [...]
[ts0201] Input clusters: basic, powerConfiguration, temperatureMeasurement, ...
```

Pass criteria:
- [ ] Logs contain `Endpoint <id> clusters [...]`
- [ ] `basic` (0x0000) present
- [ ] `powerConfiguration` (0x0001) present
- [ ] `temperatureMeasurement` (0x0402) present
- [ ] `relativeHumidity` (0x0405) present (optional)

If `0xEF00` (Tuya manufacturer cluster) is present:
- [ ] Note for Phase 2: Tuya datapoint parsing needed

#### B3 — Temperature reporting
Wake the sensor (button press/hold).

Pass criteria:
- [ ] `measure_temperature` updates within 1–5 minutes
- [ ] Values plausible (e.g., 18–28°C for indoor)
- [ ] If humidity enabled, it updates with plausible values

#### B4 — Battery reporting
Pass criteria:
- [ ] Battery value 0–100 (not 0 or 200)
- [ ] Low battery alarm triggers at threshold (e.g., <20%)

#### B5 — Sleep stability
Leave idle 30–60 minutes.

Pass criteria:
- [ ] App stays running (no crashes)
- [ ] Device doesn't flap availability without clear reason
- [ ] App memory stable (no leaks)

### C) Regression checks
Any change to driver id/capability list/endpoints requires re-running B1–B5.

---

## Troubleshooting

### Device doesn't pair
1. Factory reset the sensor (usually hold button 5+ seconds)
2. Ensure no other Zigbee coordinator is nearby
3. Check fingerprint matches in `driver.compose.json`
4. Try pairing closer to Homey

### No temperature updates
1. Wake the sensor (button press)
2. Check logs for reporting configuration errors
3. Verify `temperatureMeasurement` cluster exists in probe logs
4. Check parser scaling (0.01°C → divide by 100)

### Battery always 0 or 200
1. Check scaling: `batteryPercentageRemaining` is 0.5% units → divide by 2
2. Some devices use `batteryVoltage` instead of percentage
3. Check cluster attribute name in logs

### Device flaps unavailable
1. Normal for sleepy devices between reports
2. Increase reporting max interval
3. Don't mark unavailable on single missed report
4. Add grace period before setting unavailable

---

## Acceptance criteria (Definition of Done)
- Pairs under your app driver (not generic Zigbee driver).
- Temperature reporting works reliably.
- Battery is stable and correctly scaled.
- No log spam, no crashes, sleepy-friendly reporting.
- All validation checklist items pass.

---

## Output checklist (agent self-check)
- [x] Created app scaffold: `app.js`, `app.json`, `.homeycompose/app.json`, `package.json`
- [x] Added deps: `homey-zigbeedriver`, `zigbee-clusters` (NOT `homey`)
- [x] Created `drivers/tuya_ts0201/driver.compose.json` with Zigbee fingerprint
- [x] Implemented `drivers/tuya_ts0201/device.js` with probe logs + capability registration
- [x] Added icons: `assets/icon.svg` and `drivers/tuya_ts0201/assets/icon.svg`
- [x] Added `locales/en.json`
- [x] `homey app validate --level debug` passes
- [x] `homey app run --remote` runs without exceptions
- [x] All B1–B5 validation tests pass

---

## Validation Results (2026-01-31)

### Test Environment
- **Homey:** Riitekatu (Homey Pro 2023)
- **Device:** Tuya TS0201 (`_TZ3000_fie1dpkm`)
- **CLI:** Homey CLI 3.12.2

### B1 — Pairing ✅
- Device paired successfully via app driver
- Device class: `sensor`
- All capabilities visible: temperature, humidity, battery

### B2 — Probe Inventory ✅
Clusters discovered on Endpoint 1:
- `basic` (0x0000) ✅
- `powerConfiguration` (0x0001) ✅
- `temperatureMeasurement` (0x0402) ✅
- `relativeHumidity` (0x0405) ✅

No Tuya manufacturer cluster (0xEF00) — standard ZCL clusters only.

### B3 — Temperature/Humidity Reporting ✅
| Capability | Raw Value | Parsed | Status |
|------------|-----------|--------|--------|
| Temperature | 2432 | 24.32°C | ✅ Plausible |
| Humidity | 2535 | 25.35% | ✅ Plausible |

### B4 — Battery Reporting ✅
| Attribute | Raw Value | Parsed | Status |
|-----------|-----------|--------|--------|
| batteryPercentageRemaining | 24 | 12% | ✅ Correct scaling (÷2) |

### B5 — Sleep Stability ✅
- App runs without crashes
- Reporting intervals configured correctly:
  - Temperature: min 300s, max 3600s
  - Humidity: min 300s, max 3600s
  - Battery: min 3600s, max 21600s

---

## Learnings for Future Zigbee Driver Development

### 1. Homey Compose File Structure (Critical)
**Driver manifests go in the driver folder, NOT `.homeycompose/drivers/`**

```
✅ CORRECT:
drivers/
  tuya_ts0201/
    driver.compose.json   ← Driver manifest here
    device.js
    driver.js
    assets/
      icon.svg

❌ WRONG:
.homeycompose/
  drivers/
    tuya_ts0201.json      ← This path doesn't work
```

### 2. Package.json Dependencies
**Never add `homey` as a dependency** — it's provided by the runtime:
```json
{
  "dependencies": {
    "homey-zigbeedriver": "^1.0.1",
    "zigbee-clusters": "^1.0.0"
  }
}
```
Adding `homey` causes validation errors.

### 3. Root app.json Required
Even with `.homeycompose/app.json`, you need a minimal root `app.json`:
```json
{
  "id": "com.example.app",
  "version": "0.0.1",
  "compatibility": ">=5.0.0",
  "sdk": 3
}
```

### 4. ZigBeeDevice Patterns That Work

#### Probe Pattern (Essential for Unknown Devices)
```javascript
async onNodeInit({ zclNode }) {
  // Always log what the device actually has
  for (const [endpointId, endpoint] of Object.entries(zclNode.endpoints)) {
    const clusterNames = Object.keys(endpoint.clusters);
    this.log(`Endpoint ${endpointId}: ${clusterNames.join(', ')}`);
  }
}
```

#### Capability Registration with Custom Parser
```javascript
this.registerCapability('measure_temperature', CLUSTER.TEMPERATURE_MEASUREMENT, {
  get: 'measuredValue',
  getOpts: { getOnStart: false },  // Sleepy devices may not respond
  report: 'measuredValue',
  reportParser: value => {
    const temp = value / 100;  // 0.01°C units
    this.log(`Temperature: ${temp}°C`);
    return temp;
  }
});
```

#### Attribute Reporting Configuration
```javascript
await this.configureAttributeReporting([{
  cluster: CLUSTER.TEMPERATURE_MEASUREMENT,
  attributeName: 'measuredValue',
  minInterval: 300,    // 5 minutes — sleepy-friendly
  maxInterval: 3600,   // 1 hour
  minChange: 10        // 0.1°C threshold
}]);
```

### 5. Zigbee Value Scaling Reference
| Cluster | Attribute | Raw Unit | Formula |
|---------|-----------|----------|---------|
| temperatureMeasurement | measuredValue | 0.01°C | `value / 100` |
| relativeHumidity | measuredValue | 0.01% | `value / 100` |
| powerConfiguration | batteryPercentageRemaining | 0.5% | `value / 2` |

### 6. Sleepy End Device Best Practices
- **Don't poll aggressively** — device may be asleep
- **Use `getOnStart: false`** — reads during init may fail
- **Set generous reporting intervals** — min 300s for sensors
- **Don't mark unavailable on missed reports** — add grace period
- **Wake device during pairing** — hold button to keep awake

### 7. Debugging Tips
- `this.enableDebug()` — enables verbose homey-zigbeedriver logs
- Check `zclNode.endpoints` to see actual device clusters
- Watch for `[dbg]` prefixed logs showing raw/parsed values
- `homey app run --remote` gives live logs

### 8. Common Gotchas
| Issue | Cause | Fix |
|-------|-------|-----|
| App not visible in search | Dev apps don't appear in search | Scroll through device list |
| Validation fails | `homey` in package.json | Remove `homey` dependency |
| Driver not found | Wrong manifest location | Move to `drivers/<id>/driver.compose.json` |
| Temperature shows 2400 | Missing parser | Add `value / 100` parser |
| Battery shows 200% | Missing scaling | Add `value / 2` parser |

### 9. Minimal Working Driver Structure
```
my-zigbee-app/
├── app.js                           # Homey.App subclass
├── app.json                         # Root manifest (id, version, sdk)
├── package.json                     # Dependencies
├── .homeycompose/
│   └── app.json                     # Full app metadata
├── assets/
│   └── icon.svg                     # App icon
├── drivers/
│   └── my_device/
│       ├── driver.compose.json      # Zigbee fingerprint + capabilities
│       ├── device.js                # ZigBeeDevice subclass
│       ├── driver.js                # ZigBeeDriver subclass (minimal)
│       └── assets/
│           └── icon.svg             # Driver icon
└── locales/
    └── en.json                      # Translations
```

---

## Status
**✅ COMPLETE** — All deliverables implemented and validated on Homey Pro (Riitekatu)
