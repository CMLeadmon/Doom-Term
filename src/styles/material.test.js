import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const css = readFileSync(new URL('./material.css', import.meta.url), 'utf8');

test('declares every material token exactly once', () => {
  const required = [
    '--plate', '--ground', '--bevel-up', '--bevel-dn',
    '--ink', '--ink-tan', '--ink-dim', '--ink-plate',
    '--st-live', '--st-pass', '--st-fail', '--st-wait', '--st-idle',
  ];
  for (const token of required) {
    const hits = css.split(`${token}:`).length - 1;
    assert.equal(hits, 1, `${token} should be declared once, found ${hits}`);
  }
});

test('no border radius survives anywhere', () => {
  assert.match(css, /\*\s*\{[^}]*border-radius:\s*0/, 'needs a global radius reset');
  assert.equal(/border-radius:\s*(?!0)/.test(css), false, 'a non-zero radius crept in');
});

test('no blurred shadows — depth is the bevel pair only', () => {
  // A hard bevel is `inset Npx Npx 0 <colour>`. Any third length is a blur.
  const shadows = css.match(/box-shadow:[^;]+;/g) || [];
  for (const s of shadows) {
    assert.equal(/\d+px\s+-?\d+px\s+[1-9]/.test(s), false, `blurred shadow: ${s}`);
  }
});

const sourceRoot = fileURLToPath(new URL('../', import.meta.url));

const sourceFiles = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const path = join(directory, entry.name);
  if (entry.isDirectory()) return sourceFiles(path);
  return ['.tsx', '.css'].includes(extname(entry.name)) ? [path] : [];
});

const classTokensInTsx = (source) => {
  const file = ts.createSourceFile('material-scan.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const tokens = [];
  const stringKinds = new Set([
    ts.SyntaxKind.StringLiteral,
    ts.SyntaxKind.NoSubstitutionTemplateLiteral,
    ts.SyntaxKind.TemplateHead,
    ts.SyntaxKind.TemplateMiddle,
    ts.SyntaxKind.TemplateTail,
  ]);
  const visit = (node) => {
    // Scan every string fragment rather than only direct className literals.
    // This covers ternaries, arrays, clsx-style helpers, named variables, and
    // interpolated template expressions without attempting fragile data flow.
    if (stringKinds.has(node.kind) && typeof node.text === 'string') {
      tokens.push(...node.text.split(/\s+/));
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return tokens;
};

const classTokens = sourceFiles(sourceRoot)
  .flatMap((path) => {
    const source = readFileSync(path, 'utf8');
    if (path.endsWith('.css')) {
      return [...source.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((match) => match[1]);
    }
    return classTokensInTsx(source);
  });

test('material scanning sees utilities composed through variables and conditionals', () => {
  const tokens = classTokensInTsx(`
    const classes = selected ? 'rounded-md' : 'shadow-2xl';
    const layered = \`plate \${busy ? 'backdrop-blur-sm' : 'drop-shadow-lg'}\`;
    export const Fixture = () => <div className={classes + layered} />;
  `);
  assert.deepEqual(
    ['rounded-md', 'shadow-2xl', 'backdrop-blur-sm', 'drop-shadow-lg'].every((token) => tokens.includes(token)),
    true,
  );
});

test('source uses no forbidden soft material utilities', () => {
  const forbidden = [
    /^rounded(?:-|$)/,
    /^shadow(?:-|$)/,
    /^(?:backdrop-)?blur(?:-|$)/,
    /^drop-shadow(?:-|$)/,
  ];
  for (const token of classTokens) {
    assert.equal(
      forbidden.some((pattern) => pattern.test(token)),
      false,
      `forbidden material utility: ${token}`,
    );
  }
});

test('keyboard focus uses a hard one-pixel state outline', () => {
  const rule = /\.dt-focus-ring:focus-visible\s*\{([^}]*)\}/.exec(css)?.[1];
  assert.ok(rule, 'needs a shared focus-visible rule');
  assert.match(rule, /outline:\s*1px\s+solid\s+var\(--st-live\)/);
  assert.match(rule, /outline-offset:\s*-[1-9]\d*px/);
  assert.equal(/outline-offset:\s*(?!-)(?:0*\.)?[1-9]/.test(rule), false, 'focus outline must not add space');
});

// --- contrast -------------------------------------------------------------
// Every token that is painted as text sits on --ground. Anything below 4.5:1
// is unreadable body copy, whatever it looks like in isolation.

const value = (token) => {
  const m = new RegExp(`${token}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
  assert.ok(m, `${token} should be a six-digit hex`);
  return m[1];
};

const channels = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const linear = (c) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
const luminance = (h) => {
  const [r, g, b] = channels(h).map(linear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

test('every ink and state token clears WCAG AA against the ground', () => {
  const ground = value('--ground');
  const inkTokens = [
    '--ink', '--ink-tan', '--ink-dim',
    '--st-live', '--st-pass', '--st-fail', '--st-wait', '--st-idle',
  ];
  for (const token of inkTokens) {
    const ratio = contrast(value(token), ground);
    assert.ok(ratio >= 4.5, `${token} (${value(token)}) is ${ratio.toFixed(2)}:1 on ${ground}, needs 4.5:1`);
  }
});
