const DB_NAME = 'classquest-db';
const DB_VERSION = 1;
const MAX_SNAPSHOTS = 12;

export class ClassQuestDB {
  constructor() {
    this.dbPromise = null;
    this.corrupted = false;
  }

  async open() {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        reject(new Error('IndexedDB is not supported in this browser.'));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('sessions')) {
          db.createObjectStore('sessions', { keyPath: 'code' });
        }
        if (!db.objectStoreNames.contains('snapshots')) {
          const snapshots = db.createObjectStore('snapshots', { keyPath: 'id' });
          snapshots.createIndex('code', 'code', { unique: false });
          snapshots.createIndex('savedAt', 'savedAt', { unique: false });
        }
        if (!db.objectStoreNames.contains('eventLog')) {
          const eventLog = db.createObjectStore('eventLog', { keyPath: 'id' });
          eventLog.createIndex('code', 'code', { unique: false });
          eventLog.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        this.corrupted = true;
        reject(request.error || new Error('Failed to open ClassQuest database.'));
      };
      request.onblocked = () => reject(new Error('Database access is blocked by another tab.'));
    });
    return this.dbPromise;
  }

  async run(storeName, mode, executor) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      const result = executor(store, tx);
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error || new Error(`Transaction failed for ${storeName}.`));
      tx.onabort = () => reject(tx.error || new Error(`Transaction aborted for ${storeName}.`));
    });
  }

  async put(storeName, value) {
    return this.run(storeName, 'readwrite', (store) => store.put(value));
  }

  async get(storeName, key) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const request = tx.objectStore(storeName).get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error(`Unable to read ${storeName}.`));
    });
  }

  async listSessions() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('sessions', 'readonly');
      const request = tx.objectStore('sessions').getAll();
      request.onsuccess = () => {
        const results = (request.result || []).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        resolve(results);
      };
      request.onerror = () => reject(request.error || new Error('Unable to list sessions.'));
    });
  }

  async saveSessionMeta(sessionMeta) {
    const now = Date.now();
    return this.put('sessions', {
      createdAt: sessionMeta.createdAt || now,
      updatedAt: now,
      ...sessionMeta,
    });
  }

  async getSession(code) {
    return this.get('sessions', code);
  }

  async saveSnapshot(code, state) {
    const now = Date.now();
    await this.put('snapshots', {
      id: `${code}-${now}`,
      code,
      savedAt: now,
      state,
    });
    await this.trimSnapshots(code);
  }

  async trimSnapshots(code) {
    const snapshots = await this.getSnapshots(code);
    if (snapshots.length <= MAX_SNAPSHOTS) return;
    const stale = snapshots.slice(MAX_SNAPSHOTS);
    const db = await this.open();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('snapshots', 'readwrite');
      const store = tx.objectStore('snapshots');
      stale.forEach((entry) => store.delete(entry.id));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Unable to trim snapshots.'));
    });
  }

  async getSnapshots(code) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('snapshots', 'readonly');
      const index = tx.objectStore('snapshots').index('code');
      const request = index.getAll(IDBKeyRange.only(code));
      request.onsuccess = () => {
        const results = (request.result || []).sort((a, b) => b.savedAt - a.savedAt);
        resolve(results);
      };
      request.onerror = () => reject(request.error || new Error('Unable to retrieve snapshots.'));
    });
  }

  async getLatestSnapshot(code) {
    const snapshots = await this.getSnapshots(code);
    return snapshots[0]?.state || null;
  }

  async appendEvent(code, event) {
    const timestamp = event.timestamp || Date.now();
    return this.put('eventLog', {
      id: event.id || `${code}-${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
      code,
      timestamp,
      event,
    });
  }

  async getEvents(code) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('eventLog', 'readonly');
      const index = tx.objectStore('eventLog').index('code');
      const request = index.getAll(IDBKeyRange.only(code));
      request.onsuccess = () => {
        const results = (request.result || [])
          .map((entry) => entry.event)
          .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        resolve(results);
      };
      request.onerror = () => reject(request.error || new Error('Unable to retrieve event log.'));
    });
  }

  async restoreSession(code) {
    const [session, state, events] = await Promise.all([
      this.getSession(code),
      this.getLatestSnapshot(code),
      this.getEvents(code),
    ]);
    return { session, state, events };
  }

  async exportSession(code) {
    const [session, state, events] = await Promise.all([
      this.getSession(code),
      this.getLatestSnapshot(code),
      this.getEvents(code),
    ]);
    if (!session || !state) throw new Error('Nothing to export for this classroom yet.');
    return {
      exportedAt: Date.now(),
      schemaVersion: 1,
      session,
      state,
      events,
    };
  }

  async importSession(payload) {
    if (!payload?.session?.code || !payload?.state) {
      throw new Error('Import file is missing required ClassQuest session data.');
    }
    await this.saveSessionMeta(payload.session);
    await this.saveSnapshot(payload.session.code, payload.state);
    const events = Array.isArray(payload.events) ? payload.events : [];
    for (const event of events.slice(-500)) {
      await this.appendEvent(payload.session.code, event);
    }
    return payload.state;
  }

  async recover() {
    if (this.dbPromise) {
      const db = await this.dbPromise.catch(() => null);
      db?.close?.();
    }
    this.dbPromise = null;
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(DB_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error('Unable to delete corrupted database.'));
      request.onblocked = () => reject(new Error('Close other ClassQuest tabs before recovery.'));
    });
    this.corrupted = false;
  }
}

export const db = new ClassQuestDB();

export const storage = {
  getJSON(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  },
  setJSON(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  },
  get(key, fallback = '') {
    return localStorage.getItem(key) ?? fallback;
  },
  set(key, value) {
    localStorage.setItem(key, value);
  },
  remove(key) {
    localStorage.removeItem(key);
  },
};
