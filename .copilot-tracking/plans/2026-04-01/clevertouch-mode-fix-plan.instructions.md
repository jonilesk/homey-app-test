---
applyTo: '.copilot-tracking/changes/2026-04-01/clevertouch-mode-fix-changes.md'
---
<!-- markdownlint-disable-file -->
# Implementation Plan: CleverTouch Mode Mapping Fix

## Overview

Fix the incorrect gv_mode value mapping in device.js that causes wrong target temperatures and mode behavior for all modes except Frost.

## Objectives

### User Requirements

* Fix wrong target temperature display when switching modes (e.g., ECO shows 22.0C instead of 16.0C) -- Source: user report with screenshots showing CleverTouch Gen.2 app at 16.0C ECO vs Homey at 22.0C

### Derived Objectives

* Correct all 7 mode value mappings to match the authoritative Python library -- Derived from: only Frost (value 2) is correct; 6 other mappings are wrong
* Add support for Program mode variants (gv_mode 8 and 11) -- Derived from: Python library reveals Program has two API values, both currently unmapped
* Fix both read path (polling) and write path (set mode from Homey UI) -- Derived from: wrong mapping affects bidirectional communication
* Update API client JSDoc to match corrected mapping -- Derived from: comment on line 307 of CleverTouchOAuth2Client.js has wrong values

## Context Summary

### Project Files

* clevertouch-app/drivers/radiator/device.js - Device runtime with mode mapping constants (lines 10-28), poll logic (lines 89-249), mode write handler (lines 310-338)
* clevertouch-app/lib/CleverTouchOAuth2Client.js - API client with wrong JSDoc on setDeviceMode (line 307)

### References

* .copilot-tracking/research/2026-04-01/clevertouch-mode-mapping-bug-research.md - Root cause analysis
* https://github.com/hemphen/clevertouch/blob/main/src/clevertouch/devices/radiator.py - Authoritative mode mapping source

### Standards References

* docs/00-overview.md through docs/13-oauth2-cloud-devices.md - Homey app development guide

## Implementation Checklist

### [x] Implementation Phase 1: Fix Mode Mapping Constants

<!-- parallelizable: false -->

* [x] Step 1.1: Replace HEAT_MODE_TO_VALUE and VALUE_TO_HEAT_MODE constants
  * Details: .copilot-tracking/details/2026-04-01/clevertouch-mode-fix-details.md (Lines 10-46)
* [x] Step 1.2: Update target temperature switch case for correct mode-to-setpoint mapping
  * Details: .copilot-tracking/details/2026-04-01/clevertouch-mode-fix-details.md (Lines 48-93)
* [x] Step 1.3: Update homeGeneralMode override range to include Program variants
  * Details: .copilot-tracking/details/2026-04-01/clevertouch-mode-fix-details.md (Lines 95-117)
* [x] Step 1.4: Update API client JSDoc comment
  * Details: .copilot-tracking/details/2026-04-01/clevertouch-mode-fix-details.md (Lines 119-132)

### [x] Implementation Phase 2: Validation

<!-- parallelizable: false -->

* [x] Step 2.1: Run homey app validate
  * Execute: homey app validate --level debug
* [x] Step 2.2: Verify mode constants are internally consistent
  * Every value in HEAT_MODE_TO_VALUE has a reverse mapping in VALUE_TO_HEAT_MODE
  * Every value in VALUE_TO_HEAT_MODE has a reverse mapping in HEAT_MODE_TO_VALUE (except Program which maps two values)
* [x] Step 2.3: Review code for any other references to old mode values
  * Search for hardcoded mode numbers (0-5) in device.js, driver.js, flow card handlers
* [x] Step 2.4: Fix minor validation issues if any

## Planning Log

See .copilot-tracking/plans/logs/2026-04-01/clevertouch-mode-fix-log.md for discrepancy tracking, implementation paths considered, and suggested follow-on work.

## Dependencies

* Homey CLI (homey command) for validation
* Node.js >= 18

## Success Criteria

* All 7 mode values correctly mapped per Python library evidence -- Traces to: research mapping table
* ECO mode displays correct eco setpoint temperature -- Traces to: user-reported bug
* Mode changes from Homey UI send correct gv_mode values to API -- Traces to: research write impact table
* Program mode variants (gv_mode 8 and 11) handled correctly -- Traces to: Python library _DEVICE_TO_MODE_TYPE
* homey app validate passes with no errors -- Traces to: Homey app development standards
