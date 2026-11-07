export function run(args: string[]): string {
  const name = args[0] ?? 'world';
  return `Hello, ${name}!`;
}
