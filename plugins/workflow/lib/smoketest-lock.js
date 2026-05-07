function createLock() {
  let held = null; // { id }
  const waiters = []; // { id, resolve, reject }

  function makeRelease(id) {
    return {
      release() {
        if (!held || held.id !== id) return;
        held = null;
        const next = waiters.shift();
        if (next) {
          held = { id: next.id };
          next.resolve(makeRelease(next.id));
        }
      },
    };
  }

  function acquire(id) {
    return new Promise((resolve, reject) => {
      if (!held) {
        held = { id };
        resolve(makeRelease(id));
        return;
      }
      waiters.push({ id, resolve, reject });
    });
  }

  function cancel(id) {
    const idx = waiters.findIndex((w) => w.id === id);
    if (idx >= 0) {
      const [w] = waiters.splice(idx, 1);
      w.reject(new Error('cancelled'));
    }
  }

  function queue() { return waiters.map((w) => w.id); }
  function holder() { return held ? held.id : null; }

  return { acquire, cancel, queue, holder };
}

module.exports = { createLock };
