function slugFromTitle(title) {
  const cleaned = String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  if (!cleaned) return 'feat/workflow';
  return `feat/${cleaned}`;
}

function isCollision(name, inFlight) {
  return inFlight.has(name);
}

module.exports = { slugFromTitle, isCollision };
