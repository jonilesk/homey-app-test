# Homey App Development Guidelines (Homey Pro 2023)

## Purpose
This documentation package defines a repeatable, VS Code-first workflow for building, running, debugging, and releasing Homey apps targeting **Homey Pro (2023)**.

## Scope
- Development environment & tooling (Node.js, Homey CLI, VS Code)
- Project structure (Homey Compose)
- Development loop (run/install/debug)
- Coding standards (stability, logging, error handling)
- Devices & drivers (capabilities, pairing)
- Flows (cards, triggers/actions/conditions)
- Testing & validation
- Versioning, migrations, releases
- Security & privacy
- Troubleshooting playbook

## Core mental model
- A Homey app is a **Node.js application** that runs **on the Homey hub**.
- During development, you **upload and execute** the app from your machine using **Homey CLI**.
- Homey Compose lets you maintain `app.json` as structured source files; the full manifest is generated from compose fragments.

## Device-less app pattern (REST/API services)
- Not every Homey app needs a `drivers/` folder. Some apps are **service-only** and only expose Flow cards or settings.
- These apps typically integrate with a **REST API** or cloud service and run logic in `app.js`.
- Use `.homeycompose/flow/**` for app-level Flow cards and `api.js` only when you intentionally expose a Web API.

## Recommended workflow (high level)
1. **Edit** in VS Code.
2. **Run on device** using `homey app run --remote` for Homey Pro (2023).
3. **Stream logs** and **attach a debugger** when needed.
4. **Validate** before longer tests (`install`) and before publishing.

## Directory layout for this package
This package expects you to place these files in your repo:

```text
docs/
  00-overview.md
  01-environment-setup.md
  02-project-structure-homey-compose.md
  03-dev-loop-run-install-debug.md
  04-coding-guidelines.md
  05-drivers-devices-capabilities.md
  06-flows.md
  07-testing-validation.md
  08-versioning-migration-release.md
  09-troubleshooting.md
  10-security-privacy.md
  11-publishing-to-app-store.md
  12-local-installation.md
```
