import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const patches = JSON.parse(readFileSync(resolve(root, 'security/dependency-patches.json'), 'utf8'));
const lock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'));
const sha = (value) => createHash('sha256').update(value).digest('hex');
const mode = process.argv[2] ?? 'verify';
if (!['apply', 'verify', 'audit'].includes(mode)) throw new Error('Invalid security patch mode');

// Do not silently accept changed upstream code or only patch the hoisted copy.
for (const patch of patches) {
  const copies = Object.keys(lock.packages).filter((key) => key.endsWith(`node_modules/${patch.package}`));
  if (!copies.length) throw new Error(`Patch must be reviewed: ${patch.package} no longer installed`);
  for (const copy of copies) {
    if (lock.packages[copy].version !== patch.version) throw new Error(`Patch must be reviewed for ${copy}`);
    const path = resolve(root, copy, patch.file);
    // A production-only install may omit development packages entirely.
    if (!existsSync(resolve(root, copy)) && lock.packages[copy].dev === true) continue;
    const original = readFileSync(path, 'utf8');
    if (sha(original) === patch.patchedSha256) continue;
    if (mode !== 'apply' || sha(original) !== patch.originalSha256) {
      throw new Error(`Missing or unexpected security patch: ${copy}/${patch.file}`);
    }
    let updated = original;
    for (const edit of patch.edits) updated = updated.replaceAll(edit.before, edit.after);
    if (sha(updated) !== patch.patchedSha256) throw new Error('Patch output mismatch');
    writeFileSync(path, updated);
  }
}
console.log(`Verified ${patches.length} dependency security patches.`);

if (mode === 'audit') {
  const test = spawnSync(process.execPath, ['--test', 'scripts/dependency-security.test.mjs'], { cwd: root, stdio: 'inherit' });
  if (test.status !== 0) process.exit(test.status ?? 1);
  const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(command, ['audit', '--json', ...process.argv.slice(3)], { cwd: root, encoding: 'utf8' });
  if (result.error) throw result.error;
  const audit = JSON.parse(result.stdout);
  if (audit.error || !audit.vulnerabilities || ![0, 1].includes(result.status)) throw new Error('npm audit did not complete');
  const mitigated = new Set(patches.map((patch) => patch.advisory));
  const unresolved = [];
  const applied = new Set();
  for (const [name, item] of Object.entries(audit.vulnerabilities)) {
    for (const via of item.via) {
      // String entries only inherit a direct advisory, checked on its own package.
      if (typeof via === 'string') {
        if (!audit.vulnerabilities[via]) unresolved.push(`${name}: unresolved dependency ${via}`);
        continue;
      }
      const id = via.url.split('/').at(-1);
      if (mitigated.has(id) && patches.some((patch) => patch.advisory === id && patch.package === via.name)) applied.add(id);
      else unresolved.push(`${name}: ${id} (${via.severity})`);
    }
  }
  for (const id of applied) console.log(`Upstream advisory retained; verified local patch: ${id}`);
  if (unresolved.length) {
    console.error(unresolved.join('\n'));
    process.exitCode = 1;
  } else console.log('PASS: no unmitigated dependency advisories.');
}
