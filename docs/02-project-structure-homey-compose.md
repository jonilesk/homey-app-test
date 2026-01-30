# Project Structure & Homey Compose

## Why Homey Compose
Homey Compose allows you to manage `app.json` as multiple source files (drivers, flow cards, capabilities, locales, etc.). Treat compose files as the source-of-truth and avoid manual edits to generated outputs.

## Recommended structure (common pattern)
```text
/
  app.js                              # App entry point (extends Homey.App)
  app.json                            # Root manifest (required, merged with compose)
  package.json                        # No homey dependency needed (runtime provides it)
  .homeycompose/
    app.json                          # App manifest source (id, version, permissions, etc.)
    flow/                             # App-level flow cards (optional)
      triggers/
      conditions/
      actions/
  .homeybuild/                        # Generated output (gitignore this)
  drivers/
    <driver_id>/
      driver.js                       # Pairing logic
      device.js                       # Device runtime logic
      driver.compose.json             # Driver manifest (name, capabilities, settings, pair)
      assets/
        icon.svg                      # Driver icon (transparent background)
        images/                       # PNG images for App Store (optional)
          small.png                   # 75x75
          large.png                   # 500x500
  assets/
    icon.svg                          # App icon (960x960 canvas, transparent)
    images/                           # PNG images for App Store (optional)
      small.png                       # 250x175
      large.png                       # 500x350
  locales/
    en.json                           # English translations (required)
    fi.json                           # Additional locales (optional)
```

**Key learnings:**
- Driver compose files go in `drivers/<driver_id>/driver.compose.json` (not `.homeycompose/drivers/`)
- Root `app.json` is required and merged with `.homeycompose/app.json`
- Don't add `homey` as a dependency in `package.json` - the runtime provides it
- `.homeybuild/` is generated output - add to `.gitignore`

Notes:
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
- `package.json` exists (do NOT include `homey` as a dependency)
- `app.json` exists at root with at least `id`, `version`, `compatibility`, `sdk`
- `.homeycompose/app.json` exists with full app metadata
- `app.js` exists and exports class extending `Homey.App`
- Driver folders exist with `driver.compose.json` for each declared driver
- Driver folders contain `driver.js` and `device.js`
- Icons exist: `assets/icon.svg` and `drivers/<id>/assets/icon.svg`
- Run `homey app validate --level debug` to catch issues early
