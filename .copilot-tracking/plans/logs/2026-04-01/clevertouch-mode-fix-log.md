<!-- markdownlint-disable-file -->
# Planning Log: CleverTouch Mode Mapping Fix

## Discrepancy Log

### Unaddressed Research Items

* DR-01: homeGeneralMode=0 interpretation uncertain
  * Source: research doc Lines 89-91
  * Reason: Python library does not handle general_mode. Keeping 0 as no-override is safe.
  * Impact: low

* DR-02: gv_mode values 5, 6, 13, 15, 16 commented out in Python library
  * Source: research doc Lines 93-94
  * Reason: Not well understood. Fallback to Off handles safely.
  * Impact: low

### Plan Deviations from Research

* DD-01: Program mode write value chosen as 11 instead of 8
  * Research: Both 8 and 11 are valid
  * Plan: Uses 11 (matches Python library default)

* DD-02: Off mode still shows consigne_hg as target temperature
  * Research: Off has no target (TempType.NONE)
  * Plan: Keeps consigne_hg as UX reference

## Implementation Paths Considered

### Selected: Full mapping correction from Python library

* Rationale: Proven, tested reference. Fix all at once.

### IP-01: Partial fix (swap only Eco and Comfort)
* Rejected: 5 of 7 modes would remain broken

### IP-02: Deploy logging first
* Rejected: Python library is authoritative. No reason to delay.

## Suggested Follow-On Work

* WI-01: Investigate general_mode=0 semantics (medium)
* WI-02: Handle unknown gv_mode values 5,6,13,15,16 (low)
* WI-03: Update project docs with correct mappings (low)
