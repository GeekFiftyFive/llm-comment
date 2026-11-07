import { run } from '../src/index.js';

describe('run', () => {
  it('greets the world by default', () => {
    expect(run([])).toBe('Hello, world!');
  });

  it('greets the first argument', () => {
    expect(run(['Ada'])).toBe('Hello, Ada!');
  });
});
