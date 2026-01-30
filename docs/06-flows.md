# Flows (Triggers, Conditions, Actions)

## Flow card types
- **Trigger**: "When X happens"
- **Condition**: "And only if Y is true"
- **Action**: "Then do Z"

## App-only Flow cards (no devices)
- Define app-level cards in `.homeycompose/flow/triggers|conditions|actions`.
- Register listeners in `app.js` using `this.homey.flow.getTriggerCard()` / `getConditionCard()` / `getActionCard()`.
- Validate arguments early and return clear errors for user-visible failures.
- Keep handlers fast; offload slow I/O and include retry/backoff for transient API errors.

Reference:
- https://apps.developer.homey.app/the-basics/flow

## Design guidelines
- Keep titles short and user-friendly.
- Provide meaningful arguments (avoid many optional fields).
- Validate arguments early and return helpful errors.
- Keep flow execution fast; move slow I/O to async handling with clear logging.

## Idempotency & side-effects
- Action cards should be safe to run multiple times.
- If calling external APIs, handle transient failures with retry/backoff where safe.
- Never spam external endpoints on repeated flow triggers.

## Observability
- Log flow execution start + outcome.
- Include correlation info:
  - flow card id
  - device id (if applicable)
  - arguments summary (redacted)

## Localization
- Localize titles, hints, and argument labels.
- Keep translations consistent across triggers/actions/conditions.
