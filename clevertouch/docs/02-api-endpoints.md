# CleverTouch API Endpoints

## Base URL

```
https://{host}/api/v0.1/
```

Where `{host}` is brand-specific (e.g., `e3.lvi.eu` for Purmo).

---

## Authentication Header

All API calls require Bearer token authentication:

```http
Authorization: Bearer {access_token}
```

---

## Endpoints

### 1. Read User Data

**Purpose**: Get user information and list of homes

**Endpoint**: `POST /human/user/read/`

**Request**:
```http
POST https://e3.lvi.eu/api/v0.1/human/user/read/
Authorization: Bearer {access_token}
Content-Type: application/x-www-form-urlencoded

email={user_email}
```

**Response**:
```json
{
  "code": {
    "code": 1,
    "key": "success",
    "value": "OK"
  },
  "data": {
    "user_id": "12345",
    "smarthomes": [
      {
        "smarthome_id": "home_123",
        "label": "My Home"
      }
    ]
  },
  "parameters": {}
}
```

**Key Fields**:
- `user_id` - Unique user identifier
- `smarthomes[]` - Array of homes
  - `smarthome_id` - Home identifier (used in other calls)
  - `label` - User-assigned home name

---

### 2. Read Home Data

**Purpose**: Get detailed information about a specific home, including all devices

**Endpoint**: `POST /human/smarthome/read/`

**Request**:
```http
POST https://e3.lvi.eu/api/v0.1/human/smarthome/read/
Authorization: Bearer {access_token}
Content-Type: application/x-www-form-urlencoded

smarthome_id={home_id}
```

**Response**:
```json
{
  "code": {
    "code": 1,
    "key": "success",
    "value": "OK"
  },
  "data": {
    "smarthome_id": "home_123",
    "label": "My Home",
    "general_mode": 0,
    "holiday_mode": 0,
    "zones": [
      {
        "num_zone": "1",
        "zone_label": "Living Room",
        "devices": [...]
      }
    ],
    "devices": [...]
  },
  "parameters": {}
}
```

**⚠️ CRITICAL: Data Source Selection**

The response contains devices in TWO places:
1. `data.devices[]` - Flat array (may contain **STALE/CACHED** data!)
2. `data.zones[].devices[]` - Nested in zones (**REAL-TIME** data!)

**Always use `zones[].devices[]` for current temperatures and status!**

```javascript
// WRONG: Using flat devices array (stale temperatures)
const devices = responseData.devices;

// CORRECT: Extract from zones for real-time data
const devices = [];
for (const zone of responseData.zones || []) {
  for (const device of zone.devices || []) {
    device._zoneName = zone.zone_label;
    devices.push(device);
  }
}
```

**Home-Level Mode Fields**:
- `general_mode` - Global mode override (0=none, 1-5=active mode)
- `holiday_mode` - Holiday mode status

When `general_mode` is 1-5, it overrides all device-level `gv_mode` values.

**Device Fields** (in `zones[].devices[]`):

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Global unique device ID |
| `id_device` | string | Local device ID (e.g., "R1") |
| `nom_appareil` | string | Device model name |
| `temperature_air` | int | Current temperature (**Fahrenheit × 10**) |
| `temperature_sol` | int | Floor temperature (**Fahrenheit × 10**) |
| `gv_mode` | string | Current mode (0-5, see below) |
| `nv_mode` | string | Target mode |
| `heating_up` | string | Heating status ("0" or "1") |
| `consigne_confort` | int | Comfort setpoint (**Fahrenheit × 10**) |
| `consigne_eco` | int | Eco setpoint (**Fahrenheit × 10**) |
| `consigne_hg` | int | Frost setpoint (**Fahrenheit × 10**) |
| `consigne_boost` | int | Boost setpoint (**Fahrenheit × 10**) |
| `puissance_app` | int | Device power rating (Watts) |
| `error_code` | int | Error code (0 = no error) |
| `time_boost` | int | Boost duration (seconds) |

**⚠️ Temperature Units:** All temperatures are in **Fahrenheit × 10**, NOT Celsius!
- API value 470 = 47.0°F = 8.3°C
- API value 680 = 68.0°F = 20.0°C

**Mode Values** (gv_mode/nv_mode):
| Value | Mode |
|-------|------|
| 0 | Off |
| 1 | Eco |
| 2 | Frost (Anti-Freeze) |
| 3 | Comfort |
| 4 | Program |
| 5 | Boost |

---

### 3. Write Query (Update Device)

**Purpose**: Update device settings (temperature, mode, etc.)

**Endpoint**: `POST /human/query/push/`

**Request**:
```http
POST https://e3.lvi.eu/api/v0.1/human/query/push/
Authorization: Bearer {access_token}
Content-Type: application/x-www-form-urlencoded

smarthome_id={home_id}
&context=1
&peremption=15000
&query[id_device]={device_local_id}
&query[gv_mode]={mode_value}
&query[nv_mode]={mode_value}
```

**Query Parameters**:

| Parameter | Description |
|-----------|-------------|
| `id_device` | Device local ID (e.g., "R1") |
| `gv_mode` | Current heat mode value |
| `nv_mode` | New heat mode value |
| `consigne_confort` | Comfort temperature (device units) |
| `consigne_eco` | Eco temperature (device units) |
| `consigne_hg` | Frost protection temperature |
| `consigne_boost` | Boost temperature |
| `time_boost` | Boost duration in seconds |
| `on_off` | On/off state ("0" or "1") |

**Response**:
```json
{
  "code": {
    "code": 8,
    "key": "write_success",
    "value": "OK"
  },
  "data": {},
  "parameters": {}
}
```

---

## Response Status Codes

| Code | Key | Meaning |
|------|-----|---------|
| 1 | success | Read operation successful |
| 8 | write_success | Write operation successful |
| Other | error | Operation failed |

---

## Device Data Fields

### Radiator Device

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Global unique device ID |
| `id_device` | string | Local device ID (e.g., "R1", "R2") |
| `label_interface` | string | User-assigned device name |
| `num_zone` | string | Zone number the device belongs to |
| `gv_mode` | string | Current heat mode (see mode values) |
| `heating_up` | string | "1" if actively heating, "0" if idle |
| `sonde_temperature` | string | Current temperature (device units) |
| `consigne_confort` | string | Comfort setpoint (device units) |
| `consigne_eco` | string | Eco setpoint (device units) |
| `consigne_hg` | string | Frost protection setpoint |
| `consigne_boost` | string | Boost setpoint |
| `time_boost` | string | Boost duration preset (seconds) |
| `time_boost_format_chrono` | object | Remaining boost time breakdown |

### On/Off Device (Light, Outlet)

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Global unique device ID |
| `id_device` | string | Local device ID |
| `label_interface` | string | Device name |
| `on_off` | string | "1" = on, "0" = off |

---

## Heat Mode Values

| Mode | gv_mode Value | Description |
|------|---------------|-------------|
| Off | 0 | Device turned off |
| Frost | 1 | Frost protection mode |
| Eco | 2 | Eco/energy saving mode |
| Comfort | 3 | Comfort mode |
| Program | 4 | Schedule/program mode |
| Boost | 5 | Temporary boost mode |

---

## Temperature Units

Temperatures in the API are stored in **device units** (internal representation).

**Conversion**:
- Device units = Celsius × 10
- Example: 21.5°C = 215 device units

```javascript
// To Celsius
const celsius = deviceUnits / 10;

// To device units
const deviceUnits = celsius * 10;
```

---

## Polling Strategy (from Home Assistant integration)

| Scenario | Interval |
|----------|----------|
| Normal polling | 180 seconds (3 minutes) |
| After setting change | 15 seconds |
| Quick poll count | 3 updates after change |
| Error backoff minimum | 60 seconds |
| Error backoff maximum | 1800 seconds (30 min) |

---

## Example: Complete Flow

```
1. Authenticate → get access_token
2. GET user data → get list of home IDs
3. For each home: GET home data → get devices
4. To update device: POST query/push with parameters
5. Poll every 180s for updates
```
