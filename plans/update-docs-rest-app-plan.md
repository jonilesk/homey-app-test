# Plan: Update docs for REST-driven Homey app (no hardware devices)

## Goal
Add guidance for Homey apps that integrate with external REST APIs (no physical devices), using official Homey Apps SDK documentation as sources.

## Scope
Update these docs:
- docs/00-overview.md
- docs/02-project-structure-homey-compose.md
- docs/04-coding-guidelines.md
- docs/06-flows.md
- docs/10-security-privacy.md

## Sources to reference
- App & Manifest: https://apps.developer.homey.app/the-basics/app and https://apps.developer.homey.app/the-basics/app/manifest
- Permissions: https://apps.developer.homey.app/the-basics/app/permissions
- Web API: https://apps.developer.homey.app/advanced/web-api
- OAuth2: https://apps.developer.homey.app/cloud/oauth2
- Flow: https://apps.developer.homey.app/the-basics/flow

## Planned changes
1. Add "Device-less App Pattern" to docs/00-overview.md
   - Explicitly mention that some apps are pure services (REST/API based) and don't need a `drivers/` folder.
   
2. Add “Manifest essentials” section to docs/02-project-structure-homey-compose.md
   - Explain compose source-of-truth and key manifest fields (id, version, sdk, platforms, permissions).
   - Call out when to include permissions (esp. homey:manager:api).

3. Add “REST API integration” section to docs/04-coding-guidelines.md
   - HTTP timeouts, retries/backoff, rate limits, caching.
   - Token handling and redaction in logs.
   - Fail-soft patterns and availability handling for cloud outages.

4. Add “App-only Flow cards” section to docs/06-flows.md
   - Define app-level triggers/conditions/actions in .homeycompose/flow.
   - Register run listeners in app.js.
   - Advice for argument validation and safe retries.

5. Add “Permissions & Web API exposure” section to docs/10-security-privacy.md
   - Avoid public endpoints unless strictly necessary.
   - Homey Cloud limitations (no Web API exposure).
   - App-to-app API permissions (homey:app:<appId>) and install/version checks.

## Acceptance criteria
- Each section is concise and references official docs.
- Guidance is specific to REST-driven apps (no hardware device drivers required).
- No conflicting advice with existing docs.

## Implementation checklist
- [x] Update docs/00-overview.md with "Device-less App Pattern"
- [x] Update docs/02-project-structure-homey-compose.md with "Manifest essentials" section
- [x] Update docs/04-coding-guidelines.md with "REST API integration" section
- [x] Update docs/06-flows.md with "App-only Flow cards" section
- [x] Update docs/10-security-privacy.md with "Permissions & Web API exposure" section

## Estimated effort
~1–2 hours to implement and review.

---

## Status
**Completed** — all docs updated and verified.
