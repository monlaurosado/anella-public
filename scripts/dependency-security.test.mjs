import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const braces = require('braces');
const guarded = { name: 'RangeError', message: 'braces nesting exceeds security limit (128)' };

test('ordinary brace expansion and compilation remain compatible', () => {
  assert.deepEqual(braces.expand('src/{app,lib}/{a,b}.ts'), ['src/app/a.ts', 'src/app/b.ts', 'src/lib/a.ts', 'src/lib/b.ts']);
  assert.equal(braces.compile('a/{b,c}/d'), 'a/(b|c)/d');
  assert.equal(braces.stringify(braces.parse('a/{b,c}/d')), 'a/{b,c}/d');
  assert.deepEqual(braces.expand('{1..3}'), ['1', '2', '3']);
});

test('deep braces and parentheses reject before overflowing the call stack', () => {
  for (const [open, close] of [['{', '}'], ['(', ')']]) {
    const input = open.repeat(4000) + 'a,b' + close.repeat(4000);
    for (const operation of ['parse', 'compile', 'expand', 'stringify']) {
      assert.throws(() => braces[operation](input), guarded);
    }
  }
});

test('recursive AST consumers enforce their own depth limit', () => {
  for (const operation of ['compile', 'expand', 'stringify']) {
    let ast = { type: 'root', nodes: [] };
    for (let i = 0; i < 10000; i++) ast = { type: 'root', nodes: [ast] };
    assert.throws(() => braces[operation](ast), guarded);
    const cyclic = { type: 'root', nodes: [] };
    cyclic.nodes.push(cyclic);
    assert.throws(() => braces[operation](cyclic), guarded);
  }
});
