# CleverTouch Python Library Analysis

## Overview

The `clevertouch` Python library (https://github.com/hemphen/clevertouch) provides both low-level and high-level APIs for interacting with CleverTouch cloud services.

---

## Module Structure

```
clevertouch/
├── __init__.py          # Exports: ApiError, ApiSession, Account, Home, User
├── api.py               # Low-level API session and HTTP calls
├── objects.py           # High-level objects: Account, Home, User
├── info.py              # Data classes: HomeInfo, ZoneInfo
├── util.py              # Utilities: ApiError, StrEnum
└── devices/
    ├── __init__.py
    ├── const.py         # Device type constants
    ├── device.py        # Base Device class
    ├── factory.py       # Device factory
    ├── radiator.py      # Radiator device with temperatures, modes
    └── onoff.py         # OnOffDevice, Light, Outlet
```

---

## Key Classes

### ApiSession (api.py)

Low-level HTTP client for API communication.

**Key Properties**:
```python
class ApiSession:
    API_LANG = "en_GB"
    API_PATH = "/api/v0.1/"
    CLIENT_ID = "app-front"
    
    # Constructed URLs
    _token_url = f"https://auth.{host}/realms/{manufacturer}/protocol/openid-connect/token"
    _api_base = f"https://{host}{API_PATH}"
    
    # Token state
    email: str
    access_token: str
    refresh_token: str
    expires_at: float  # Unix timestamp
```

**Key Methods**:
```python
async def authenticate(email: str, password: str) -> None
async def refresh_openid() -> None
async def read_user_data() -> dict
async def read_home_data(home_id: str) -> dict
async def write_query(home_id: str, query_params: dict) -> ApiResult
```

---

### Account (objects.py)

High-level account representation.

```python
class Account:
    api: ApiSession
    email: str
    user: User | None
    homes: dict[str, Home]
    
    async def authenticate(email: str, password: str) -> None
    async def get_user() -> User
    async def get_home(home_id: str) -> Home
    async def get_homes() -> list[Home]
    async def close() -> None
```

---

### User (objects.py)

User information with home list.

```python
class User:
    user_id: str
    email: str
    homes: dict[str, HomeInfo]  # home_id -> HomeInfo
    
    async def refresh() -> None
```

---

### Home (objects.py)

Represents a smart home installation.

```python
class Home:
    home_id: str
    info: HomeInfo
    devices: dict[str, Device]  # device_id -> Device
    
    async def refresh() -> None
```

---

### HomeInfo (info.py)

Basic home information.

```python
class HomeInfo:
    home_id: str
    label: str
    zones: dict[str, ZoneInfo]  # zone_id -> ZoneInfo
```

---

### ZoneInfo (info.py)

Zone (room) information.

```python
class ZoneInfo:
    id_local: str  # "num_zone"
    label: str     # "zone_label"
```

---

### Device (devices/device.py)

Base class for all devices.

```python
class Device:
    device_type: str
    device_id: str           # Global unique ID
    id_local: str            # Local ID (e.g., "R1")
    device_type_id: str
    label: str               # User name
    zone: ZoneInfo
    home: HomeInfo
    
    def update(data: dict) -> None
```

---

### Radiator (devices/radiator.py)

Radiator/heater device with temperature control.

```python
class Radiator(Device):
    active: bool                    # Currently heating
    heat_mode: str                  # HeatMode enum value
    temp_type: str                  # Current temperature type
    temperatures: dict[str, Temperature]
    boost_time: int                 # Boost duration preset (seconds)
    boost_remaining: int | None     # Remaining boost time
    modes: list[str]                # Available heat modes
    
    async def set_temperature(temp_type: str, temp_value: float, unit: str) -> None
    async def set_heat_mode(heat_mode: str) -> None
    async def set_boost_time(boost_time: int) -> None
    async def activate_mode(
        heat_mode: str,
        temp_value: float = None,
        temp_unit: str = None,
        boost_time: int = None
    ) -> None
```

**Heat Modes** (HeatMode enum):
```python
class HeatMode(StrEnum):
    COMFORT = "Comfort"
    ECO = "Eco"
    FROST = "Frost"
    PROGRAM = "Program"
    BOOST = "Boost"
    OFF = "Off"
```

**Temperature Types** (TempType enum):
```python
class TempType(StrEnum):
    COMFORT = "comfort"
    ECO = "eco"
    FROST = "frost"
    BOOST = "boost"
    CURRENT = "current"
    TARGET = "target"
    NONE = "none"
```

**Mode to Device Value Mapping**:
```python
_HEAT_MODE_TO_DEVICE = {
    HeatMode.OFF: 0,
    HeatMode.FROST: 1,
    HeatMode.ECO: 2,
    HeatMode.COMFORT: 3,
    HeatMode.PROGRAM: 4,
    HeatMode.BOOST: 5,
}
```

**Temperature Field Mapping**:
```python
_TEMP_TYPE_TO_DEVICE = {
    TempType.CURRENT: "sonde_temperature",
    TempType.COMFORT: "consigne_confort",
    TempType.ECO: "consigne_eco",
    TempType.FROST: "consigne_hg",
    TempType.BOOST: "consigne_boost",
}
```

---

### Temperature (devices/radiator.py)

Temperature value with unit conversion.

```python
class Temperature:
    device: float | None     # Device units (Celsius * 10)
    celsius: float | None
    farenheit: float | None
    is_writable: bool
    name: str
    
    def as_unit(unit: str) -> float | None
    @classmethod
    def convert(temperature: float, from_unit: str, to_unit: str) -> float
```

**Temperature Units** (TempUnit enum):
```python
class TempUnit(StrEnum):
    DEVICE = "device"
    CELSIUS = "celsius"
    FARENHEIT = "farenheit"
```

---

### OnOffDevice (devices/onoff.py)

Simple on/off controllable device.

```python
class OnOffDevice(Device):
    is_on: bool
    
    async def set_onoff_state(turn_on: bool) -> None

class Light(OnOffDevice):
    pass

class Outlet(OnOffDevice):
    pass
```

---

### Device Type Constants (devices/const.py)

```python
class DeviceType(StrEnum):
    RADIATOR = "Radiator"
    LIGHT = "Light"
    OUTLET = "Outlet"
    UNKNOWN = "Unknown"

class DeviceTypeId(StrEnum):
    RADIATOR = "R"
    LIGHT = "L"
    OUTLET = "O"
    UNDEFINED = "?"
```

---

## Device Factory

```python
def create_device(session: ApiSession, home: HomeInfo, data: dict) -> Device:
    device_type_id = str(data.get("id_device", "?")[0])
    if device_type_id == "R":
        return Radiator(session, home, data)
    elif device_type_id == "L":
        return Light(session, home, data)
    elif device_type_id == "O":
        return Outlet(session, home, data)
    else:
        return Device(session, home, data, "Unknown", device_type_id)
```

---

## Usage Example (from demo.py)

```python
import asyncio
from clevertouch import Account

async def main():
    account = Account(email, token, host="e3.lvi.eu")
    
    # Or authenticate with password
    await account.authenticate(email, password)
    
    # Get user and homes
    user = await account.get_user()
    for home_id, home_info in user.homes.items():
        home = await account.get_home(home_id)
        
        for device_id, device in home.devices.items():
            if isinstance(device, Radiator):
                print(f"Temp: {device.temperatures['current'].celsius}°C")
                print(f"Mode: {device.heat_mode}")
                
                # Set temperature
                await device.set_temperature("comfort", 22.0, "celsius")
                
                # Set mode
                await device.set_heat_mode("Eco")
    
    await account.close()
```

---

## Key Takeaways for Homey Implementation

1. **Authentication**: Use OAuth2 password grant, store refresh_token
2. **Hierarchy**: Account → User → Homes → Devices
3. **Device Types**: Radiator (main), Light, Outlet
4. **Temperature Units**: Always convert between device units (×10) and Celsius
5. **Heat Modes**: Off, Frost, Eco, Comfort, Program, Boost
6. **Write Operations**: Use `write_query()` with specific parameters
7. **Refresh**: Call `home.refresh()` to update device states
