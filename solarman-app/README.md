# Solarman

Homey Pro app for monitoring solar inverters via Solarman WiFi data loggers over local LAN.

## Supported Inverters

Sofar (LSW3, WiFi Kit, G3 Hybrid, HYD 3K-6K ES), Deye (2/4 MPPT, Hybrid, String, SG04LP3), Solis (1P8K, 3P, Hybrid, S6), KStar Hybrid, ZCS Azzurro, Afore BNTxxxKTL, HYD-ZSS-HP.

## Features

- Local LAN communication (no cloud) via Solarman V5 protocol
- Auto-discovery of data loggers on the network
- 17 inverter profiles with dynamic capability mapping
- Homey Energy dashboard integration
- Flow cards: triggers (production changed, status changed, fault), conditions (producing, normal), actions (write register)

## CLI Tools

Test against your inverter before installing on Homey:

```bash
cd solarman-app && npm install

# Discover data loggers on LAN
node cli/discover.js

# Read all registers (replace SERIAL with your data logger serial)
node cli/read-inverter.js --serial SERIAL --host 192.168.1.100

# Continuous monitoring
node cli/monitor.js --serial SERIAL --host 192.168.1.100 --interval 30

# Write a register
node cli/write-register.js --serial SERIAL --host 192.168.1.100 --register 0x4000 --value 1
```

## Install on Homey

```bash
homey app run --remote    # Dev mode (live logs)
homey app install         # Permanent install
```

Pair via: Devices → Add Device → Solarman → enter IP + serial number.

## Project Structure

```
lib/                  Core libraries (reused by CLI + Homey)
  SolarmanApi.js        Solarman V5 protocol client (TCP/Modbus)
  ParameterParser.js    Register data parser (10 parse rules)
  InverterScanner.js    UDP LAN discovery
cli/                  Command-line test tools
drivers/inverter/     Homey driver + device
inverter_definitions/ 17 YAML inverter profiles
.homeycompose/        Homey app manifest + capabilities + flow cards
```
