import fs from "node:fs";

import { globSync } from "glob";

if (process.platform === "win32") {
  process.exit(0);
}

const stubCode = `if (process.platform !== 'win32') {
  const dummyFn = () => undefined;
  const dummyArrayFn = () => [];
  const dummyFalseFn = () => false;

  const knownStubs = {
    RegGetValue: dummyFn,
    RegOpenKeyEx: dummyFn,
    RegQueryValueEx: dummyFn,
    RegEnumValue: dummyArrayFn,
    RegEnumKeys: dummyArrayFn,
    WithRegOpen: dummyFn,
    GetProcessWindowList: dummyArrayFn,
    SetForegroundWindow: dummyFalseFn,
    GetVolumePathName: (p) => p,
    GetDiskFreeSpace: dummyFn,
  };

  module.exports = new Proxy(knownStubs, {
    get(target, prop) {
      if (typeof prop === 'symbol') return undefined;
      if (prop in target) return target[prop];
      return dummyFn;
    },
  });
  return;
}

const winapi = require('./build/Release/winapi');
module.exports = winapi;
`;

try {
  const files = globSync("node_modules/**/winapi-bindings/index.js", { nodir: true, dot: true });
  for (const file of files) {
    fs.writeFileSync(file, stubCode, "utf8");
    console.log(`[winapi-stub] Patched ${file}`);
  }
} catch (err) {
  // Silent fallback
}
