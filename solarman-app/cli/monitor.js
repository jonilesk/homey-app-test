'use strict';

const path = require('path');
const fs = require('fs');
const { Command } = require('commander');
const yaml = require('js-yaml');
const SolarmanApi = require('../lib/SolarmanApi');
const ParameterParser = require('../lib/ParameterParser');

const MIN_INTERVAL = 15;
const DEFAULT_INTERVAL = 30;

function parseIntOption(value, name) {
  const num = parseInt(value, 10);
  if (Number.isNaN(num) || !Number.isFinite(num)) {
    throw new Error(`Invalid number for ${name}: ${value}`);
  }
  return num;
}

function timestamp() {
  const now = new Date();
  return now.toLocaleTimeString('en-GB', { hour12: false });
}

function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function formatValue(value, uom) {
  if (typeof value === 'number' && !Number.isInteger(value)) {
    value = parseFloat(value.toFixed(2));
  }
  const suffix = uom ? ` ${uom}` : '';
  return `${value}${suffix}`;
}

// Build a map from parameter name to its group and uom for display purposes
function buildParamMeta(definition) {
  const meta = {};
  for (const group of definition.parameters) {
    for (const item of group.items) {
      meta[item.name] = { group: group.group, uom: item.uom || '' };
    }
  }
  return meta;
}

// Determine the ordered list of parameter names (preserving YAML order)
function getOrderedParamNames(definition) {
  const names = [];
  for (const group of definition.parameters) {
    for (const item of group.items) {
      names.push(item.name);
    }
  }
  return names;
}

// Group parameter names by their group name, preserving order
function getGroupedParams(definition) {
  const groups = [];
  for (const group of definition.parameters) {
    const items = group.items.map((item) => item.name);
    groups.push({ name: group.group, items });
  }
  return groups;
}

async function readAllRegisters(api, definition) {
  const parser = new ParameterParser(definition);

  for (const req of definition.requests) {
    const start = req.start;
    const quantity = req.end - req.start + 1;
    const isInput = req.mb_functioncode === 0x04 || req.mb_functioncode === 4;

    const rawData = isInput
      ? await api.readInputRegisters(start, quantity)
      : await api.readHoldingRegisters(start, quantity);

    parser.parse(rawData, start, quantity);
  }

  return parser.getResult();
}

function printInitialReading(results, definition, paramMeta) {
  const groups = getGroupedParams(definition);

  for (const group of groups) {
    console.log(`--- ${group.name} ---`);
    for (const name of group.items) {
      if (results[name] !== undefined) {
        const uom = paramMeta[name].uom;
        const label = `  ${name}:`.padEnd(36);
        console.log(`${label}${formatValue(results[name], uom)}`);
      }
    }
  }
}

function printChanges(previous, current, paramMeta, orderedNames) {
  const changes = [];

  for (const name of orderedNames) {
    const oldVal = previous[name];
    const newVal = current[name];
    if (oldVal !== undefined && newVal !== undefined && oldVal !== newVal) {
      // Also compare stringified for array/object values
      if (typeof oldVal === 'object' || typeof newVal === 'object') {
        if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
          changes.push({ name, oldVal, newVal });
        }
      } else {
        changes.push({ name, oldVal, newVal });
      }
    }
  }

  return changes;
}

const program = new Command();

program
  .name('monitor')
  .description('Continuously poll a Solarman inverter and display live updates')
  .requiredOption('--serial <number>', 'Data logger serial number')
  .option('--host <ip>', 'Data logger IP address', '10.1.1.97')
  .option('--port <number>', 'Data logger port', '8899')
  .option('--slaveid <number>', 'Modbus slave ID', '1')
  .option('--lookup <file>', 'Inverter definition YAML file', 'sofar_lsw3.yaml')
  .option('--interval <seconds>', 'Polling interval in seconds (minimum 15)', String(DEFAULT_INTERVAL))
  .action(async (options) => {
    const host = options.host;
    const port = parseIntOption(options.port, 'port');
    const serial = parseIntOption(options.serial, 'serial');
    const mbSlaveId = parseIntOption(options.slaveid, 'slaveid');
    const lookupFile = options.lookup;
    const interval = Math.max(MIN_INTERVAL, parseIntOption(options.interval, 'interval'));

    // Load YAML definition
    const yamlPath = path.resolve(__dirname, '..', 'inverter_definitions', lookupFile);
    if (!fs.existsSync(yamlPath)) {
      console.error(`Error: Inverter definition not found: ${yamlPath}`);
      process.exit(1);
    }
    const definition = yaml.load(fs.readFileSync(yamlPath, 'utf8'));

    const paramMeta = buildParamMeta(definition);
    const orderedNames = getOrderedParamNames(definition);

    // State
    let previousResults = null;
    let pollCount = 0;
    let errorCount = 0;
    let connected = false;
    let stopping = false;
    let pollTimer = null;
    const startTime = Date.now();

    const api = new SolarmanApi({
      host,
      port,
      serial,
      mbSlaveId,
      timeout: 15000,
      autoReconnect: false,
      logger: { log: () => {}, error: () => {} },
    });

    // Graceful shutdown
    async function shutdown() {
      if (stopping) return;
      stopping = true;
      console.log('\n\nStopping monitor...');

      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }

      try {
        await api.disconnect();
      } catch (_) {
        // ignore disconnect errors during shutdown
      }

      const duration = formatDuration(Date.now() - startTime);
      console.log(`  Total polls: ${pollCount}`);
      console.log(`  Total duration: ${duration}`);
      console.log(`  Connection errors: ${errorCount}`);
      process.exit(0);
    }

    process.on('SIGINT', shutdown);

    // Print header
    console.log('Solarman Inverter Monitor');
    console.log('=========================');
    console.log(`Host: ${host}:${port} | Serial: ${serial} | Profile: ${lookupFile}`);
    console.log(`Interval: ${interval}s | Press Ctrl+C to stop\n`);

    // Initial connection and poll
    try {
      await api.connect();
      connected = true;
    } catch (error) {
      console.log(`[${timestamp()}] Connection failed: ${error.message}`);
      errorCount++;
      connected = false;
    }

    async function poll() {
      if (stopping) return;

      pollCount++;

      // Reconnect if needed
      if (!connected) {
        try {
          console.log(`[${timestamp()}] Reconnecting...`);
          await api.connect();
          connected = true;
          console.log(`[${timestamp()}] Reconnected.`);
        } catch (error) {
          errorCount++;
          console.log(`[${timestamp()}] Poll #${pollCount} (connection error): ${error.message} - reconnecting...`);
          schedulePoll();
          return;
        }
      }

      try {
        const results = await readAllRegisters(api, definition);

        if (previousResults === null) {
          // Initial reading
          console.log(`[${timestamp()}] Connected. Initial reading:`);
          printInitialReading(results, definition, paramMeta);
        } else {
          // Subsequent polls — show changes only
          const changes = printChanges(previousResults, results, paramMeta, orderedNames);

          if (changes.length === 0) {
            console.log(`[${timestamp()}] Poll #${pollCount}: No changes`);
          } else {
            console.log(`[${timestamp()}] Poll #${pollCount} (${changes.length} change${changes.length !== 1 ? 's' : ''}):`);
            for (const c of changes) {
              const uom = paramMeta[c.name].uom;
              const label = `  ${c.name}:`.padEnd(36);
              const oldStr = typeof c.oldVal === 'object' ? JSON.stringify(c.oldVal) : String(c.oldVal);
              const newStr = formatValue(c.newVal, uom);
              console.log(`${label}${oldStr} \u2192 ${newStr}`);
            }
          }
        }

        previousResults = results;
      } catch (error) {
        errorCount++;
        connected = false;
        console.log(`[${timestamp()}] Poll #${pollCount} (connection error): ${error.message} - reconnecting...`);
        try {
          await api.disconnect();
        } catch (_) {
          // ignore
        }
      }

      schedulePoll();
    }

    function schedulePoll() {
      if (stopping) return;
      pollTimer = setTimeout(poll, interval * 1000);
    }

    // Start the first poll immediately
    await poll();
  });

program.parse();
