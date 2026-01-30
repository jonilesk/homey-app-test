# Testing & Validation

## Levels of validation
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
