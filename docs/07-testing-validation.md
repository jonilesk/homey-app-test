# Testing & Validation

## Levels of validation

### Homey CLI validation levels
```bash
homey app validate --level debug     # Development (minimal requirements)
homey app validate --level publish   # App Store submission
homey app validate --level verified  # Verified Developer certification
```

| Level | PNG Images | Support URL | Compatibility | Use Case |
|-------|------------|-------------|---------------|----------|
| debug | ❌ | ❌ | ✅ | Local development |
| publish | ✅ | ❌ | ✅ | App Store submission |
| verified | ✅ | ✅ | ✅ | Verified apps |

### Additional validation layers
1. **Static validation**: linting, schema checks
2. **Runtime smoke tests**: app boot + basic path
3. **Device integration tests**: pairing + capability change
4. **Flow tests**: action/trigger correctness

## Recommended minimal checks
### Lint (optional but recommended)
- ESLint with a simple config that fits Node 18.
- Ensure no unused variables and no accidental async mistakes.

### Smoke test (example approach)
Create `tools/smoke-test.js`:
- Imports core modules
- Ensures required env assumptions are met
- Runs minimal logic that won’t require Homey runtime

Then:
```bash
npm test
```

## On-device validation checklist
- App starts without errors
- Pairing works end-to-end
- Device becomes available and updates at least one capability
- Flow action works and provides correct result
- Unavailable states recover cleanly

## Release candidate checklist
- Remove debug-only logs (or gate behind setting)
- Ensure no secrets in repo
- Validate translations exist for supported locales
- Bump version + update changelog notes
- Run `homey app validate --level publish` (or `verified` if applicable)
- Test with `homey app install` for soak testing before release

## Common validation errors and fixes

| Error | Fix |
|-------|-----|
| `property 'compatibility' is required` | Add `"compatibility": ">=5.0.0"` to app.json |
| `property 'images' is required` | Add PNG images to `assets/images/` and `drivers/<id>/assets/images/` |
| `Invalid image extension (.svg)` | Use PNG for images, SVG only for icons |
| `property 'support' is required` | Add `"support": "mailto:..."` (verified level only) |
