(function (root) {
  'use strict';

  function open(storage, account, map, writer) {
    const prefix = `orange.route-draft.v1:${encodeURIComponent(account)}:${map.id}:`;
    const key = prefix + writer;
    const identity = map.created_at || map.name;

    function write(document, revision) {
      try {
        storage.setItem(key, JSON.stringify({ identity, revision, document, time: Date.now() }));
        return true;
      } catch (_) { return false; }
    }

    function remove(record) {
      try {
        if (!record || storage.getItem(record.key) === record.raw) storage.removeItem(record?.key || key);
        return true;
      } catch (_) { return false; }
    }

    function list() {
      const records = [];
      try {
        for (let index = 0; index < storage.length; index++) {
          const savedKey = storage.key(index);
          if (!savedKey?.startsWith(prefix) || savedKey === key) continue;
          const raw = storage.getItem(savedKey);
          try {
            const record = JSON.parse(raw);
            if (record?.identity === identity && Number.isInteger(record.revision) &&
                Number.isFinite(record.time) && ['points', 'paths', 'areas'].every(name => Array.isArray(record.document?.[name]))) {
              records.push({ ...record, raw, key: savedKey });
            }
          } catch (_) { /* One unreadable entry should not hide other drafts. */ }
        }
      } catch (_) { /* Browser storage can be disabled. */ }
      return records.sort((a, b) => b.time - a.time);
    }

    return { write, remove, list };
  }

  if (typeof module !== 'undefined') module.exports = { open };
  else root.OrangeDraftRecovery = { open };
})(globalThis);
