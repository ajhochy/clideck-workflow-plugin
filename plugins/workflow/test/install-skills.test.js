const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { installBundledSkills } = require('../lib/install-skills');

test('installBundledSkills copies bundled skills to a fake home', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-skill-'));
  const tmpPlugin = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-plugin-'));
  fs.mkdirSync(path.join(tmpPlugin, 'skills', 'demo-skill'), { recursive: true });
  fs.writeFileSync(path.join(tmpPlugin, 'skills', 'demo-skill', 'SKILL.md'), '---\nname: demo-skill\n---\nbody');

  const origHome = os.homedir;
  os.homedir = () => tmpHome;
  try {
    installBundledSkills(tmpPlugin);
    const dest = path.join(tmpHome, '.claude', 'skills', 'demo-skill', 'SKILL.md');
    assert.ok(fs.existsSync(dest), 'skill should be installed');
    assert.match(fs.readFileSync(dest, 'utf8'), /name: demo-skill/);

    // Idempotent: second call is a no-op (no throw, file unchanged).
    const before = fs.statSync(dest).mtimeMs;
    installBundledSkills(tmpPlugin);
    const after = fs.statSync(dest).mtimeMs;
    assert.equal(after, before, 'unchanged content should not rewrite');
  } finally {
    os.homedir = origHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(tmpPlugin, { recursive: true, force: true });
  }
});

test('installBundledSkills updates skill when content differs', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-skill-'));
  const tmpPlugin = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-plugin-'));
  fs.mkdirSync(path.join(tmpPlugin, 'skills', 'demo'), { recursive: true });
  fs.writeFileSync(path.join(tmpPlugin, 'skills', 'demo', 'SKILL.md'), 'NEW');

  const destDir = path.join(tmpHome, '.claude', 'skills', 'demo');
  fs.mkdirSync(destDir, { recursive: true });
  fs.writeFileSync(path.join(destDir, 'SKILL.md'), 'OLD');

  const origHome = os.homedir;
  os.homedir = () => tmpHome;
  try {
    installBundledSkills(tmpPlugin);
    assert.equal(fs.readFileSync(path.join(destDir, 'SKILL.md'), 'utf8'), 'NEW');
  } finally {
    os.homedir = origHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(tmpPlugin, { recursive: true, force: true });
  }
});
