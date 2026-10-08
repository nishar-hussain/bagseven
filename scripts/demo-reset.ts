import { existsSync, rmSync } from 'node:fs';

const stateDirectory = `${process.cwd()}/.demo`;
if (existsSync(stateDirectory)) rmSync(stateDirectory, { recursive: true, force: true });
console.log('[demo] local demo state reset; application data and funds were not removed');
