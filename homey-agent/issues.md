# Homey MCP Server v2 — Improvement Issues

Issues identified from v1 analysis. Organized by priority.

---

## 🔴 Critical

### 1. Replace bare `except:` clauses with specific exception types
**Files:** `src/homey_mcp/tools/device/lighting.py`, `src/homey_mcp/tools/device/sensors.py`

Bare `except:` catches everything including `KeyboardInterrupt` and `SystemExit`, making the server impossible to cleanly shut down.

**Fix:** Replace all `except:` with `except Exception as e:` and log the error.

---

### 2. Remove global mutable state from server.py
**File:** `src/homey_mcp/server.py`

Global variables (`homey_client`, `device_tools`, `flow_tools`, `insights_tools`) are not thread-safe and make testing difficult.

**Fix:** Use dependency injection or a context/container class to manage shared state.

---

### 3. Redact tokens fully in logs
**File:** `src/homey_mcp/server.py` (line ~35)

Token is partially logged (`token[:20]...`), leaking sensitive data.

**Fix:** Log only a fully masked representation: `Token: ****` or at most last 4 chars.

---

### 4. Silent demo mode activation hides real errors
**File:** `src/homey_mcp/client/base.py`

When connection or auth fails, demo mode activates silently. Users may think they're controlling real devices when actually in demo mode.

**Fix:** Log a clear WARNING when falling back to demo mode. Add a startup banner showing the active mode. Consider making auto-fallback opt-in via config.

---

## 🟡 Medium

### 5. Add HTTP retry logic with exponential backoff
**Files:** All client files (`client/devices.py`, `client/flows.py`, `client/insights.py`, `client/energy.py`)

Currently a single HTTP failure causes immediate error. Network glitches are common on local networks.

**Fix:** Implement retry decorator with exponential backoff + jitter (max 3 attempts). Use `httpx` retry or a custom wrapper.

---

### 6. Add input validation for MCP tool parameters
**Files:** All tool files (`tools/device/*.py`, `tools/flow/*.py`, `tools/insights/*.py`)

Tool parameters are passed through without validation. Invalid values reach the API and produce unclear errors.

**Fix:** Add Pydantic models for tool input parameters. Validate before making API calls. Return clear error messages for invalid inputs.

---

### 7. Expand test coverage significantly
**Files:** `tests/`

Only 4 test cases across 2 files. No tests for:
- Tool handler logic
- Error handling paths
- Demo mode data
- Capability validation
- Flow card pagination
- Energy report parsing

**Fix:** Target 80%+ coverage. Add unit tests for each tool handler, client method, and error path. Add integration tests for demo mode.

---

### 8. Add connection pooling and reconnection logic
**File:** `src/homey_mcp/client/base.py`

HTTP session created once, never rotated. Long-running server may hit stale connection issues.

**Fix:** Add keepalive monitoring. Implement automatic reconnection on connection errors. Add health check endpoint.

---

### 9. Fix incomplete cache invalidation
**Files:** `src/homey_mcp/tools/device/lighting.py`, `src/homey_mcp/tools/device/sensors.py`

Lighting and sensor tools don't invalidate zone cache after zone-scoped operations. May show stale data.

**Fix:** Invalidate relevant caches after write operations. Consider event-based cache invalidation.

---

### 10. Silent data fixing in flow card cleaning
**File:** `src/homey_mcp/client/flows.py`

`_ultra_clean_for_api()` silently replaces missing flow names with "Unnamed Flow" without logging.

**Fix:** Log warnings when fixing missing/corrupt data. Let callers know data was patched.

---

## 🟢 Minor

### 11. Consolidate scattered error log entries
**File:** `src/homey_mcp/client/devices.py`

Multiple `logger.error()` calls for a single error (endpoint, payload, exception on separate lines).

**Fix:** Use single structured log entry with all context.

---

### 12. Extract hardcoded API endpoints to constants
**Files:** All client files

API endpoint strings are scattered throughout the code.

**Fix:** Create an `endpoints.py` module or enum with all Homey API paths. Makes version changes easier.

---

### 13. Add missing type hints for mypy strict mode
**Files:** `client/flows.py`, `client/devices.py`, all tool files

Many functions lack return type annotations. Breaks `disallow_untyped_defs=true` in pyproject.toml.

**Fix:** Add complete type annotations to all public and private methods.

---

### 14. Energy report period parsing is fragile
**File:** `src/homey_mcp/client/energy.py`

String parsing for period formats (YYYY-MM-DD-HH, YYYY) uses patterns that can fail silently.

**Fix:** Use proper date parsing with validation. Return clear errors for invalid period formats.

---

### 15. Flow card pagination limited to offset/limit
**File:** `src/homey_mcp/tools/flow/management.py`

Max 200 results per page with offset-based pagination. Could miss cards in large installations.

**Fix:** Implement cursor-based pagination or auto-paginate to collect all results.

---

### 16. Demo data uses non-UUID device IDs
**File:** `src/homey_mcp/client/devices.py`

Demo devices use simple IDs (light1, sensor1) while real Homey uses UUIDs. May confuse users switching between modes.

**Fix:** Use UUID-format IDs in demo data to match real API behavior.

---

## 🔵 Design / Architecture

### 17. Add structured JSON logging option
**File:** `src/homey_mcp/__main__.py`

Current text-based logging is fine for development but hard to parse in production.

**Fix:** Add configurable JSON logging format via config setting.

---

### 18. Support multiple Homey API versions
**Files:** All client files

No API version tracking. Future Homey firmware may change endpoints.

**Fix:** Add API version detection on connect. Route to version-specific endpoint handlers.

---

### 19. Add AbortController-style timeouts for all HTTP calls
**Files:** All client files

While `httpx` has timeout support, there's no per-request timeout override or cancellation mechanism for long-running operations.

**Fix:** Add configurable per-operation timeouts. Implement request cancellation for user-initiated aborts.

---

### 20. Add WebSocket support for real-time events
**File:** `pyproject.toml` (websockets dependency exists but unused)

The `websockets` dependency is declared but not used. Real-time device state changes require polling.

**Fix:** Implement WebSocket connection to Homey's real-time event stream for instant state updates without polling.

---

## Summary

| Priority | Count | Focus |
|----------|-------|-------|
| 🔴 Critical | 4 | Security, reliability, correctness |
| 🟡 Medium | 6 | Robustness, testing, data integrity |
| 🟢 Minor | 6 | Code quality, maintainability |
| 🔵 Design | 4 | Architecture, future-proofing |
| **Total** | **20** | |
