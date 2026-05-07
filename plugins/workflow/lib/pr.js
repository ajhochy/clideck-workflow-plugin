function createPrModule({ runGh }) {
  async function openDraftPr({ repo, branch, base, title, body }) {
    const args = ['pr', 'create', '--repo', repo, '--head', branch, '--base', base, '--draft', '--title', title, '--body', body];
    const out = await runGh(args);
    const m = out.match(/\/pull\/(\d+)/);
    return { number: m ? Number(m[1]) : null, url: out.trim(), draft: true };
  }
  async function updatePrBody({ repo, number, body }) {
    await runGh(['pr', 'edit', String(number), '--repo', repo, '--body', body]);
  }
  async function markReady({ repo, number }) {
    await runGh(['pr', 'ready', String(number), '--repo', repo]);
  }
  return { openDraftPr, updatePrBody, markReady };
}

module.exports = { createPrModule };
