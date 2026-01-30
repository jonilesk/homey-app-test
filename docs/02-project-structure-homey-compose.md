# Project Structure & Homey Compose

## Why Homey Compose
Homey Compose allows you to manage `app.json` as multiple source files (drivers, flow cards, capabilities, locales, etc.). Treat compose files as the source-of-truth and avoid manual edits to generated outputs.

## Recommended structure (common pattern)
```text
/
  app.js
  package.json
  .homeycompose/
    app.json
    drivers/
      <driver_id>.json
    flow/
      triggers/
      conditions/
      actions/
  drivers/
    <driver_id>/
      driver.js
      device.js
      assets/
      pairing/
        views/
        assets/
``

Notes:
- Some projects keep driver manifests exclusively in `.homeycompose/` and runtime logic in `drivers/<driver_id>/`.
- Keep IDs stable: renaming a `driver_id` or capability can break existing users.

## Naming conventions
- App ID: reverse-domain style (e.g., `com.example.myapp`)
- Driver IDs: short, stable (e.g., `thermostat_v1`, `meter`)
- Capability IDs: prefer standard Homey capability IDs where available (avoid custom unless necessary).

## Localization
- Keep user-facing strings localized (e.g., `en`, `fi`).
- For flow card titles and device names, prefer concise language.

## Source of truth rules
- Compose files (`.homeycompose/**`) are authoritative.
- Runtime logic lives in code (`app.js`, `drivers/**`).
- Do not duplicate configuration in multiple places; pick one canonical location.

## Manifest essentials (for REST/API apps)
- The **App Manifest** is generated from `.homeycompose/app.json` and other compose files.
- Key fields to define and keep accurate:
  - `id`, `version`, `sdk`, `platforms`, `name`, `description`, `category`, `permissions`.
- Only request permissions you truly need. Avoid `homey:manager:api` unless full Homey control is core functionality.
- App-to-app API access requires `homey:app:<appId>` permissions.

References:
- https://apps.developer.homey.app/the-basics/app
- https://apps.developer.homey.app/the-basics/app/manifest
- https://apps.developer.homey.app/the-basics/app/permissions

## Checklist before first run
- `package.json` contains required dependencies
- `app.js` exists and exports/initializes Homey.App (SDK style)
- Driver folders exist for any declared drivers
- Any pairing UI assets are included and referenced correctly
