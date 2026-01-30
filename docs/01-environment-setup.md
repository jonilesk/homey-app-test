# Environment Setup (VS Code + Homey Pro 2023)

## Requirements
- **Node.js 18+**
- **Homey CLI** (`homey`)
- (Optional) **Docker**
  - Useful for certain dev scenarios (e.g., widgets/webviews) and some tooling paths.
  - For Homey Pro (2023) core app logic, you can usually develop remotely on device without Docker by using `--remote`.

## Install Homey CLI
```bash
npm install --global homey
homey --version
```

## Login & select Homey
```bash
homey login
homey app list
```

## VS Code recommendations
### Extensions
- Homey VS Code Extension (beta) (optional)
- ESLint (optional)
- EditorConfig (optional)

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

## Recommended Node tooling
Add scripts in `package.json` (example):
```json
{
  "scripts": {
    "lint": "eslint .",
    "test": "node ./tools/smoke-test.js"
  }
}
```
