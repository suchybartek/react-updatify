import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function tmpDir(prefix = 'updatify-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Create files from a { 'rel/path': 'content' } map. */
export function writeTree(root, tree) {
  for (const [rel, content] of Object.entries(tree)) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  return root;
}

export function listTree(root, base = root) {
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...listTree(full, base));
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out.sort();
}
