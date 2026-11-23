export const CHECKOUT_PROBE = `
  import {existsSync, readFileSync, readdirSync, realpathSync} from 'node:fs';
  import {join} from 'node:path';
  const base = process.cwd();
  const children = readdirSync(base, {withFileTypes: true})
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules')
    .map(entry => join(base, entry.name));
  const checkoutRoot = [base, ...children].find(root => {
    try {
      return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name === 'latch'
        && existsSync(join(root, 'scripts/sandbox-bootstrap.mjs'));
    } catch {return false;}
  });
  if (!checkoutRoot) {
    console.error('The pinned Latch checkout was not found in ' + base + ' or its directories: ' + children.join(', '));
    process.exit(1);
  }
  console.log(JSON.stringify({checkoutRoot: realpathSync(checkoutRoot)}));
`;

export function validCheckoutRoot(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 256 && /^\/vercel(?:\/[A-Za-z0-9._-]+)*$/.test(value)
    && !value.split('/').some(part => part === '.' || part === '..');
}
