# CleverTouch Data Model

## Entity Hierarchy

```
┌─────────────────────────────────────────────────────────────────┐
│                         Account                                  │
│  ┌──────────────┐                                               │
│  │    email     │                                               │
│  │ refresh_token│                                               │
│  │ access_token │                                               │
│  └──────────────┘                                               │
│         │                                                        │
│         ▼                                                        │
│  ┌──────────────┐                                               │
│  │     User     │                                               │
│  │   user_id    │                                               │
│  └──────────────┘                                               │
│         │                                                        │
│         ▼ (1:many)                                              │
│  ┌──────────────────────────────────────────────────────┐       │
│  │                      Home                             │       │
│  │  ┌────────────┐  ┌────────────────────────────────┐  │       │
│  │  │  home_id   │  │         Zones[]                │  │       │
│  │  │   label    │  │  ┌─────────┐  ┌─────────┐     │  │       │
│  │  └────────────┘  │  │ Zone 1  │  │ Zone 2  │ ... │  │       │
│  │                   │  │ id/label│  │ id/label│     │  │       │
│  │                   │  └─────────┘  └─────────┘     │  │       │
│  │                   └────────────────────────────────┘  │       │
│  │         │                                             │       │
│  │         ▼ (1:many)                                    │       │
│  │  ┌────────────────────────────────────────────────┐  │       │
│  │  │                   Devices[]                     │  │       │
│  │  │  ┌──────────┐  ┌──────────┐  ┌──────────┐     │  │       │
│  │  │  │ Radiator │  │  Light   │  │  Outlet  │     │  │       │
│  │  │  └──────────┘  └──────────┘  └──────────┘     │  │       │
│  │  └────────────────────────────────────────────────┘  │       │
│  └──────────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────────┘
```

---

## Entity Definitions

### Account

Root-level authentication context.

| Field | Type | Description |
|-------|------|-------------|
| `email` | string | User's email address |
| `access_token` | string | Short-lived API token |
| `refresh_token` | string | Long-lived token for refresh |
| `expires_at` | number | Token expiration timestamp |
| `model_id` | string | Brand identifier |
| `host` | string | API host for the brand |

---

### User

User account information.

| Field | Type | Description |
|-------|------|-------------|
| `user_id` | string | Unique user identifier |
| `email` | string | User's email |
| `homes` | Map<string, HomeInfo> | Home ID → HomeInfo mapping |

---

### Home

Smart home installation.

| Field | Type | Description |
|-------|------|-------------|
| `home_id` | string | Unique home identifier (smarthome_id) |
| `label` | string | User-assigned home name |
| `zones` | Map<string, ZoneInfo> | Zone ID → ZoneInfo mapping |
| `devices` | Map<string, Device> | Device ID → Device mapping |

---

### Zone

Room/area within a home.

| Field | Type | Description |
|-------|------|-------------|
| `id_local` | string | Zone number (num_zone) |
| `label` | string | Zone name (zone_label) |

---

### Device (Base)

Common device properties.

| Field | Type | Description |
|-------|------|-------------|
| `device_id` | string | Global unique ID |
| `id_local` | string | Local ID within home (e.g., "R1") |
| `device_type` | string | Type name (Radiator, Light, Outlet) |
| `device_type_id` | string | Type code (R, L, O) |
| `label` | string | User-assigned device name |
| `zone` | ZoneInfo | Zone the device belongs to |
| `home` | HomeInfo | Parent home reference |

---

### Radiator (extends Device)

Heating device with temperature control.

| Field | Type | Description |
|-------|------|-------------|
| `active` | boolean | True if currently heating |
| `heat_mode` | HeatMode | Current operating mode |
| `temp_type` | TempType | Current temperature control type |
| `temperatures` | Map<string, Temperature> | Temperature readings/setpoints |
| `boost_time` | number | Boost duration preset (seconds) |
| `boost_remaining` | number | Remaining boost time (seconds) |
| `modes` | string[] | Available heat modes |

#### Temperature Map Contents

| Key | Description | Writable |
|-----|-------------|----------|
| `current` | Current room temperature | No |
| `target` | Active target temperature | No |
| `comfort` | Comfort mode setpoint | Yes |
| `eco` | Eco mode setpoint | Yes |
| `frost` | Frost protection setpoint | Yes |
| `boost` | Boost mode setpoint | Yes |

---

### Temperature

Temperature value with unit handling.

| Field | Type | Description |
|-------|------|-------------|
| `device` | number | Value in device units (Celsius × 10) |
| `celsius` | number | Value in Celsius |
| `farenheit` | number | Value in Fahrenheit |
| `is_writable` | boolean | Can be modified |
| `name` | string | Temperature type name |

---

### OnOffDevice (extends Device)

Simple on/off controllable device.

| Field | Type | Description |
|-------|------|-------------|
| `is_on` | boolean | Current on/off state |

---

### Light (extends OnOffDevice)

Light device.

---

### Outlet (extends OnOffDevice)

Power outlet device.

---

## Enumerations

### HeatMode

| Value | API Value | Description |
|-------|-----------|-------------|
| `Off` | 0 | Device off |
| `Frost` | 1 | Frost protection |
| `Eco` | 2 | Energy saving |
| `Comfort` | 3 | Comfort temperature |
| `Program` | 4 | Schedule mode |
| `Boost` | 5 | Temporary boost |

### TempType

| Value | API Field | Description |
|-------|-----------|-------------|
| `current` | sonde_temperature | Measured temperature |
| `comfort` | consigne_confort | Comfort setpoint |
| `eco` | consigne_eco | Eco setpoint |
| `frost` | consigne_hg | Frost protection setpoint |
| `boost` | consigne_boost | Boost setpoint |
| `target` | (computed) | Active target |
| `none` | - | No temperature control |

### TempUnit

| Value | Description |
|-------|-------------|
| `device` | Internal units (Celsius × 10) |
| `celsius` | Degrees Celsius |
| `farenheit` | Degrees Fahrenheit |

### DeviceType

| Value | ID Code | Description |
|-------|---------|-------------|
| `Radiator` | R | Heating radiator |
| `Light` | L | Light fixture |
| `Outlet` | O | Power outlet |
| `Unknown` | ? | Unknown type |

---

## Temperature Constraints

| Property | Value |
|----------|-------|
| Minimum | 5°C |
| Maximum | 30°C |
| Step | 0.5°C |
| Precision | 0.1°C |
| Native Unit | Celsius |

---

## Relationships

```
Account ─────1:1────▶ User
User ────────1:N────▶ Home (via homes map)
Home ────────1:N────▶ Zone (via zones map)
Home ────────1:N────▶ Device (via devices map)
Device ──────N:1────▶ Zone (device.zone)
Device ──────N:1────▶ Home (device.home)
Radiator ────1:N────▶ Temperature (via temperatures map)
```

---

## ID Patterns

### Home ID
- Format: Alphanumeric string
- Source: `smarthome_id` field in API
- Example: `"abc123def456"`

### Device ID
- Format: Alphanumeric string  
- Source: `id` field in API
- Example: `"device_789xyz"`

### Device Local ID
- Format: Type code + number
- Source: `id_device` field in API
- Pattern: `[RLO][0-9]+`
- Examples: `"R1"`, `"R2"`, `"L1"`, `"O1"`

### Zone ID
- Format: Numeric string
- Source: `num_zone` field in API
- Examples: `"1"`, `"2"`, `"3"`

---

## Unique Identifier Strategy for Homey

For Homey device pairing, construct unique IDs:

```javascript
// Device unique ID
const deviceUniqueId = `${modelId}_${deviceId}`;
// Example: "purmo_device_789xyz"

// Home unique ID  
const homeUniqueId = `${modelId}_${homeId}`;
// Example: "purmo_abc123def456"

// Entity unique ID (for capabilities)
const entityUniqueId = `${modelId}_${deviceId}_${capabilityKey}`;
// Example: "purmo_device_789xyz_target_temperature"
```
