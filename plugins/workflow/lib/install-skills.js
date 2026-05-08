const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function installBundledSkills(pluginDir, log = () => {}) {
  const src = path.join(pluginDir, 'skills');
  if (!fs.existsSync(src)) return;
  const dest = path.join(os.homedir(), '.claude', 'skills');
  fs.mkdirSync(dest, { recursive: true });

  for (const name of fs.readdirSync(src)) {
    const srcSkill = path.join(src, name, 'SKILL.md');
    if (!fs.existsSync(srcSkill)) continue;
    const destDir = path.join(dest, name);
    const destSkill = path.join(destDir, 'SKILL.md');
    const srcContent = fs.readFileSync(srcSkill, 'utf8');
    let needsWrite = true;
    try {
      if (fs.readFileSync(destSkill, 'utf8') === srcContent) needsWrite = false;
    } catch {}
    if (needsWrite) {
      fs.mkdirSync(destDir, { recursive: true });
      fs.writeFileSync(destSkill, srcContent);
      log(`Installed bundled skill: ${name}`);
    }
  }
}

module.exports = { installBundledSkills };
