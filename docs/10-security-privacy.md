# Security & Privacy

## Secrets handling
- Never commit secrets to git.
- Never log secrets.
- Prefer token storage in Homey settings; encrypt where possible.
- Provide a “reset credentials” path in pairing/settings.

## Least privilege
- Request only the permissions required for your functionality.
- Restrict network access to required endpoints.

## Permissions & Web API exposure
- Avoid public API endpoints unless there is no alternative; keep routes protected by default.
- Apps on **Homey Cloud** are **not allowed** to expose a Web API.
- App-to-app communication requires `homey:app:<appId>` permissions and should check install/version compatibility.
- Avoid `homey:manager:api` unless your app’s primary purpose is full Homey control.

References:
- https://apps.developer.homey.app/advanced/web-api
- https://apps.developer.homey.app/the-basics/app/permissions

## Data minimization
- Store only what is required to operate.
- Avoid storing personal data unless needed.
- If you store personal data:
  - document what you store and why
  - provide a way to delete/reset

## Secure defaults
- Debug logging off by default.
- Conservative polling interval defaults.
- Validate all inbound data from APIs/devices.

## Update safety
- Ensure updates do not brick devices:
  - defensive coding around missing settings/store values
  - default values for new settings
  - avoid destructive migrations
