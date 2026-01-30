# Publishing to the Homey App Store

## Overview
This guide covers the requirements and process for publishing a Homey app to the official Homey App Store.

## Validation levels
Homey CLI provides validation levels to check app readiness:

| Level | Command | Purpose |
|-------|---------|---------|
| `debug` | `homey app validate --level debug` | Development testing |
| `publish` | `homey app validate --level publish` | Standard App Store submission |
| `verified` | `homey app validate --level verified` | Verified Developer certification |

Always validate before publishing:
```bash
homey app validate --level publish
```

## Required manifest fields

### Core requirements (`.homeycompose/app.json`)
```json
{
  "id": "com.example.myapp",
  "version": "1.0.0",
  "compatibility": ">=5.0.0",
  "sdk": 3,
  "platforms": ["local"],
  "name": { "en": "My App" },
  "description": { "en": "Short description of what the app does" },
  "category": ["climate"],
  "brandColor": "#0077B6",
  "images": {
    "small": "/assets/images/small.png",
    "large": "/assets/images/large.png",
    "xlarge": "/assets/images/xlarge.png"
  },
  "author": { "name": "Your Name" }
}
```

### Additional fields for verified apps
```json
{
  "support": "mailto:support@example.com",
  "bugs": { "url": "https://github.com/user/repo/issues" },
  "source": "https://github.com/user/repo",
  "homepage": "https://example.com",
  "contributors": {
    "developers": [{ "name": "Developer Name" }],
    "translators": [{ "name": "Translator Name" }]
  }
}
```

## Image requirements

### App images (`/assets/images/`)
| File | Dimensions | Notes |
|------|------------|-------|
| `small.png` | 250 × 175 px | Required |
| `large.png` | 500 × 350 px | Required |
| `xlarge.png` | 1000 × 700 px | Required |

### Driver images (`/drivers/<id>/assets/images/`)
| File | Dimensions | Notes |
|------|------------|-------|
| `small.png` | 75 × 75 px | Required |
| `large.png` | 500 × 500 px | Required |
| `xlarge.png` | 1000 × 1000 px | Required |

### Icons (SVG)
| File | Location | Notes |
|------|----------|-------|
| `icon.svg` | `/assets/` | App icon, transparent background, 960×960 canvas |
| `icon.svg` | `/drivers/<id>/assets/` | Driver icon, transparent background |

### Image guidelines
- **Format:** PNG or JPG only (not SVG for images)
- **App images:** Lively, represent app purpose; avoid logos or flat shapes
- **Driver images:** White background with recognizable device picture
- Don't reuse app icon as driver image

## Readme file
Create `readme.txt` (not `.md`) in your app root:
- Plain text only (no markdown, no URLs)
- 1–2 short paragraphs
- Describe what the app does and key features
- No changelogs or version history

Example:
```text
FMI Weather brings real-time weather data from the Finnish Meteorological Institute to your Homey. Add city weather sensors to monitor temperature in Finnish cities.

The app polls FMI Open Data at configurable intervals and updates your Homey devices automatically.
```

## Naming and description guidelines

### App name
- Use brand name only
- No "Homey", "Athom", or protocol names (Zigbee, Z-Wave)
- Maximum 4 words
- Example: ✅ "FMI Weather" ❌ "Homey FMI Weather App"

### Description
- Catchy one-liner tagline
- Avoid generic "Adds support for X"
- Example: ✅ "Real-time Finnish weather data" ❌ "Adds support for FMI"

## Publishing process

### 1. Validate your app
```bash
cd your-app-folder
homey app validate --level publish
```

Fix any errors before proceeding.

### 2. Publish to App Store
```bash
homey app publish
```

This uploads your app as a **draft**.

### 3. Manage in Developer Tools
1. Go to https://tools.developer.homey.app/
2. Navigate to: **Apps SDK** → **My Apps**
3. Find your app and manage its release status

### 4. Release stages
| Stage | Description |
|-------|-------------|
| **Draft** | Initial state after `homey app publish` |
| **Test** | Available via test link only (beta testing) |
| **Submit for Certification** | Sends app to Athom for review |
| **Live** | Public in App Store after approval |

## Certification review

### Timeline
- Review can take **up to 2 weeks**
- First-time apps require certification before going live
- Verified Developer apps may take longer

### What happens
- App may be approved immediately
- You may receive feedback or questions
- Address any issues and resubmit

### Tips for faster approval
- Ensure all images meet requirements
- Test thoroughly on actual Homey hardware
- Provide clear, accurate descriptions
- Include support contact information

## Updating published apps

### Version updates
1. Increment version in `.homeycompose/app.json`
2. Run `homey app publish`
3. New version appears as draft
4. Submit for certification (or auto-publish for minor updates)

### Versioning guidance
- **Patch (1.0.x):** Bug fixes
- **Minor (1.x.0):** New features, backward compatible
- **Major (x.0.0):** Breaking changes

## Checklist before publishing

- [ ] All manifest fields present and valid
- [ ] PNG images at correct dimensions
- [ ] SVG icons with transparent backgrounds
- [ ] `readme.txt` with plain-text description
- [ ] Localization complete (at minimum `en`)
- [ ] Tested on actual Homey hardware
- [ ] `homey app validate --level publish` passes
- [ ] Support URL or email configured
- [ ] No credentials or secrets in code

## References
- Homey Developer Docs: https://apps.developer.homey.app/
- App Manifest: https://apps.developer.homey.app/the-basics/app/manifest
- Publishing: https://apps.developer.homey.app/publish/app-store
- Developer Tools: https://tools.developer.homey.app/
