const assert = require('node:assert/strict');
const test = require('node:test');
const { tmpdir } = require('node:os');
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs');
const { join } = require('node:path');

const { codexNotifyHelperConfigured } = require('../codex-config');
const { codexHooksHealthy } = require('../codex-hooks');

test('codexNotifyHelperConfigured: detects direct notify-helper entry', () => {
  const content = 'notify = ["/opt/homebrew/bin/node", "/repo/bin/notify-helper.js", "4000"]\n';
  assert.equal(codexNotifyHelperConfigured(content), true);
});

test('codexNotifyHelperConfigured: detects notify when wrapped by Computer Use --previous-notify', () => {
  const content = 'notify = ["/Applications/SkyComputerUseClient", "turn-ended", "--previous-notify", "[\\"/opt/homebrew/bin/node\\",\\"/repo/bin/notify-helper.js\\",\\"4000\\"]"]\n';
  assert.equal(codexNotifyHelperConfigured(content), true);
});

test('codexNotifyHelperConfigured: returns false when notify line lacks notify-helper', () => {
  assert.equal(codexNotifyHelperConfigured('notify = ["/usr/bin/somethingelse"]\n'), false);
  assert.equal(codexNotifyHelperConfigured(''), false);
  assert.equal(codexNotifyHelperConfigured('# notify is commented\n'), false);
});

test('codexHooksHealthy is path-tolerant: matches any worktree path as long as port + route are right', () => {
  const home = mkdtempSync(join(tmpdir(), 'codex-test-'));
  try {
    mkdirSync(join(home, '.codex'), { recursive: true });
    writeFileSync(join(home, '.codex', 'hooks.json'), JSON.stringify({
      hooks: {
        UserPromptSubmit: [{
          hooks: [{
            type: 'command',
            command: '"/opt/homebrew/bin/node" "/Users/foo/Documents/SOME-OLD-PATH/bin/codex-hook.js" 4000 start',
            timeout: 5,
          }],
        }],
        Stop: [{
          hooks: [{
            type: 'command',
            command: '"/opt/homebrew/bin/node" "/totally/different/path/bin/codex-hook.js" 4000 stop',
            timeout: 5,
          }],
        }],
      },
    }, null, 2));
    const helperPath = '/Users/foo/Documents/CURRENT-PATH/bin/codex-hook.js';
    assert.equal(codexHooksHealthy(home, helperPath, 4000), true);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('codexHooksHealthy returns false when port differs (real misconfigure)', () => {
  const home = mkdtempSync(join(tmpdir(), 'codex-test-'));
  try {
    mkdirSync(join(home, '.codex'), { recursive: true });
    writeFileSync(join(home, '.codex', 'hooks.json'), JSON.stringify({
      hooks: {
        UserPromptSubmit: [{ hooks: [{ type: 'command', command: '"/n" "/p/bin/codex-hook.js" 4001 start', timeout: 5 }] }],
        Stop: [{ hooks: [{ type: 'command', command: '"/n" "/p/bin/codex-hook.js" 4001 stop', timeout: 5 }] }],
      },
    }, null, 2));
    assert.equal(codexHooksHealthy(home, '/p/bin/codex-hook.js', 4000), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('codexHooksHealthy returns false when an event is missing', () => {
  const home = mkdtempSync(join(tmpdir(), 'codex-test-'));
  try {
    mkdirSync(join(home, '.codex'), { recursive: true });
    writeFileSync(join(home, '.codex', 'hooks.json'), JSON.stringify({
      hooks: {
        UserPromptSubmit: [{ hooks: [{ type: 'command', command: '"/n" "/p/bin/codex-hook.js" 4000 start', timeout: 5 }] }],
      },
    }, null, 2));
    assert.equal(codexHooksHealthy(home, '/p/bin/codex-hook.js', 4000), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
