// TypeScript 7 has no JS compiler API, so ts-jest can't be used; tests are
// transpiled with SWC instead. Type checking is done separately via `tsc`.

/** @type {import('jest').Config} */
export default {
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  transform: {
    '^.+\\.ts$': [
      '@swc/jest',
      {
        jsc: { parser: { syntax: 'typescript' }, target: 'es2024' },
        module: { type: 'commonjs' },
      },
    ],
  },
  // Source uses NodeNext-style `./foo.js` imports; map them back to the .ts files.
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
