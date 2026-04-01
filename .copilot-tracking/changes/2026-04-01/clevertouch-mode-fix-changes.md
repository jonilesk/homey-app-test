<!-- markdownlint-disable-file -->
# Release Changes: CleverTouch Mode Mapping Fix

**Related Plan**: clevertouch-mode-fix-plan.instructions.md
**Implementation Date**: 2026-04-01

## Summary

Fix incorrect gv_mode mapping that causes wrong target temperatures in Homey app. Correct all mode constants based on the authoritative Python library and add support for Program mode variants.

## Changes

### Added

### Modified

* clevertouch-app/drivers/radiator/device.js - Replaced mode constants to map values to the API correctly (lines 10-28), updated switch target temperature parsing for Program mode (lines 175-178), and adjusted the homeGeneralMode overrider (lines 131-142).
* clevertouch-app/lib/CleverTouchOAuth2Client.js - Updated setDeviceMode JSDoc doc comment to match the corrected API constants (line 307).

### Removed

## Additional or Deviating Changes

* clevertouch-app/drivers/radiator/device.js - Updated comments about `1-5` mode assumptions for `general_mode`.

## Release Summary

Resolved the CleverTouch Homey app bug displaying wrong target temperature during mode changes. Corrected the incorrect mapping of values mapping `gv_mode` values strictly to the Python library definitions and validated the absence of any remaining hardcoded `0-5` incorrect ranges. Modified constants in device.js, and API client JSDoc constants have been updated correctly. Validated parsing and setup with `homey app validate --level debug`.

