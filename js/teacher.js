import { db, storage } from './db.js';
import { summarizeStudent } from './gamification.js';
import { PeerConnectionManager } from './peer.js';
import { createDelta, createInitialState, generateId, generateClassCode, hydrateState, reduceState } from './state.js';

function formatDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString();
}

function escapeHtml(text = '') {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export class TeacherApp {
  constructor({ root, toast, celebrate, updateConnectionPill }) {
    this.root = root;
    this.toast = toast;
    this.celebrate = celebrate;
    this.updateConnectionPill = updateConnectionPill;
    this.peer = new PeerConnectionManager('teacher');
    this.state = null;
    this.currentTab = 'session';
    this.pendingJoins = [];
    this.activeStudentId = '';
    this.restoreSessions = [];
    this.snapshotTimer = null;
    this.importInputId = `teacher-import-${generateId('input')}`;
    this.attachPeerEvents();
  }

  async init() {
    try {
      await db.open();
      this.restoreSessions = await db.listSessions();
    } catch (error) {
      this.toast(error.message || 'IndexedDB unavailable. Running with local storage only.');
    }
    this.render();
  }

  destroy() {
    clearInterval(this.snapshotTimer);
    this.peer.cleanup();
  }

  attachPeerEvents() {
    this.peer.addEventListener('status', (event) => {
      const detail = event.detail || {};
      this.updateConnectionPill(detail.demoMode ? 'Demo Mode' : detail.status, detail.demoMode ? 'demo' : detail.status.includes('offline') ? 'offline' : 'online');
      if (detail.message) this.toast(detail.message);
    });

    this.peer.addEventListener('join-request', (event) => {
      const detail = event.detail;
      this.pendingJoins = [
        ...this.pendingJoins.filter((item) => item.connectionId !== detail.connectionId),
        detail,
      ];
      this.currentTab = 'roster';
      this.toast(`Join request from ${detail.payload?.name || detail.payload?.studentId || 'student'}`);
      this.render();
    });

    this.peer.addEventListener('student-intent', async (event) => {
      const { message } = event.detail;
      if (message.type === 'INTENT_MARK_IN_PROGRESS') {
        await this.applyAuthoritativeAction({
          type: 'MARK_ASSIGNMENT_STATUS',
          assignmentId: message.payload.assignmentId,
          studentId: message.payload.studentId,
          status: 'in-progress',
          timestamp: message.timestamp,
        }, true);
      }
      if (message.type === 'INTENT_SUBMIT_ASSIGNMENT') {
        await this.applyAuthoritativeAction({
          type: 'MARK_ASSIGNMENT_STATUS',
          assignmentId: message.payload.assignmentId,
          studentId: message.payload.studentId,
          status: 'submitted',
          timestamp: message.timestamp,
          note: message.payload.note || '',
        }, true);
      }
    });

    this.peer.addEventListener('connection-close', async ({ detail }) => {
      const studentId = this.findStudentByConnection(detail.connectionId);
      if (studentId) {
        await this.applyAuthoritativeAction({ type: 'SET_STUDENT_STATUS', studentId, status: 'offline' }, true, false);
      }
    });
  }

  findStudentByConnection(connectionId) {
    return Object.values(this.state?.students || {}).find((student) => student.connectionId === connectionId)?.id || '';
  }

  async loadSession(code) {
    if (!code) return;
    const restored = await db.restoreSession(code);
    if (!restored.state) {
      this.toast('No saved snapshot found for that classroom yet.');
      return;
    }
    this.state = hydrateState(restored.state);
    await this.peer.startHost(this.state.classInfo.code);
    storage.setJSON('classquest:last-teacher-session', { code: this.state.classInfo.code });
    this.startSnapshotLoop();
    this.toast(`Restored ${this.state.classInfo.name}`);
    this.render();
  }

  startSnapshotLoop() {
    clearInterval(this.snapshotTimer);
    this.snapshotTimer = setInterval(() => {
      if (this.state?.classInfo?.code) {
        this.persistState();
      }
    }, 30000);
  }

  async persistState() {
    if (!this.state?.classInfo?.code) return;
    try {
      await db.saveSessionMeta({
        code: this.state.classInfo.code,
        name: this.state.classInfo.name,
        period: this.state.classInfo.period,
        updatedAt: Date.now(),
      });
      await db.saveSnapshot(this.state.classInfo.code, this.state);
    } catch (error) {
      this.toast(error.message || 'Unable to save snapshot locally.');
    }
  }

  async applyAuthoritativeAction(action, broadcast = true, logEvent = true) {
    if (!this.state) return;
    const previousVersion = this.state.version;
    const result = reduceState(this.state, action);
    this.state = result.state;
    if (logEvent) {
      db.appendEvent(this.state.classInfo.code, {
        id: generateId('event'),
        action,
        timestamp: Date.now(),
        version: this.state.version,
      }).catch(() => null);
    }
    await this.persistState();
    if (broadcast) {
      const delta = createDelta(previousVersion, action);
      delta.version = this.state.version;
      delta.vector = this.state.versionVector;
      this.peer.broadcastDelta(delta);
    }
    result.meta.awardedBadges.forEach(({ studentId, badgeIds }) => {
      if (badgeIds.length) {
        const studentName = this.state.students[studentId]?.name || 'Student';
        this.toast(`${studentName} earned: ${badgeIds.map((badgeId) => this.state.badges.find((badge) => badge.id === badgeId)?.name || badgeId).join(', ')}`);
      }
    });
    result.meta.celebrations.forEach(({ studentId, level }) => {
      this.celebrate(`${this.state.students[studentId]?.name || 'Student'} reached Level ${level}!`);
    });
    this.render();
  }

  async createSession(formData, seedDemo = false) {
    const code = generateClassCode();
    this.state = createInitialState({
      code,
      name: formData.get('className') || 'Quest Academy',
      period: formData.get('period') || 'Period 1',
      seedDemo,
    });
    await this.peer.startHost(code);
    this.pendingJoins = [];
    this.currentTab = 'session';
    this.startSnapshotLoop();
    storage.setJSON('classquest:last-teacher-session', { code });
    await this.persistState();
    this.restoreSessions = await db.listSessions().catch(() => []);
    this.toast(`Session ${code} is live.`);
    this.render();
  }

  async approveJoin(connectionId) {
    const request = this.pendingJoins.find((item) => item.connectionId === connectionId);
    if (!request || !this.state) return;
    const studentId = (request.payload.studentId || request.payload.name || '').trim().toLowerCase().replace(/\s+/g, '-');
    await this.applyAuthoritativeAction({
      type: 'APPROVE_STUDENT',
      student: {
        id: studentId || generateId('student'),
        name: request.payload.name || request.payload.studentId || 'Student',
      },
    }, false);
    this.state.students[studentId].connectionId = connectionId;
    this.state.students[studentId].connStatus = 'online';
    await this.persistState();
    this.peer.approveJoin(connectionId, this.state.students[studentId], this.state, request.transport);
    this.peer.broadcastSnapshot(this.state);
    this.pendingJoins = this.pendingJoins.filter((item) => item.connectionId !== connectionId);
    this.toast(`${this.state.students[studentId].name} joined the classroom.`);
    this.render();
  }

  denyJoin(connectionId) {
    const request = this.pendingJoins.find((item) => item.connectionId === connectionId);
    this.peer.denyJoin(connectionId, 'The teacher denied this join request.', request?.transport || 'peer');
    this.pendingJoins = this.pendingJoins.filter((item) => item.connectionId !== connectionId);
    this.toast('Join request denied.');
    this.render();
  }

  render() {
    if (!this.state) {
      this.root.innerHTML = this.renderSessionSetup();
    } else {
      this.root.innerHTML = this.renderDashboard();
    }
    this.bindEvents();
  }

  renderSessionSetup() {
    const restoreOptions = this.restoreSessions.length
      ? this.restoreSessions.map((session) => `<option value="${session.code}">${escapeHtml(session.name || session.code)} · ${escapeHtml(session.period || 'Period')} · ${session.code}</option>`).join('')
      : '<option value="">No saved sessions yet</option>';
    return `
      <section class="join-card">
        <div class="hero">
          <div>
            <p class="eyebrow">Teacher mode</p>
            <h2>Launch a classroom adventure in minutes.</h2>
            <p>Host the authoritative ClassQuest session directly in your browser, admit students live, and keep a resilient local snapshot every 30 seconds.</p>
            <div class="hero-actions">
              <button class="primary-button" type="button" data-action="demo-teacher">Open demo dashboard</button>
            </div>
          </div>
          <div class="hero-panel">
            <div class="hero-stat"><span>Connection</span><strong>PeerJS + IndexedDB + demo fallback</strong></div>
            <div class="hero-stat"><span>Recovery</span><strong>Restore from local snapshots or import backup JSON</strong></div>
            <div class="hero-stat"><span>Authority</span><strong>Teacher validates intents and broadcasts deltas</strong></div>
          </div>
        </div>
        <div class="dashboard two-col">
          <section class="view-card">
            <h3>Create a new session</h3>
            <form id="teacher-session-form" class="form-stack">
              <label><span>Class name</span><input class="field" name="className" type="text" value="Quest Academy" required /></label>
              <label><span>Period</span><input class="field" name="period" type="text" value="Period 1" required /></label>
              <div class="button-row">
                <button class="primary-button" type="submit">Create Session</button>
              </div>
            </form>
          </section>
          <section class="view-card">
            <h3>Restore a classroom</h3>
            <div class="form-stack">
              <label><span>Saved sessions</span><select class="field" id="restore-session-select">${restoreOptions}</select></label>
              <div class="button-row">
                <button class="secondary-button" type="button" data-action="restore-selected">Restore Selected</button>
                <button class="ghost-button" type="button" data-action="import-session">Import Backup</button>
                <button class="danger-button" type="button" data-action="recover-db">Recover DB</button>
              </div>
              <p class="footer-note">Use recovery if IndexedDB data is corrupted. Import accepts a JSON backup exported from the Session tab.</p>
              <input class="sr-only" id="${this.importInputId}" type="file" accept="application/json" />
            </div>
          </section>
        </div>
      </section>
    `;
  }

  renderDashboard() {
    const tabs = [
      ['session', 'Session'],
      ['roster', 'Roster'],
      ['behavior', 'Behavior'],
      ['assignments', 'Assignments'],
      ['leaderboard', 'Leaderboard'],
      ['goals', 'Goals'],
      ['settings', 'Settings'],
    ];
    return `
      <section class="dashboard">
        <div class="dashboard-header">
          <div>
            <p class="eyebrow">Teacher dashboard</p>
            <h2>${escapeHtml(this.state.classInfo.name)} · ${escapeHtml(this.state.classInfo.period)}</h2>
            <p class="muted">Version ${this.state.version} · ${Object.keys(this.state.students).length} students · IndexedDB snapshots active</p>
          </div>
          <div class="level-chip">Class Code <span>${escapeHtml(this.state.classInfo.code)}</span></div>
        </div>
        <div class="tab-row">
          ${tabs.map(([id, label]) => `<button class="tab-pill ${this.currentTab === id ? 'active' : ''}" type="button" data-tab="${id}">${label}</button>`).join('')}
        </div>
        ${this.renderTabPanel()}
      </section>
    `;
  }

  renderTabPanel() {
    switch (this.currentTab) {
      case 'session':
        return this.renderSessionTab();
      case 'roster':
        return this.renderRosterTab();
      case 'behavior':
        return this.renderBehaviorTab();
      case 'assignments':
        return this.renderAssignmentsTab();
      case 'leaderboard':
        return this.renderLeaderboardTab();
      case 'goals':
        return this.renderGoalsTab();
      case 'settings':
        return this.renderSettingsTab();
      default:
        return this.renderSessionTab();
    }
  }

  renderSessionTab() {
    const joinUrl = `${window.location.origin}${window.location.pathname}?mode=student&code=${this.state.classInfo.code}`;
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(joinUrl)}`;
    const pendingMarkup = this.pendingJoins.length
      ? `<div class="request-list">${this.pendingJoins.map((request) => `
          <div class="request-row">
            <div>
              <div class="row-title">${escapeHtml(request.payload?.name || request.payload?.studentId || 'Student')}</div>
              <div class="muted">${escapeHtml(request.payload?.studentId || 'No ID provided')}</div>
            </div>
            <div class="inline-actions">
              <button class="primary-button" type="button" data-action="approve-join" data-connection-id="${request.connectionId}">Approve</button>
              <button class="ghost-button" type="button" data-action="deny-join" data-connection-id="${request.connectionId}">Deny</button>
            </div>
          </div>
        `).join('')}</div>`
      : '<div class="empty-state">No pending join requests.</div>';
    return `
      <div class="split-grid">
        <section class="view-card">
          <div class="session-banner">
            <div>
              <p class="muted">Share this code or scan the QR link below.</p>
              <div class="code-display">${escapeHtml(this.state.classInfo.code)}</div>
            </div>
            <div class="inline-actions">
              <button class="secondary-button" type="button" data-action="copy-join-url">Copy Join URL</button>
              <button class="ghost-button" type="button" data-action="export-session">Export Backup</button>
            </div>
          </div>
          <div class="dashboard two-col">
            <div class="qr-card">
              <img src="${qrUrl}" alt="QR code for the classroom join URL" />
              <div class="muted">${escapeHtml(joinUrl)}</div>
            </div>
            <div class="view-card">
              <h3>Session controls</h3>
              <div class="form-stack">
                <label><span>Class name</span><input class="field" id="session-class-name" type="text" value="${escapeHtml(this.state.classInfo.name)}" /></label>
                <label><span>Period</span><input class="field" id="session-period" type="text" value="${escapeHtml(this.state.classInfo.period)}" /></label>
                <div class="button-row">
                  <button class="primary-button" type="button" data-action="save-class-info">Save Details</button>
                  <button class="ghost-button" type="button" data-action="broadcast-snapshot">Broadcast Snapshot</button>
                </div>
              </div>
            </div>
          </div>
        </section>
        <section class="view-card">
          <h3>Join approvals</h3>
          ${pendingMarkup}
        </section>
      </div>
    `;
  }

  renderRosterTab() {
    const students = Object.values(this.state.students || {});
    const selected = this.state.students[this.activeStudentId] || students[0] || null;
    if (!this.activeStudentId && selected) this.activeStudentId = selected.id;
    const requestMarkup = this.pendingJoins.length
      ? `<div class="request-list">${this.pendingJoins.map((request) => `
          <div class="request-row">
            <div>
              <div class="row-title">${escapeHtml(request.payload?.name || request.payload?.studentId || 'Student')}</div>
              <div class="muted">Awaiting approval</div>
            </div>
            <div class="inline-actions">
              <button class="primary-button" type="button" data-action="approve-join" data-connection-id="${request.connectionId}">Approve</button>
              <button class="ghost-button" type="button" data-action="deny-join" data-connection-id="${request.connectionId}">Deny</button>
            </div>
          </div>
        `).join('')}</div>`
      : '';
    const profile = selected
      ? (() => {
          const summary = summarizeStudent(selected);
          return `
            <div class="profile-card">
              <h3>${escapeHtml(selected.name)}</h3>
              <p class="muted">${escapeHtml(selected.id)} · Last active ${formatDateTime(selected.lastActive)}</p>
              <div class="stat-grid three-col">
                <div class="metric-card"><div class="metric-label">XP</div><div class="metric-value">${summary.xp}</div></div>
                <div class="metric-card"><div class="metric-label">Level</div><div class="metric-value">${summary.level}</div></div>
                <div class="metric-card"><div class="metric-label">Streak</div><div class="metric-value">${summary.streak}</div></div>
              </div>
              <div class="xp-bar-shell"><div class="xp-bar-fill" style="width:${summary.progress.percent}%"></div></div>
              <p class="muted">${summary.progress.toNextLevel} XP to the next level.</p>
              <h4>Badges</h4>
              <div class="inline-actions">${(selected.badges || []).map((badgeId) => {
                const badge = this.state.badges.find((item) => item.id === badgeId);
                return `<span class="mini-pill positive">${badge?.icon || '🏅'} ${escapeHtml(badge?.name || badgeId)}</span>`;
              }).join('') || '<span class="muted">No badges yet.</span>'}</div>
            </div>
          `;
        })()
      : '<div class="empty-state">Approve students to view profiles.</div>';
    return `
      <div class="roster-layout">
        <section class="view-card">
          <h3>Live roster</h3>
          ${requestMarkup}
          <div class="roster-list">
            ${students.length ? students.sort((a, b) => b.xp - a.xp).map((student) => `
              <button class="list-row" type="button" data-action="select-student" data-student-id="${student.id}">
                <div>
                  <div class="row-title">${escapeHtml(student.name)}</div>
                  <div class="muted">${escapeHtml(student.id)}</div>
                </div>
                <div class="inline-actions">
                  <span class="status-pill ${student.connStatus === 'online' ? 'online' : 'offline'}"><span class="status-dot ${student.connStatus === 'online' ? 'online' : 'offline'}"></span>${escapeHtml(student.connStatus)}</span>
                  <span class="mini-pill">${student.xp} XP</span>
                </div>
              </button>
            `).join('') : '<div class="empty-state">No students connected yet.</div>'}
          </div>
        </section>
        <section class="view-card">
          ${profile}
        </section>
      </div>
    `;
  }

  renderBehaviorTab() {
    const students = Object.values(this.state.students || {});
    return `
      <div class="two-col">
        <section class="view-card">
          <h3>Log behavior</h3>
          <form id="behavior-form" class="form-stack">
            <div>
              <span class="label">Select student(s)</span>
              <div class="card-grid">
                ${students.length ? students.map((student) => `
                  <label class="list-row">
                    <div>
                      <div class="row-title">${escapeHtml(student.name)}</div>
                      <div class="muted">${student.xp} XP · ${student.streak} streak</div>
                    </div>
                    <input type="checkbox" name="studentIds" value="${student.id}" />
                  </label>
                `).join('') : '<div class="empty-state">No students available yet.</div>'}
              </div>
            </div>
            <label><span>Category</span>
              <select class="field" name="categoryId">
                ${this.state.behaviorCategories.map((category) => `<option value="${category.id}">${escapeHtml(category.name)} (${category.points > 0 ? '+' : ''}${category.points})</option>`).join('')}
              </select>
            </label>
            <label><span>Note</span><textarea name="note" placeholder="Optional context for this event"></textarea></label>
            <div class="button-row"><button class="primary-button" type="submit">Apply Behavior Event</button></div>
          </form>
        </section>
        <section class="view-card">
          <h3>Recent behavior timeline</h3>
          <div class="timeline-list">
            ${this.state.behaviorLog.length ? this.state.behaviorLog.slice(0, 18).map((event) => {
              const student = this.state.students[event.studentId];
              const category = this.state.behaviorCategories.find((item) => item.id === event.categoryId);
              return `
                <div class="timeline-item">
                  <strong>${escapeHtml(student?.name || event.studentId)}</strong> · ${escapeHtml(category?.name || event.categoryId)}
                  <div class="muted">${event.points > 0 ? '+' : ''}${event.points} XP · ${formatDateTime(event.timestamp)}</div>
                  ${event.note ? `<div>${escapeHtml(event.note)}</div>` : ''}
                </div>
              `;
            }).join('') : '<div class="empty-state">No behavior events logged yet.</div>'}
          </div>
        </section>
      </div>
    `;
  }

  renderAssignmentsTab() {
    const assignments = Object.values(this.state.assignments || {}).filter((assignment) => !assignment.archived);
    return `
      <div class="dashboard">
        <section class="view-card">
          <h3>Create or edit assignments</h3>
          <form id="assignment-form" class="form-grid">
            <input type="hidden" name="assignmentId" id="assignment-id" />
            <label><span>Title</span><input class="field" name="title" type="text" required /></label>
            <label><span>Due date</span><input class="field" name="dueDate" type="date" required /></label>
            <label class="span-2"><span>Description</span><textarea name="desc" required></textarea></label>
            <label><span>XP reward</span><input class="field" name="xpReward" type="number" min="0" value="50" required /></label>
            <label><span>Late penalty</span><input class="field" name="latePenalty" type="number" min="0" value="10" required /></label>
            <div class="span-2 button-row">
              <button class="primary-button" type="submit">Save Assignment</button>
              <button class="ghost-button" type="reset">Clear</button>
            </div>
          </form>
        </section>
        <section class="assignment-grid">
          ${assignments.length ? assignments.map((assignment) => `
            <article class="assignment-card">
              <div class="inline-actions">
                <h4>${escapeHtml(assignment.title)}</h4>
                <span class="mini-pill">${assignment.xpReward} XP</span>
              </div>
              <p class="muted">Due ${formatDate(assignment.dueDate)} · Late penalty ${assignment.latePenalty} XP</p>
              <p>${escapeHtml(assignment.desc)}</p>
              <div class="button-row">
                <button class="secondary-button" type="button" data-action="edit-assignment" data-assignment-id="${assignment.id}">Edit</button>
                <button class="ghost-button" type="button" data-action="archive-assignment" data-assignment-id="${assignment.id}">Archive</button>
              </div>
              <table class="table-lite">
                <thead><tr><th>Student</th><th>Status</th><th>Review</th></tr></thead>
                <tbody>
                  ${Object.values(this.state.students || {}).map((student) => {
                    const status = assignment.studentStatuses?.[student.id] || 'assigned';
                    return `
                      <tr>
                        <td>${escapeHtml(student.name)}</td>
                        <td class="assign-status ${status}">${escapeHtml(status)}</td>
                        <td>
                          ${status === 'submitted'
                            ? `<div class="inline-actions">
                                <button class="primary-button" type="button" data-action="approve-submission" data-assignment-id="${assignment.id}" data-student-id="${student.id}">Approve</button>
                                <button class="ghost-button" type="button" data-action="deny-submission" data-assignment-id="${assignment.id}" data-student-id="${student.id}">Deny</button>
                              </div>`
                            : '<span class="muted">—</span>'}
                        </td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </article>
          `).join('') : '<div class="empty-state">No active assignments yet.</div>'}
        </section>
      </div>
    `;
  }

  renderLeaderboardTab() {
    const ranked = Object.values(this.state.students || {}).sort((a, b) => b.xp - a.xp);
    return `
      <div class="split-grid">
        <section class="view-card">
          <h3>Leaderboard</h3>
          <div class="leaderboard-list">
            ${ranked.length ? ranked.map((student, index) => `
              <div class="leaderboard-row ${index === 0 ? 'highlight' : ''}">
                <div>
                  <div class="row-title">#${index + 1} · ${escapeHtml(student.name)}</div>
                  <div class="muted">Level ${student.level} · ${student.streak} day streak</div>
                </div>
                <div class="inline-actions">
                  <span class="mini-pill">${student.xp} XP</span>
                  <span class="mini-pill positive">${(student.badges || []).length} badges</span>
                </div>
              </div>
            `).join('') : '<div class="empty-state">Leaderboard appears when students join.</div>'}
          </div>
        </section>
        <section class="view-card">
          <h3>Reward store</h3>
          <div class="card-grid">
            ${(this.state.rewardStore || []).map((reward) => `
              <div class="metric-card">
                <div class="row-title">${escapeHtml(reward.name)}</div>
                <div class="muted">${reward.cost} XP · ${reward.available ? 'Available' : 'Locked'}</div>
              </div>
            `).join('')}
          </div>
        </section>
      </div>
    `;
  }

  renderGoalsTab() {
    return `
      <div class="two-col">
        <section class="view-card">
          <h3>Create collaborative goal</h3>
          <form id="goal-form" class="form-stack">
            <label><span>Goal title</span><input class="field" name="title" type="text" placeholder="Reach 5000 XP" required /></label>
            <label><span>Target XP</span><input class="field" name="targetXP" type="number" min="1" value="5000" required /></label>
            <label><span>Unlock reward</span><input class="field" name="reward" type="text" placeholder="Movie day vote" required /></label>
            <div class="button-row"><button class="primary-button" type="submit">Add Goal</button></div>
          </form>
        </section>
        <section class="goal-grid">
          ${(this.state.goals || []).map((goal) => {
            const progress = Math.min(100, Math.round(((goal.currentXP || 0) / Math.max(goal.targetXP || 1, 1)) * 100));
            return `
              <article class="goal-card">
                <h4>${escapeHtml(goal.title)}</h4>
                <p class="muted">Reward: ${escapeHtml(goal.reward)}</p>
                <div class="xp-bar-shell"><div class="xp-bar-fill" style="width:${progress}%"></div></div>
                <p>${goal.currentXP} / ${goal.targetXP} XP</p>
                <span class="status-pill ${goal.completed ? 'online' : ''}">${goal.completed ? 'Completed' : `${progress}% complete`}</span>
              </article>
            `;
          }).join('')}
        </section>
      </div>
    `;
  }

  renderSettingsTab() {
    return `
      <div class="settings-grid">
        <section class="view-card">
          <h3>Class settings</h3>
          <form id="settings-form" class="form-stack">
            <label><span>Participation XP weight</span><input class="field" name="participationWeight" type="number" min="0" step="0.1" value="${this.state.settings.xpWeights.participation}" /></label>
            <label><span>Assignment XP weight</span><input class="field" name="assignmentWeight" type="number" min="0" step="0.1" value="${this.state.settings.xpWeights.assignments}" /></label>
            <label><span>Late penalty multiplier</span><input class="field" name="latePenaltyMultiplier" type="number" min="0" step="0.1" value="${this.state.settings.xpWeights.latePenaltyMultiplier}" /></label>
            <label><span>Streak grace days</span><input class="field" name="graceDays" type="number" min="0" step="1" value="${this.state.settings.streakConfig.graceDays}" /></label>
            <div class="button-row"><button class="primary-button" type="submit">Save Settings</button></div>
          </form>
        </section>
        <section class="view-card">
          <h3>Behavior categories & badges</h3>
          <form id="category-form" class="form-grid">
            <label><span>Category name</span><input class="field" name="name" type="text" placeholder="Citizenship" required /></label>
            <label><span>Points</span><input class="field" name="points" type="number" value="10" required /></label>
            <label><span>Type</span><select class="field" name="isPositive"><option value="true">Positive</option><option value="false">Negative</option></select></label>
            <div class="button-row"><button class="secondary-button" type="submit">Add Category</button></div>
          </form>
          <div class="card-grid">
            ${this.state.behaviorCategories.map((category) => `<div class="metric-card"><div class="row-title">${escapeHtml(category.name)}</div><div class="muted">${category.points > 0 ? '+' : ''}${category.points} XP · ${category.isPositive ? 'Positive' : 'Negative'}</div></div>`).join('')}
          </div>
          <h4>Badge rule editor</h4>
          <div class="card-grid">
            ${this.state.badges.map((badge) => `
              <label class="metric-card">
                <div class="row-title">${badge.icon} ${escapeHtml(badge.name)}</div>
                <div class="muted">${escapeHtml(badge.desc)}</div>
                <span>Threshold</span>
                <input class="field" type="number" data-action="badge-threshold" data-badge-id="${badge.id}" value="${badge.rule?.threshold ?? 1}" min="1" />
              </label>
            `).join('')}
          </div>
        </section>
      </div>
    `;
  }

  bindEvents() {
    this.root.querySelectorAll('[data-tab]').forEach((button) => {
      button.addEventListener('click', () => {
        this.currentTab = button.dataset.tab;
        this.render();
      });
    });

    this.root.querySelector('#teacher-session-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      await this.createSession(new FormData(event.currentTarget));
    });

    this.root.querySelector('[data-action="restore-selected"]')?.addEventListener('click', async () => {
      const select = this.root.querySelector('#restore-session-select');
      await this.loadSession(select?.value || '');
    });

    this.root.querySelector('[data-action="demo-teacher"]')?.addEventListener('click', async () => {
      await this.createSession(new FormData(Object.assign(document.createElement('form'), { innerHTML: '<input name="className" value="Demo Quest" /><input name="period" value="Sandbox" />' })), true);
    });

    this.root.querySelector('[data-action="recover-db"]')?.addEventListener('click', async () => {
      try {
        await db.recover();
        this.restoreSessions = [];
        this.toast('IndexedDB reset complete.');
        this.render();
      } catch (error) {
        this.toast(error.message || 'Recovery failed.');
      }
    });

    this.root.querySelector('[data-action="import-session"]')?.addEventListener('click', () => {
      this.root.querySelector(`#${this.importInputId}`)?.click();
    });

    this.root.querySelector(`#${this.importInputId}`)?.addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        const payload = JSON.parse(await file.text());
        await db.importSession(payload);
        this.restoreSessions = await db.listSessions();
        this.toast('Backup imported. Select it from the restore menu.');
        this.render();
      } catch (error) {
        this.toast(error.message || 'Import failed.');
      }
    });

    this.root.querySelectorAll('[data-action="approve-join"]').forEach((button) => {
      button.addEventListener('click', async () => this.approveJoin(button.dataset.connectionId));
    });

    this.root.querySelectorAll('[data-action="deny-join"]').forEach((button) => {
      button.addEventListener('click', () => this.denyJoin(button.dataset.connectionId));
    });

    this.root.querySelector('[data-action="copy-join-url"]')?.addEventListener('click', async () => {
      const joinUrl = `${window.location.origin}${window.location.pathname}?mode=student&code=${this.state.classInfo.code}`;
      await navigator.clipboard.writeText(joinUrl).catch(() => null);
      this.toast('Join URL copied to clipboard.');
    });

    this.root.querySelector('[data-action="save-class-info"]')?.addEventListener('click', async () => {
      const className = this.root.querySelector('#session-class-name')?.value || this.state.classInfo.name;
      const period = this.root.querySelector('#session-period')?.value || this.state.classInfo.period;
      await this.applyAuthoritativeAction({ type: 'UPDATE_CLASS_INFO', classInfo: { name: className, period } });
    });

    this.root.querySelector('[data-action="broadcast-snapshot"]')?.addEventListener('click', () => {
      this.peer.broadcastSnapshot(this.state);
      this.toast('Full state snapshot broadcasted.');
    });

    this.root.querySelector('[data-action="export-session"]')?.addEventListener('click', async () => {
      try {
        const payload = await db.exportSession(this.state.classInfo.code);
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `classquest-${this.state.classInfo.code}.json`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      } catch (error) {
        this.toast(error.message || 'Export failed.');
      }
    });

    this.root.querySelectorAll('[data-action="select-student"]').forEach((button) => {
      button.addEventListener('click', () => {
        this.activeStudentId = button.dataset.studentId;
        this.render();
      });
    });

    this.root.querySelector('#behavior-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const studentIds = form.getAll('studentIds');
      if (!studentIds.length) {
        this.toast('Select at least one student.');
        return;
      }
      await this.applyAuthoritativeAction({
        type: 'LOG_BEHAVIOR',
        studentIds,
        categoryId: form.get('categoryId'),
        note: form.get('note'),
        timestamp: Date.now(),
      });
      event.currentTarget.reset();
    });

    this.root.querySelector('#assignment-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const assignmentId = form.get('assignmentId');
      await this.applyAuthoritativeAction({
        type: 'UPSERT_ASSIGNMENT',
        assignment: {
          id: assignmentId || undefined,
          title: form.get('title'),
          desc: form.get('desc'),
          dueDate: form.get('dueDate'),
          xpReward: Number(form.get('xpReward')),
          latePenalty: Number(form.get('latePenalty')),
        },
      });
      event.currentTarget.reset();
    });

    this.root.querySelectorAll('[data-action="edit-assignment"]').forEach((button) => {
      button.addEventListener('click', () => {
        const assignment = this.state.assignments[button.dataset.assignmentId];
        if (!assignment) return;
        this.root.querySelector('#assignment-id').value = assignment.id;
        this.root.querySelector('[name="title"]').value = assignment.title;
        this.root.querySelector('[name="desc"]').value = assignment.desc;
        this.root.querySelector('[name="dueDate"]').value = assignment.dueDate;
        this.root.querySelector('[name="xpReward"]').value = assignment.xpReward;
        this.root.querySelector('[name="latePenalty"]').value = assignment.latePenalty;
        this.toast(`Editing ${assignment.title}`);
      });
    });

    this.root.querySelectorAll('[data-action="archive-assignment"]').forEach((button) => {
      button.addEventListener('click', async () => {
        await this.applyAuthoritativeAction({ type: 'ARCHIVE_ASSIGNMENT', assignmentId: button.dataset.assignmentId });
      });
    });

    this.root.querySelectorAll('[data-action="approve-submission"]').forEach((button) => {
      button.addEventListener('click', async () => {
        await this.applyAuthoritativeAction({
          type: 'REVIEW_SUBMISSION',
          assignmentId: button.dataset.assignmentId,
          studentId: button.dataset.studentId,
          approved: true,
        });
      });
    });

    this.root.querySelectorAll('[data-action="deny-submission"]').forEach((button) => {
      button.addEventListener('click', async () => {
        await this.applyAuthoritativeAction({
          type: 'REVIEW_SUBMISSION',
          assignmentId: button.dataset.assignmentId,
          studentId: button.dataset.studentId,
          approved: false,
        });
      });
    });

    this.root.querySelector('#goal-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      await this.applyAuthoritativeAction({
        type: 'ADD_GOAL',
        goal: {
          title: form.get('title'),
          targetXP: Number(form.get('targetXP')),
          reward: form.get('reward'),
        },
      });
      event.currentTarget.reset();
    });

    this.root.querySelector('#settings-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      await this.applyAuthoritativeAction({
        type: 'UPDATE_SETTINGS',
        settings: {
          xpWeights: {
            participation: Number(form.get('participationWeight')),
            assignments: Number(form.get('assignmentWeight')),
            latePenaltyMultiplier: Number(form.get('latePenaltyMultiplier')),
          },
          streakConfig: {
            graceDays: Number(form.get('graceDays')),
          },
        },
      });
    });

    this.root.querySelector('#category-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      await this.applyAuthoritativeAction({
        type: 'ADD_BEHAVIOR_CATEGORY',
        category: {
          name: form.get('name'),
          points: Number(form.get('points')),
          isPositive: form.get('isPositive') === 'true',
        },
      });
      event.currentTarget.reset();
    });

    this.root.querySelectorAll('[data-action="badge-threshold"]').forEach((input) => {
      input.addEventListener('change', async () => {
        await this.applyAuthoritativeAction({
          type: 'UPDATE_BADGE_RULE',
          badgeId: input.dataset.badgeId,
          threshold: Number(input.value),
        });
      });
    });
  }
}
