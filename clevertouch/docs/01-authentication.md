# Authentication & Token Management

## Overview

CleverTouch uses **OAuth2 with OpenID Connect** for authentication. The API is cloud-based and requires internet connectivity.

## Authentication Flow

### Initial Authentication (Password Grant)

```
User Input: email + password + brand
     │
     ▼
POST https://auth.{host}/realms/{manufacturer}/protocol/openid-connect/token
     │
     ▼
Response: access_token, refresh_token, expires_in
     │
     ▼
Store: refresh_token (for persistence)
```

### Token Refresh Flow

```
Stored: refresh_token
     │
     ▼
POST https://auth.{host}/realms/{manufacturer}/protocol/openid-connect/token
     │
     ▼
Response: new access_token, new refresh_token, expires_in
```

---

## API Endpoints

### Token URL Pattern
```
https://auth.{host}/realms/{manufacturer}/protocol/openid-connect/token
```

### Host/Manufacturer Mapping

| Brand | Host | Manufacturer (realm) |
|-------|------|---------------------|
| Purmo | e3.lvi.eu | purmo |
| Walter Meier | www.smartcomfort.waltermeier.com | waltermeier |
| Frico | fricopfsmart.frico.se | frico |
| Fenix | v24.fenixgroup.eu | fenix |
| Vogel & Noot | e3.vogelundnoot.com | vogelundnoot |
| Cordivari | cordivarihome.com | cordivari |

---

## Request Formats

### Password Authentication Request

```http
POST https://auth.e3.lvi.eu/realms/purmo/protocol/openid-connect/token
Content-Type: application/x-www-form-urlencoded

grant_type=password
&client_id=app-front
&username={email}
&password={password}
```

### Token Refresh Request

```http
POST https://auth.e3.lvi.eu/realms/purmo/protocol/openid-connect/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token
&client_id=app-front
&refresh_token={refresh_token}
```

---

## Response Format

### Successful Authentication

```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIsInR5cCIgOiAiSldUIiwia2lkIiA6IC...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCIgOiAiSldUIiwia2lkIiA6IC...",
  "expires_in": 300,
  "refresh_expires_in": 1800,
  "token_type": "Bearer",
  "not-before-policy": 0,
  "session_state": "...",
  "scope": "..."
}
```

### Error Response (401/400)

Authentication failure returns HTTP 401 or 400 status codes.

---

## Token Management Strategy

### Key Values

| Field | Description | Default |
|-------|-------------|---------|
| `access_token` | Bearer token for API calls | - |
| `refresh_token` | Token for obtaining new access tokens | - |
| `expires_in` | Access token validity in seconds | 300 (5 min) |

### Token Lifecycle

1. **Initial Login**: Store `refresh_token` persistently
2. **Before API Calls**: Check if token is expired
3. **Token Expired**: Call `refresh_openid()` to get new tokens
4. **Refresh Failed**: Re-authenticate with password (re-login flow)

### Expiration Check

```javascript
// Pseudocode
const isExpired = Date.now() / 1000 >= expiresAt;
if (isExpired) {
  await refreshToken();
}
```

---

## Homey Implementation Notes

### Storage Requirements

For Homey app, store in `this.homey.settings`:

```javascript
// On successful authentication
this.homey.settings.set('clevertouch_refresh_token', refreshToken);
this.homey.settings.set('clevertouch_email', email);
this.homey.settings.set('clevertouch_model', modelId);

// Access token can be in memory (short-lived)
this.accessToken = accessToken;
this.expiresAt = Date.now() + (expiresIn * 1000);
```

### Pairing Flow for Homey

1. User selects brand/model from dropdown
2. User enters email and password
3. App authenticates with OAuth2 password grant
4. Store refresh_token in settings
5. Discover homes and devices
6. Create Homey devices

### Re-authentication

When refresh token fails (e.g., after long period):
1. Show notification to user
2. Redirect to app settings for re-login
3. Use stored email, prompt for password again

---

## Security Considerations

1. **Never store password** - only refresh_token
2. **HTTPS only** - all communication encrypted
3. **Token rotation** - new refresh_token on each refresh
4. **Client ID** - fixed value `app-front` (public client)

---

## Error Handling

| HTTP Status | Meaning | Action |
|-------------|---------|--------|
| 200 | Success | Process tokens |
| 400 | Bad request | Check parameters |
| 401 | Unauthorized | Invalid credentials or token |
| 500 | Server error | Retry with backoff |

---

## Code Reference

From Python library `clevertouch/api.py`:

```python
# Token URL construction
self._token_url = (
    f"https://auth.{host}/realms/{manufacturer}/protocol/openid-connect/token"
)

# API base URL
self._api_base = f"https://{host}{self.API_PATH}"  # API_PATH = "/api/v0.1/"

# Client ID (fixed)
CLIENT_ID = "app-front"
```
