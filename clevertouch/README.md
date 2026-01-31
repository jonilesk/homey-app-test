# CleverTouch Homey App Documentation

This folder contains analysis and documentation for building a Homey app based on the CleverTouch cloud API.

## Documentation Structure

| Document | Description |
|----------|-------------|
| [01-authentication.md](docs/01-authentication.md) | Authentication flow, token management, OAuth2 details |
| [02-api-endpoints.md](docs/02-api-endpoints.md) | API endpoints, request/response formats |
| [03-api-library-analysis.md](docs/03-api-library-analysis.md) | Analysis of the Python clevertouch library |
| [04-data-model.md](docs/04-data-model.md) | Data hierarchy, entities, and relationships |
| [05-capabilities-mapping.md](docs/05-capabilities-mapping.md) | Mapping HA entities to Homey capabilities |
| [06-homey-app-design.md](docs/06-homey-app-design.md) | Homey app architecture design |
| [07-flow-cards.md](docs/07-flow-cards.md) | Flow card triggers, conditions, actions |

## Supported Brands

The CleverTouch API supports multiple heating system brands:

| Brand | App Name | API Host |
|-------|----------|----------|
| Purmo | CleverTouch | e3.lvi.eu |
| Walter Meier | Smart-Comfort | www.smartcomfort.waltermeier.com |
| Frico | Frico FP Smart | fricopfsmart.frico.se |
| Fenix | Fenix V24 Wifi | v24.fenixgroup.eu |
| Vogel & Noot | Vogel & Noot E3 | e3.vogelundnoot.com |
| Cordivari | Cordivari My Way | cordivarihome.com |

## Quick Start for Development

1. Review [authentication](docs/01-authentication.md) for OAuth2 flow
2. Review [data model](docs/04-data-model.md) for understanding entities
3. Review [capabilities mapping](docs/05-capabilities-mapping.md) for Homey integration
4. Review [app design](docs/06-homey-app-design.md) for implementation approach

## Source Reference

- **Home Assistant Integration**: `../source/hass-clevertouch/`
- **Python API Library**: [github.com/hemphen/clevertouch](https://github.com/hemphen/clevertouch)

## License

The original `clevertouch` Python library is MIT licensed.
