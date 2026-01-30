# Environment Setup (VS Code + Homey Pro 2023)

## Requirements
- **Node.js 18+** (check: `node --version`)
- **npm** (check: `npm --version`)
- **Homey CLI** (`homey`)

Docker is **not required** for most Homey app development. Use `homey app run --remote` to develop directly on your Homey Pro.

## Install Homey CLI
```bash
npm install --global homey
homey --version
```

## Login & select Homey
```bash
homey login          # Opens browser for authentication
homey select         # Choose which Homey to target
homey list           # Verify connection
```

## VS Code recommendations
### Extensions
- ESLint (optional, for code quality)
- EditorConfig (optional, for consistent formatting)

### Workspace settings (optional)
Create `.vscode/settings.json`:
```json
{
  "editor.formatOnSave": true,
  "files.eol": "\n"
}
```

## Network prerequisites
For `homey app run --remote`, your dev machine must reach the Homey hub:
- Same LAN (typical), or
- VPN into your home network

## Create a new app skeleton
```bash
homey app create
cd <your.app.id>
code .
```

Or manually create the structure (see `02-project-structure-homey-compose.md`).

## Minimal package.json
```json
{
  "name": "your.app.id",
  "version": "1.0.0",
  "main": "app.js",
  "engines": {
    "node": ">=18"
  }
}
```

**Important:** Do NOT add `homey` as a dependency. The Homey runtime provides it.

## Verify setup
```bash
homey app validate --level debug
```

If this passes, your environment is ready for development.
