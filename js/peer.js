import { generateId } from './state.js';
import { storage } from './db.js';

const PING_INTERVAL = 15000;
const MAX_RECONNECT_ATTEMPTS = 6;

export class PeerConnectionManager extends EventTarget {
  constructor(role = 'teacher') {
    super();
    this.role = role;
    this.classroomCode = '';
    this.peer = null;
    this.conn = null;
    this.connections = new Map();
    this.channel = null;
    this.demoMode = false;
    this.pingTimer = null;
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
    this.hostOnline = false;
    this.joinPayload = null;
    this.clientId = storage.get('classquest:client-id') || generateId('client');
    storage.set('classquest:client-id', this.clientId);
  }

  emit(name, detail = {}) {
    this.dispatchEvent(new CustomEvent(name, { detail }));
  }

  get peerId() {
    return this.classroomCode ? `classquest-${this.classroomCode}` : '';
  }

  async startHost(code) {
    this.cleanup();
    this.role = 'teacher';
    this.classroomCode = code;
    this.setupBroadcastChannel();
    if (!window.Peer) {
      return this.enableDemoMode('PeerJS unavailable - demo mode active.');
    }
    try {
      await new Promise((resolve, reject) => {
        this.peer = new window.Peer(this.peerId);
        this.peer.on('open', resolve);
        this.peer.on('connection', (conn) => this.attachHostConnection(conn));
        this.peer.on('error', reject);
        this.peer.on('disconnected', () => this.emit('status', { status: 'host-disconnected' }));
      });
      this.demoMode = false;
      this.hostOnline = true;
      this.startPinging();
      this.emit('status', { status: 'hosting', demoMode: false });
      return { demoMode: false };
    } catch (error) {
      return this.enableDemoMode(error.message || 'PeerJS host unavailable.');
    }
  }

  async connectToHost(code, joinPayload) {
    this.cleanup();
    this.role = 'student';
    this.classroomCode = code;
    this.joinPayload = joinPayload;
    this.setupBroadcastChannel();
    if (!window.Peer) {
      const result = this.enableDemoMode('PeerJS unavailable - trying local demo mode.');
      this.sendJoinRequest();
      return result;
    }
    try {
      await new Promise((resolve, reject) => {
        this.peer = new window.Peer();
        this.peer.on('open', resolve);
        this.peer.on('error', reject);
      });
      this.conn = this.peer.connect(this.peerId, { reliable: true });
      this.attachStudentConnection(this.conn);
      return { demoMode: false };
    } catch (error) {
      const result = this.enableDemoMode(error.message || 'PeerJS connection unavailable.');
      this.sendJoinRequest();
      return result;
    }
  }

  setupBroadcastChannel() {
    if (!('BroadcastChannel' in window)) return;
    this.channel?.close?.();
    this.channel = new BroadcastChannel(`classquest-${this.classroomCode}`);
    this.channel.onmessage = (event) => this.handleBroadcastMessage(event.data);
  }

  handleBroadcastMessage(message) {
    if (!message || message.source === this.clientId) return;
    if (this.role === 'teacher') {
      if (message.type === 'JOIN_REQUEST') {
        this.emit('join-request', {
          connectionId: message.source,
          transport: 'broadcast',
          payload: message.payload,
        });
      }
      if (message.type?.startsWith('INTENT_')) {
        this.emit('student-intent', {
          connectionId: message.source,
          transport: 'broadcast',
          message,
        });
      }
      if (message.type === 'PONG') {
        this.emit('pong', { connectionId: message.source });
      }
    } else {
      if (message.target && message.target !== this.clientId && message.target !== 'all') return;
      this.receiveStudentMessage(message);
    }
  }

  attachHostConnection(conn) {
    const connectionId = conn.peer;
    this.connections.set(connectionId, conn);
    conn.on('data', (message) => {
      if (message?.type === 'JOIN_REQUEST') {
        this.emit('join-request', { connectionId, transport: 'peer', payload: message.payload });
        return;
      }
      if (message?.type?.startsWith('INTENT_')) {
        this.emit('student-intent', { connectionId, transport: 'peer', message });
        return;
      }
      if (message?.type === 'PONG') {
        this.emit('pong', { connectionId });
      }
    });
    conn.on('open', () => this.emit('connection-open', { connectionId }));
    conn.on('close', () => {
      this.connections.delete(connectionId);
      this.emit('connection-close', { connectionId });
    });
    conn.on('error', (error) => this.emit('status', { status: 'peer-error', message: error.message }));
  }

  attachStudentConnection(conn) {
    conn.on('open', () => {
      this.hostOnline = true;
      this.emit('status', { status: 'connected', demoMode: false });
      this.reconnectAttempts = 0;
      this.sendJoinRequest();
      this.startPinging();
    });
    conn.on('data', (message) => this.receiveStudentMessage(message));
    conn.on('close', () => {
      this.hostOnline = false;
      this.emit('status', { status: 'offline', demoMode: this.demoMode });
      this.scheduleReconnect();
    });
    conn.on('error', () => {
      this.hostOnline = false;
      this.emit('status', { status: 'offline', demoMode: this.demoMode });
      this.scheduleReconnect();
    });
  }

  receiveStudentMessage(message) {
    if (!message) return;
    if (message.type === 'JOIN_ACCEPT') {
      this.hostOnline = true;
      this.emit('join-accepted', message);
      this.flushPendingQueue();
      return;
    }
    if (message.type === 'JOIN_DENY') {
      this.emit('join-denied', message);
      return;
    }
    if (message.type === 'STATE_SNAPSHOT') {
      this.emit('state-snapshot', message);
      return;
    }
    if (message.type === 'STATE_DELTA') {
      this.emit('state-delta', message);
      return;
    }
    if (message.type === 'PING') {
      this.sendDirect({ type: 'PONG', timestamp: Date.now() });
    }
  }

  sendJoinRequest() {
    const payload = {
      type: 'JOIN_REQUEST',
      source: this.clientId,
      payload: this.joinPayload,
      timestamp: Date.now(),
    };
    this.sendDirect(payload);
  }

  approveJoin(connectionId, student, snapshot, targetTransport = 'peer') {
    this.sendToStudent(connectionId, {
      type: 'JOIN_ACCEPT',
      payload: student,
      snapshot,
      timestamp: Date.now(),
    }, targetTransport);
  }

  denyJoin(connectionId, reason = 'Teacher denied the request.', targetTransport = 'peer') {
    this.sendToStudent(connectionId, {
      type: 'JOIN_DENY',
      reason,
      timestamp: Date.now(),
    }, targetTransport);
  }

  broadcastSnapshot(state) {
    this.broadcast({ type: 'STATE_SNAPSHOT', state, timestamp: Date.now() });
  }

  broadcastDelta(delta) {
    this.broadcast({ type: 'STATE_DELTA', delta, timestamp: Date.now() });
  }

  sendIntent(type, payload) {
    const message = {
      type,
      payload,
      source: this.clientId,
      timestamp: Date.now(),
      id: generateId('intent'),
    };
    if (this.hostOnline) {
      this.sendDirect(message);
    } else {
      this.enqueuePendingAction(message);
    }
  }

  sendToStudent(connectionId, message, transport = 'peer') {
    if (transport === 'broadcast' || this.demoMode) {
      this.channel?.postMessage({ ...message, source: 'teacher', target: connectionId });
      return;
    }
    const conn = this.connections.get(connectionId);
    if (conn?.open) conn.send(message);
  }

  sendDirect(message) {
    if (this.conn?.open) {
      this.conn.send(message);
      return;
    }
    if (this.channel) {
      this.channel.postMessage(message);
    }
  }

  broadcast(message) {
    for (const conn of this.connections.values()) {
      if (conn?.open) conn.send(message);
    }
    this.channel?.postMessage({ ...message, source: 'teacher', target: 'all' });
  }

  startPinging() {
    clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => {
      const message = { type: 'PING', timestamp: Date.now() };
      if (this.role === 'teacher') this.broadcast(message);
      else this.sendDirect(message);
    }, PING_INTERVAL);
  }

  scheduleReconnect() {
    if (this.role !== 'student' || this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) return;
    clearTimeout(this.reconnectTimer);
    const delay = Math.min(30000, 1000 * 2 ** this.reconnectAttempts);
    this.emit('reconnecting', { attempt: this.reconnectAttempts + 1, delay });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempts += 1;
      this.connectToHost(this.classroomCode, this.joinPayload);
    }, delay);
  }

  getQueueKey() {
    const studentId = this.joinPayload?.studentId || 'anonymous';
    return `classquest:queue:${this.classroomCode}:${studentId}`;
  }

  enqueuePendingAction(message) {
    const queue = storage.getJSON(this.getQueueKey(), []);
    queue.push(message);
    storage.setJSON(this.getQueueKey(), queue);
    this.emit('queue-update', { count: queue.length });
  }

  flushPendingQueue() {
    const queue = storage.getJSON(this.getQueueKey(), []);
    if (!queue.length) {
      this.emit('queue-update', { count: 0 });
      return;
    }
    queue.forEach((message) => this.sendDirect(message));
    storage.remove(this.getQueueKey());
    this.emit('queue-update', { count: 0 });
  }

  enableDemoMode(message) {
    this.demoMode = true;
    this.hostOnline = this.role === 'teacher';
    this.emit('status', { status: this.role === 'teacher' ? 'hosting' : 'demo', demoMode: true, message });
    this.startPinging();
    return { demoMode: true, message };
  }

  cleanup() {
    clearInterval(this.pingTimer);
    clearTimeout(this.reconnectTimer);
    this.connections.forEach((conn) => conn?.close?.());
    this.connections.clear();
    this.conn?.close?.();
    this.conn = null;
    this.peer?.destroy?.();
    this.peer = null;
    this.channel?.close?.();
    this.channel = null;
  }
}
