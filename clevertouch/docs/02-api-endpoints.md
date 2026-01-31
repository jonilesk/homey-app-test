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
    "zones": [
      {
        "num_zone": "1",
        "zone_label": "Living Room"
      }
    ],
    "devices": [
      {
        "id": "device_456",
        "id_device": "R1",
        "label_interface": "Radiator 1",
        "num_zone": "1",
        "gv_mode": "2",
        "heating_up": "0",
        "consigne_confort": "210",
        "consigne_eco": "180",
        "consigne_hg": "70",
        "consigne_boost": "250",
        "sonde_temperature": "195",
        "time_boost": "3600",
        "time_boost_format_chrono": {
          "d": "0",
          "h": "0",
          "m": "30",
          "s": "0"
        }
      }
    ]
  },
  "parameters": {}
}
```

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
