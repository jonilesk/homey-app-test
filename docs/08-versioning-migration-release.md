# Versioning, Migration, Release

## Versioning strategy
Use SemVer:
- MAJOR: breaking changes for users (renamed capabilities, removed features)
- MINOR: new functionality, backwards compatible
- PATCH: bug fixes

## Changelog discipline
Maintain a `CHANGELOG.md` with:
- version
- date
- highlights
- breaking changes (explicit)
- migration notes

## Backward compatibility guidelines
- Avoid renaming driver IDs, capability IDs, or flow card IDs.
- Add new fields instead of changing meaning of old ones.
- If you must deprecate:
  - keep old behavior for at least one MINOR version
  - log a deprecation warning (non-spammy)
  - document migration steps

## Migration playbook
When changing anything user-visible:
1. Document the change
2. Provide defaults for new settings
3. Implement migration in device init path where applicable
4. Test upgrade path on a real Homey Pro (2023)

## Release checklist
- Version bumped
- Changelog updated
- App runs cleanly via `homey app run --remote`
- No debug secrets/logging enabled by default
- Pairing tested from scratch
- Basic flows tested
