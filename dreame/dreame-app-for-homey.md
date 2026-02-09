# Dreame Robot Vacuum — Homey App Implementation Plan
_Date: 2026-02-09_

> **Scope**: Dreame robot vacuums only · EU region only (hardcoded `de`) · No maps in v1 · Cloud-only (no local miio)

## Critical correction

The previous version of this document described a **non-existent** Dreame-specific HTTP API (`dreame.tech:13267`). That API path does not exist in the current Tasshack/dreame-vacuum HA integration. Dreame vacuums are **Xiaomi ecosystem devices** controlled through the **Xiaomi MiOT Cloud API** at `api.io.mi.com`. Authentication is a 3-step Xiaomi account login (cookie-based with `serviceToken` + `ssecurity`), and all requests use **RC4 encryption** with HMAC-SHA256 signatures.

Reference: `custom_components/dreame_vacuum/dreame/protocol.py` — class `DreameVacuumCloudProtocol`

---

## 1) Authentication — Xiaomi Cloud 3-step login

### 1.1 Client ID generation
Random 16 lowercase ASCII letters:
```
clientId = 16 random chars from a-z
```

### 1.2 Session cookies (set before login)
```
sdkVersion = "3.8.6"     (domain: mi.com AND xiaomi.com)
deviceId   = {clientId}   (domain: mi.com AND xiaomi.com)
```

### 1.3 Step 1 — Get sign token
- **GET** `https://account.xiaomi.com/pass/serviceLogin?sid=xiaomiio&_json=true`
- **Cookie**: `deviceId: {clientId}`
- **Headers**: `User-Agent: Android-7.1.1-1.0.0-ONEPLUS A3010-136-{clientId} APP/xiaomi.smarthome APPV/62830`
- **Response** (strip `&&&START&&&` prefix, parse JSON):
  - `_sign` — needed for step 2
  - If `code == 0`: also `userId`, `ssecurity`, `location` (session still valid, skip to step 3)

### 1.4 Step 2 — Authenticate with credentials
- **POST** `https://account.xiaomi.com/pass/serviceLoginAuth2`
- **Content-Type**: `application/x-www-form-urlencoded`
- **Params**: `_json=true`
- **Body**:
  ```
  user     = <username>
  hash     = MD5(password).toUpperCase()     ← no salt, just MD5 of plain password
  callback = https://sts.api.io.mi.com/sts
  sid      = xiaomiio
  qs       = %3Fsid%3Dxiaomiio%26_json%3Dtrue
  _sign    = <from step 1>
  ```
- **Response** (strip `&&&START&&&`, parse JSON):
  - `location` — URL for step 3
  - `userId` — numeric user ID
  - `ssecurity` — base64-encoded security key
  - `notificationUrl` — present if 2FA is required (not supported in v1)
  - `captchaUrl` — present if CAPTCHA required (not supported in v1)

### 1.5 Step 3 — Get service token
- **GET** `{location from step 2}`
- **Extract** `serviceToken` from response cookies
- **Build `authKey`**: `"{serviceToken} {ssecurity} {userId} {clientId}"`
- Store `authKey` in `this.homey.settings` for session restoration across restarts

### 1.6 Session restoration
On restart, parse stored `authKey` → restore `serviceToken`, `ssecurity`, `userId`, `clientId`. Then call `check_login` (see §2.4) — if session is still valid, skip full re-login.

---

## 2) Cloud API endpoints

### 2.1 Base URL
```
https://de.api.io.mi.com/app      ← EU (hardcoded for v1)
```
General pattern: `https://{country}.api.io.mi.com/app` (CN uses `https://api.io.mi.com/app`)

### 2.2 Request format (all API calls)

All requests use RC4 encryption. For each call:

1. Generate `nonce` (8 random bytes + timestamp-based bytes, base64-encoded)
2. Compute `signedNonce = base64(SHA-256(base64decode(ssecurity) + base64decode(nonce)))`
3. Convert `params` dict to `{data: JSON.stringify(params)}` form
4. Compute `rc4_hash__` signature of params
5. RC4-encrypt each param value using `signedNonce` as key
6. Compute final `signature` of encrypted params
7. Append `ssecurity`, `_nonce` to form data
8. POST with encrypted form data; decrypt response with RC4

**Headers** (all API calls):
```
User-Agent: Android-7.1.1-1.0.0-ONEPLUS A3010-136-{clientId} APP/xiaomi.smarthome APPV/62830
Accept-Encoding: identity
x-xiaomi-protocal-flag-cli: PROTOCAL-HTTP2       ← note: typo "protocal" is intentional
content-type: application/x-www-form-urlencoded
MIOT-ENCRYPT-ALGORITHM: ENCRYPT-RC4
```

**Cookies** (all API calls):
```
userId              = {userId}
yetAnotherServiceToken = {serviceToken}
serviceToken        = {serviceToken}
locale              = {system locale}
timezone            = GMT+HH:MM
is_daylight         = 0 or 1
dst_offset          = DST offset in ms
channel             = MI_APP_STORE
```

### 2.3 Device list
```
POST {baseUrl}/v2/homeroom/gethome
  params: { fg: true, fetch_share: true, fetch_share_dev: true, limit: 100, app_ver: 7 }
  → returns homes[]  (extract home IDs)

POST {baseUrl}/v2/home/home_device_list
  params: { home_id: <id>, home_owner: <uid>, limit: 100, get_split_device: true, support_smart_home: true }
  → returns device_info[] per home

POST {baseUrl}/home/device_list
  params: { getVirtualModel: false, getHuamiDevices: 0 }
  → returns list[] (fallback/additional devices)
```

Filter devices where `model` starts with `dreame.vacuum.`.

Device fields needed: `did`, `mac`, `model`, `token`, `localip`, `name`

### 2.4 Check login validity
```
POST {baseUrl}/v2/message/v2/check_new_msg
  params: { begin_at: <unix_timestamp - 60> }
  → if response.code in [2, 3] or message contains "auth err" / "SERVICETOKEN_EXPIRED" → re-login
```

### 2.5 Device RPC (read properties / send commands)
```
POST {baseUrl}/v2/home/rpc/{did}
  params: { method: "<method>", params: <parameters> }
```

**Methods**:
| Method | Purpose | Params format |
|--------|---------|---------------|
| `get_properties` | Read device properties | `[{did, siid, piid}, ...]` (max 15 per call) |
| `set_properties` | Write device properties | `[{did, siid, piid, value}]` |
| `action` | Execute device actions | `{did, siid, aiid, in: [{piid, value}, ...]}` |

---

## 3) MiOT property & action mappings

All Dreame vacuum control uses the MiOT standard (SIID = Service ID, PIID = Property ID, AIID = Action ID).

### 3.1 Core properties (for polling)

| Property | SIID | PIID | Type | Notes |
|----------|------|------|------|-------|
| STATE | 2 | 1 | int | 1=Sweeping 2=Idle 3=Paused 4=Error 5=Returning 6=Charging 7=Mopping 12=SweepAndMop 13=ChargeComplete |
| ERROR | 2 | 2 | int | Error code (0 = no error) |
| BATTERY_LEVEL | 3 | 1 | int | 0-100% |
| CHARGING_STATUS | 3 | 2 | int | 1=Charging 2=NotCharging 3=Complete 5=ReturnToCharge |
| STATUS | 4 | 1 | int | 0=Idle 1=Paused 2=Cleaning 3=BackHome 6=Charging 18=SegmentClean |
| CLEANING_TIME | 4 | 2 | int | Current clean duration (minutes) |
| CLEANED_AREA | 4 | 3 | int | Current cleaned area (m²) |
| SUCTION_LEVEL | 4 | 4 | int | 0=Quiet 1=Standard 2=Strong 3=Turbo |
| WATER_VOLUME | 4 | 5 | int | Water flow level |
| CLEANING_MODE | 4 | 23 | int | Sweep/Mop/Both |
| TASK_STATUS | 4 | 7 | int | 0=Completed 1=AutoCleaning ... |

### 3.2 Consumable properties

| Property | SIID | PIID | Notes |
|----------|------|------|-------|
| MAIN_BRUSH_LEFT | 9 | 2 | % remaining |
| SIDE_BRUSH_LEFT | 10 | 2 | % remaining |
| FILTER_LEFT | 11 | 1 | % remaining |
| TOTAL_CLEANING_TIME | 12 | 2 | Lifetime total |
| CLEANING_COUNT | 12 | 3 | Lifetime count |
| TOTAL_CLEANED_AREA | 12 | 4 | Lifetime total m² |

### 3.3 Actions

| Action | SIID | AIID | Description | Params |
|--------|------|------|-------------|--------|
| START | 2 | 1 | Start/resume cleaning | none |
| PAUSE | 2 | 2 | Pause cleaning | none |
| CHARGE | 3 | 1 | Return to dock | none |
| STOP | 4 | 2 | Stop cleaning | none |
| LOCATE | 7 | 1 | Play locate sound | none |

### 3.4 State enums

**DreameVacuumState** (SIID:2 PIID:1):

| Value | State |
|-------|-------|
| 1 | Sweeping |
| 2 | Idle |
| 3 | Paused |
| 4 | Error |
| 5 | Returning |
| 6 | Charging |
| 7 | Mopping |
| 8 | Drying |
| 9 | Washing |
| 12 | Sweeping and Mopping |
| 13 | Charging Completed |

**DreameVacuumSuctionLevel** (SIID:4 PIID:4):

| Value | Level |
|-------|-------|
| 0 | Quiet |
| 1 | Standard |
| 2 | Strong |
| 3 | Turbo |

---

## 4) RC4 encryption implementation

This is the most complex part. Port directly from the HA integration's Python code.

### 4.1 Nonce generation
```javascript
function generateNonce() {
  const millis = Date.now();
  const buf = Buffer.alloc(12);
  // 8 random bytes (signed 64-bit equivalent)
  crypto.randomFillSync(buf, 0, 8);
  // Append minutes-since-epoch
  const minutes = Math.floor(millis / 60000);
  buf.writeUInt32BE(minutes, 8);
  return buf.toString('base64');
}
```

### 4.2 Signed nonce
```javascript
function signedNonce(ssecurity, nonce) {
  const hash = crypto.createHash('sha256');
  hash.update(Buffer.from(ssecurity, 'base64'));
  hash.update(Buffer.from(nonce, 'base64'));
  return hash.digest().toString('base64');
}
```

### 4.3 RC4 encrypt/decrypt
```javascript
function encryptRC4(key, data) {
  // Skip first 1024 bytes of keystream (same as Python: r.encrypt(bytes(1024)))
  const cipher = crypto.createCipheriv('rc4', Buffer.from(key, 'base64'), '');
  cipher.update(Buffer.alloc(1024));  // discard first 1024 bytes
  return cipher.update(data, 'utf8', 'base64');
}

function decryptRC4(key, data) {
  const decipher = crypto.createDecipheriv('rc4', Buffer.from(key, 'base64'), '');
  decipher.update(Buffer.alloc(1024));  // discard first 1024 bytes
  return decipher.update(Buffer.from(data, 'base64'));
}
```

### 4.4 Signature generation
```javascript
function generateEncSignature(url, method, signedNonce, params) {
  const signArr = [url.split('com/app/')[1] || url, signedNonce, method];
  for (const [k, v] of Object.entries(params).sort()) {
    signArr.push(`${k}=${v}`);
  }
  const signStr = signArr.join('&');
  return crypto.createHmac('sha256', Buffer.from(signedNonce, 'base64'))
    .update(signStr).digest().toString('base64');
}
```

### 4.5 Full encrypted request flow
```javascript
function generateEncParams(url, method, signedNonce, nonce, params, ssecurity) {
  params['rc4_hash__'] = generateEncSignature(url, method, signedNonce, params);
  for (const [k, v] of Object.entries(params)) {
    params[k] = encryptRC4(signedNonce, v);
  }
  params['signature'] = generateEncSignature(url, method, signedNonce, params);
  params['ssecurity'] = ssecurity;
  params['_nonce'] = nonce;
  return params;
}
```

---

## 5) Homey app architecture

### 5.1 Why NOT `homey-oauth2app`

Xiaomi Cloud uses cookie-based 3-step login with RC4 encryption — not OAuth2. The auth flow has no authorization URL, no client_id/secret, no standard token endpoint. Forcing it into the OAuth2 framework would require overriding every method. Use plain Homey SDK with a custom `MiCloudClient`.

### 5.2 File structure

```
dreame-app/
├── app.js                              # extends Homey.App — creates shared MiCloudClient
├── app.json                            # generated from .homeycompose
├── package.json                        # node-fetch ^2.6.9 (no homey-oauth2app)
├── .homeycompose/
│   ├── app.json                        # id: tech.dreame.vacuum, sdk:3, platforms:["local"]
│   ├── capabilities/
│   │   ├── dreame_status.json          # enum: idle/sweeping/mopping/paused/returning/charging/error/...
│   │   ├── dreame_fan_speed.json       # enum: quiet/standard/strong/turbo (setable)
│   │   ├── dreame_clean_mode.json      # enum: sweeping/mopping/sweeping_and_mopping (setable)
│   │   └── dreame_water_flow.json      # enum: low/medium/high (setable)
│   └── flow/
│       ├── triggers/                   # cleaning_started, cleaning_finished, error_occurred, returned_to_dock
│       ├── conditions/                 # is_cleaning, is_charging, fan_speed_is
│       └── actions/                    # start_cleaning, stop_cleaning, pause, return_to_dock, set_fan_speed, locate
├── lib/
│   ├── MiCloudClient.js                # Xiaomi Cloud auth + RC4 encrypted RPC
│   └── MiOTProperties.js              # SIID/PIID/AIID constants + state enums
├── drivers/
│   └── vacuum/
│       ├── device.js                   # extends Homey.Device — polling + capability listeners
│       ├── driver.js                   # extends Homey.Driver — pairing flow
│       ├── driver.compose.json         # class: vacuumcleaner, capabilities, pair steps
│       └── assets/icon.svg
├── locales/
│   ├── en.json
│   └── fi.json
└── assets/
    └── icon.svg                        # 960×960 transparent SVG
```

### 5.3 `app.js` — shared cloud client

```javascript
const Homey = require('homey');
const MiCloudClient = require('./lib/MiCloudClient');

class DreameApp extends Homey.App {
  async onInit() {
    this.miCloud = new MiCloudClient(this.homey);
    // Restore session from settings if available
    const authKey = this.homey.settings.get('authKey');
    if (authKey) {
      await this.miCloud.restoreSession(authKey);
    }
    this._registerFlowCards();
  }
}
```

All devices under one Xiaomi account share one `MiCloudClient` instance via `this.homey.app.miCloud`. This avoids redundant auth calls and matches how the HA integration works.

### 5.4 `lib/MiCloudClient.js` — core implementation

Responsibilities:
- 3-step Xiaomi login (§1)
- RC4 encrypted requests (§4)
- `getDevices()` → list homes, list devices per home, filter `dreame.vacuum.*`
- `getProperties(did, [{siid, piid}, ...])` → batched `get_properties` (max 15 per call)
- `setProperty(did, siid, piid, value)` → `set_properties`
- `callAction(did, siid, aiid, params)` → `action`
- `checkLogin()` → verify session via `v2/message/v2/check_new_msg`
- Retry with backoff (3 attempts, linear backoff + 0-500ms jitter)
- AbortController timeout (10s per request)
- Auto re-login on expired session
- Store/restore `authKey` in `this.homey.settings`

### 5.5 `drivers/vacuum/driver.js` — pairing

Pairing flow in `driver.compose.json`:
```json
[
  { "id": "login_credentials", "template": "login_credentials" },
  { "id": "list_devices", "template": "list_devices" },
  { "id": "add_devices", "template": "add_devices" }
]
```

On `login` event: call `this.homey.app.miCloud.login(username, password)`.
On `list_devices`: call `getDevices()`, filter `dreame.vacuum.*`, return:
```javascript
{ name, data: { id: did, mac, model }, store: { token, localIp, uid } }
```

### 5.6 `drivers/vacuum/device.js` — runtime

**Capabilities** (in `driver.compose.json`):
- Standard: `onoff`, `measure_battery`
- Custom: `dreame_status`, `dreame_fan_speed`, `dreame_clean_mode`, `dreame_water_flow`

**`onInit()`**:
- Register capability listeners:
  - `onoff` → `true` calls START action (2,1), `false` calls STOP action (4,2)
  - `dreame_fan_speed` → `set_properties` for SUCTION_LEVEL (4,4)
  - `dreame_clean_mode` → `set_properties` for CLEANING_MODE (4,23)
  - `dreame_water_flow` → `set_properties` for WATER_VOLUME (4,5)
- Start polling with jitter: random 0-20s initial delay

**`poll()`**:
- `getProperties()` for: STATE(2,1), ERROR(2,2), BATTERY_LEVEL(3,1), CHARGING_STATUS(3,2), STATUS(4,1), SUCTION_LEVEL(4,4), CLEANING_MODE(4,23), WATER_VOLUME(4,5), CLEANED_AREA(4,3), CLEANING_TIME(4,2)
- Map values to capabilities using `_updateCapability()` (only update when changed)
- Map STATE int → `dreame_status` enum string
- Map SUCTION_LEVEL int → `dreame_fan_speed` enum string

**Polling intervals**:
- 120s normal
- 15s quick-poll (×5) after user-initiated commands

**Fail-soft**:
- After 3 consecutive poll failures: `setUnavailable("Cannot reach device")`
- On recovery: `setAvailable()`

**`onUninit()`**:
- Clear all timers via `this.homey.clearInterval()` / `this.homey.clearTimeout()`

### 5.7 Custom capabilities

**`dreame_status`** (read-only enum):
```json
{
  "type": "enum",
  "title": { "en": "Status" },
  "getable": true,
  "setable": false,
  "uiComponent": "sensor",
  "values": [
    { "id": "idle", "title": { "en": "Idle" } },
    { "id": "sweeping", "title": { "en": "Sweeping" } },
    { "id": "mopping", "title": { "en": "Mopping" } },
    { "id": "sweeping_and_mopping", "title": { "en": "Sweeping & Mopping" } },
    { "id": "paused", "title": { "en": "Paused" } },
    { "id": "returning", "title": { "en": "Returning" } },
    { "id": "charging", "title": { "en": "Charging" } },
    { "id": "charging_completed", "title": { "en": "Charged" } },
    { "id": "error", "title": { "en": "Error" } },
    { "id": "drying", "title": { "en": "Drying" } },
    { "id": "washing", "title": { "en": "Washing" } }
  ]
}
```

**`dreame_fan_speed`** (setable enum):
```json
{
  "type": "enum",
  "title": { "en": "Fan Speed" },
  "getable": true,
  "setable": true,
  "uiComponent": "picker",
  "values": [
    { "id": "quiet", "title": { "en": "Quiet" } },
    { "id": "standard", "title": { "en": "Standard" } },
    { "id": "strong", "title": { "en": "Strong" } },
    { "id": "turbo", "title": { "en": "Turbo" } }
  ]
}
```

### 5.8 Flow cards

**Triggers**: `cleaning_started`, `cleaning_finished`, `error_occurred`, `returned_to_dock`
**Conditions**: `is_cleaning`, `is_charging`, `fan_speed_is` (dropdown arg)
**Actions**: `start_cleaning`, `stop_cleaning`, `pause_cleaning`, `return_to_dock`, `set_fan_speed` (dropdown arg), `set_clean_mode` (dropdown arg), `locate`

---

## 6) Key decisions

| Decision | Rationale |
|----------|-----------|
| **Plain Homey SDK** (no `homey-oauth2app`) | Xiaomi Cloud is cookie-based with RC4; not OAuth2. Manual session management is simpler. |
| **EU only** (hardcoded `de` country) | Simplifies v1. Country can become a pairing setting in v2. |
| **Shared `MiCloudClient`** instance | All devices share one auth session, avoids redundant logins. Matches HA integration pattern. |
| **RC4 via Node.js `crypto`** | `crypto.createCipheriv('rc4', key, '')` — built-in, no external dependency. |
| **No 2FA/CAPTCHA in v1** | Xiaomi may require these. Users must clear challenges via Mi Home app first, then retry pairing. |
| **Properties batched** ≤15 per call | Matches HA integration's batching limit for `get_properties`. |
| **No maps** | Homey has no map display. Skipped for v1. |

---

## 7) Verification

1. `homey app run` → pairing logs in with Xiaomi account, lists Dreame vacuums, adds device
2. Polling updates capability values (battery %, status, fan speed) on Homey device tile
3. `onoff` toggle → START/STOP RPC sent, quick-poll captures state change
4. Flow cards: "Start cleaning" action card triggers vacuum
5. Fail-soft: disconnect Wi-Fi briefly → device unavailable → reconnect → recovers
6. Restart persistence: `homey app install`, reboot → device reconnects using stored `authKey`

---

## 8) References

- HA integration source: [Tasshack/dreame-vacuum](https://github.com/Tasshack/dreame-vacuum)
  - Cloud protocol: `custom_components/dreame_vacuum/dreame/protocol.py` — class `DreameVacuumCloudProtocol`
  - Property/action mappings: `custom_components/dreame_vacuum/dreame/const.py`
  - Device logic: `custom_components/dreame_vacuum/dreame/device.py` — class `DreameVacuumDevice`
- Homey SDK conventions: see `./docs/` (especially `04-coding-guidelines.md`, `05-drivers-devices-capabilities.md`, `13-oauth2-cloud-devices.md`)

