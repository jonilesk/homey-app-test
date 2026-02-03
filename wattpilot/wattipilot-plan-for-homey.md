# AI Coding Agent Instructions: Homey App Integration for Fronius Wattpilot (Local Network Only)

## Scope (Hard Constraint)
- **Local network access only**: connect to the Wattpilot using its **IP address or hostname** over the LAN.
- **No cloud endpoints**, no vendor accounts, no remote relay services.
- Assume the Wattpilot is reachable from Homey on the same network (or routable VLAN).

---

## Target Outcome
Implement a Homey SDK v3 app/driver that:
1. Connects to a Wattpilot on the local network (IP/hostname configured by user).
2. Reads live charging telemetry and metering values via local connection.
3. Exposes Homey Energy-compatible capabilities:
   - `measure_power` (W) live
   - `meter_power` (kWh) cumulative (optional if available)
4. Optionally provides local control:
   - Enable/disable charging
   - Set charging current (A)
   - Set charging mode (if supported via local API)

---

## Architecture Recommendation

### App structure
```
com.example.wattpilot.local/
├─ app.js
├─ lib/
│  ├─ WattpilotClient.js          # WebSocket client + reconnect + protocol handling
│  ├─ WattpilotParser.js          # Parse inbound messages -> normalized state
│  └─ WattpilotMapper.js          # State -> Homey capabilities
└─ drivers/
   └─ wattpilot/
      ├─ driver.compose.json
      ├─ driver.js
      └─ device.js
```

### Device model
One Homey device per Wattpilot charger.

---

## Step 1 — Pairing UX (Local Only)

### Inputs during pairing
Ask the user for:
- **Host**: IP address or hostname (e.g., `192.168.1.50` or `wattpilot.local`)
- **Port**: default empty (use client default), allow override
- **Password / token** (if the local API requires authentication)

### Store configuration
Persist per-device connection details in the **Device Store**:
- `host`
- `port`
- `auth` (store only what is necessary; avoid logging secrets)

---

## Step 2 — Local Connection Implementation

### 2.1 WattpilotClient responsibilities
- Create and maintain a **WebSocket** connection to `ws://{host}:{port}/...` (exact path depends on protocol; implement as configurable constant).
- Authenticate (if required by the local interface).
- Subscribe to telemetry updates (if protocol uses subscriptions).
- Maintain last-known state in memory.
- Handle reconnect reliably.

### 2.2 Reconnect strategy (must-have)
Implement:
- Exponential backoff with jitter (e.g., 1s, 2s, 4s, 8s… capped at 60s)
- Immediate reconnect on `close` unless the user has disabled the device
- Heartbeat/ping (if supported) to detect half-open sockets
- A “connection state” flag to reflect availability in Homey

### 2.3 Error-handling rules
- Never crash app on parse errors; drop/ignore unknown messages
- Rate-limit error logs to avoid flooding Homey logs
- If auth fails: mark device unavailable with a clear message

---

## Step 3 — Capability Mapping (Homey)

### 3.1 Required capabilities (minimum)
**Read**
- `measure_power` (number, W): total charging power right now
- `meter_power` (number, kWh): cumulative energy counter (if available)
- `onoff` (boolean): charging allowed / charging enabled (optional but recommended)
- `charging_state` (custom enum capability) OR use `alarm_generic` + `status` text

**Write (optional but valuable)**
- `onoff`: allow/forbid charging
- `target_current` (custom number capability, A): requested charging current
- `charging_mode` (custom enum): e.g., `DEFAULT`, `ECO`, `NEXT_TRIP` (only if supported)

### 3.2 Homey Energy inclusion
To ensure the Wattpilot is included in Homey Energy:
- Provide `measure_power` updates continuously
- Provide `meter_power` monotonically increasing if available
- Device class should be appropriate, e.g. `evcharger`

---

## Step 4 — Data Flow

### 4.1 Inbound telemetry -> normalized state
Implement `WattpilotParser.parse(message)` returning normalized state, e.g.:
```js
{
  ts: 1700000000000,
  connected: true,
  chargingState: "CHARGING" | "READY" | "NO_CAR" | "COMPLETE" | "ERROR",
  powerTotalW: 0,
  powerL1W: 0,
  powerL2W: 0,
  powerL3W: 0,
  sessionEnergyKWh: 0,
  totalEnergyKWh: 0,
  chargingAllowed: true,
  currentA: 6
}
```

### 4.2 Normalized state -> Homey capability updates
Implement `WattpilotMapper.apply(device, state)`:
- `device.setCapabilityValue('measure_power', state.powerTotalW)`
- `device.setCapabilityValue('meter_power', state.totalEnergyKWh)` (if provided)
- `device.setCapabilityValue('onoff', state.chargingAllowed)` (if modeled)
- Availability transitions:
  - `device.setAvailable()` when connected
  - `device.setUnavailable("Connection lost")` when disconnected

### 4.3 Update thresholds (avoid spam)
Apply thresholds to updates:
- For `measure_power`: update if changed by ≥ 10W or every 30s
- For `meter_power`: update if changed by ≥ 0.01 kWh or every 5 min

---

## Step 5 — Control Commands (Local Only)

### 5.1 Write path pattern
Homey capability listener -> client command -> confirm via telemetry.

Example in `device.js`:
```js
this.registerCapabilityListener('onoff', async (value) => {
  await this.client.setChargingAllowed(value);
});
```

### 5.2 Safety and validation
- Clamp current to supported range (commonly 6–16A; make it configurable).
- Reject commands if device is unavailable (offline).
- Never block Homey’s main thread; all I/O must be async.

---

## Step 6 — Testing Checklist

### 6.1 Unit tests (offline)
- Parser: feed recorded message samples -> verify normalized fields
- Mapper: verify capability updates and thresholds

### 6.2 Integration tests (on Homey)
- Pair device by IP/hostname
- Verify:
  - device becomes available
  - `measure_power` updates while charging
  - `meter_power` increases monotonically (if implemented)
  - toggling `onoff` changes charger behavior (if supported)
  - reconnect occurs after power cycling Wattpilot/router

### 6.3 Negative cases
- Wrong IP/hostname -> device shows “Unavailable”
- Wrong password -> auth error surfaced cleanly
- Network drop -> reconnect + availability transitions

---

## Step 7 — Operational Hardening

### 7.1 Secrets and privacy
- Do not log host+password together
- Store secrets in device store; never in app settings if per-device

### 7.2 Multi-device support
- Support multiple Wattpilots: one `WattpilotClient` per device instance

### 7.3 Resource management
- Close WebSocket when device is deleted or app stops
- Backoff reconnect to avoid tight loops

---

## Deliverables for the Coding Agent
1. `WattpilotClient.js` implementing:
   - connect/auth
   - reconnect/backoff
   - message dispatch (parser + mapper)
   - command methods (`setChargingAllowed`, `setCurrentA`, `setMode`) stubbed if unknown
2. Driver + device implementation:
   - pairing with host/port/password
   - capability setup and listeners
3. Minimal capability definitions (if custom)
4. README with:
   - local-only setup instructions
   - troubleshooting (LAN reachability, hostname resolution, firewall/VLAN)

---

## Notes (Protocol Unknowns)
If the exact WebSocket URL/path, auth handshake, and message schemas are not yet confirmed:
- Implement the client with:
  - configurable WS path
  - a pluggable `authHandler`
  - a “raw message log” mode (redacting secrets) to capture real device traffic for schema discovery

This keeps the Homey app structure stable while you iteratively learn the local message formats.
