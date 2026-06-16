import { db, storage } from './db.js';
import { getAvatarUnlocks, getLevelProgress } from './gamification.js';
import { PeerConnectionManager } from './peer.js';
import { applyDelta, hydrateState } from './state.js';

function escapeHtml(text = '') {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export class StudentApp {
  constructor({ root, toast, celebrate, updateConnectionPill, initialCode = '' }) {
    this.root = root;
    this.toast = toast;
    this.celebrate = celebrate;
    this.updateConnectionPill = updateConnectionPill;
    this.initialCode = initialCode;
    this.peer = new PeerConnectionManager('student');
    this.state = null;
    this.currentTab = 'join';
    this.studentId = storage.get('classquest:last-student-id', '');
    this.studentName = storage.get('classquest:last-student-name', '');
    this.classroomCode = initialCode || storage.get('classquest:last-class-code', '');
    this.pendingCount = 0;
    this.joinDenied = '';
    this.attachPeerEvents();
  }

  async init() {
    try {
      await db.open();
    } catch {
      // Gracefully continue with localStorage only.
    }
    this.render();
  }

  destroy() {
    this.peer.cleanup();
  }

  attachPeerEvents() {
    this.peer.addEventListener('status', ({ detail }) => {
      const status = detail.demoMode ? 'Demo Mode' : detail.status;
      const tone = detail.status === 'offline' ? 'offline' : detail.demoMode ? 'demo' : 'online';
      this.updateConnectionPill(status, tone);
      if (detail.status === 'offline') this.toast('Host offline. Local snapshot remains available.');
      this.render();
    });

    this.peer.addEventListener('join-accepted', ({ detail }) => {
      this.joinDenied = '';
      this.state = hydrateState(detail.snapshot);
      this.studentId = detail.payload.id;
      this.studentName = detail.payload.name;
      this.classroomCode = this.state.classInfo.code;
      storage.set('classquest:last-student-id', this.studentId);
      storage.set('classquest:last-student-name', this.studentName);
      storage.set('classquest:last-class-code', this.classroomCode);
      this.currentTab = 'dashboard';
      this.persistStudentSnapshot();
      this.toast(`Joined ${this.state.classInfo.name}`);
      this.render();
    });

    this.peer.addEventListener('join-denied', ({ detail }) => {
      this.joinDenied = detail.reason || 'Join request denied.';
      this.toast(this.joinDenied);
      this.render();
    });

    this.peer.addEventListener('state-snapshot', ({ detail }) => {
      this.state = hydrateState(detail.state);
      this.persistStudentSnapshot();
      this.render();
    });

    this.peer.addEventListener('state-delta', ({ detail }) => {
      const previousLevel = this.getCurrentStudent()?.level || 1;
      const result = applyDelta(this.state, detail.delta);
      if (!result.applied) {
        this.toast('Data refreshed to latest class state.');
        return;
      }
      this.state = result.state;
      const newLevel = this.getCurrentStudent()?.level || 1;
      if (newLevel > previousLevel) {
        this.celebrate(`Level ${newLevel} unlocked!`);
      }
      this.persistStudentSnapshot();
      this.render();
    });

    this.peer.addEventListener('queue-update', ({ detail }) => {
      this.pendingCount = detail.count || 0;
      this.render();
    });

    this.peer.addEventListener('reconnecting', ({ detail }) => {
      this.toast(`Trying to reconnect in ${Math.round(detail.delay / 1000)}s...`);
    });
  }

  getCurrentStudent() {
    return this.state?.students?.[this.studentId] || null;
  }

  async persistStudentSnapshot() {
    if (!this.state?.classInfo?.code) return;
    try {
      await db.saveSnapshot(this.state.classInfo.code, this.state);
    } catch {
      // Best effort only.
    }
  }

  async tryLoadOfflineSnapshot(code) {
    try {
      const snapshot = await db.getLatestSnapshot(code);
      if (snapshot) {
        this.state = hydrateState(snapshot);
        this.classroomCode = code;
        this.currentTab = 'dashboard';
        this.toast('Loaded the latest local snapshot in read-only mode.');
      }
    } catch {
      // Ignore offline restore issues.
    }
  }

  async joinClassroom(formData) {
    const code = String(formData.get('code') || '').trim().toUpperCase();
    const studentName = String(formData.get('name') || '').trim();
    const studentId = String(formData.get('studentId') || studentName).trim();
    if (!code || !studentName) {
      this.toast('Enter a classroom code and your name.');
      return;
    }
    this.studentName = studentName;
    this.studentId = studentId.toLowerCase().replace(/\s+/g, '-');
    this.classroomCode = code;
    storage.set('classquest:last-student-id', this.studentId);
    storage.set('classquest:last-student-name', this.studentName);
    storage.set('classquest:last-class-code', code);
    await this.tryLoadOfflineSnapshot(code);
    await this.peer.connectToHost(code, {
      studentId: this.studentId,
      name: this.studentName,
      requestedAt: Date.now(),
      lastSeenVersion: this.state?.version || 0,
    });
    this.toast('Join request sent. Waiting for teacher approval...');
    this.render();
  }

  render() {
    if (this.currentTab === 'join' || !this.state) {
      this.root.innerHTML = this.renderJoinView();
    } else {
      this.root.innerHTML = this.renderDashboard();
    }
    this.bindEvents();
  }

  renderJoinView() {
    return `
      <section class="join-card">
        <div class="hero">
          <div>
            <p class="eyebrow">Student mode</p>
            <h2>Join the quest and watch your progress level up.</h2>
            <p>Enter your classroom code, sync with the teacher host, and keep working even if the host goes offline using your last local snapshot.</p>
          </div>
          <div class="hero-panel">
            <div class="hero-stat"><span>Live status</span><strong>Host approval + local pending action queue</strong></div>
            <div class="hero-stat"><span>Offline-safe</span><strong>Read-only recovery from IndexedDB snapshots</strong></div>
            <div class="hero-stat"><span>Demo mode</span><strong>BroadcastChannel fallback when PeerJS is unavailable</strong></div>
          </div>
        </div>
        <div class="dashboard two-col">
          <section class="view-card">
            <h3>Join classroom</h3>
            <form id="student-join-form" class="form-stack">
              <label><span>Classroom code</span><input class="field" name="code" type="text" maxlength="6" value="${escapeHtml(this.classroomCode)}" required /></label>
              <label><span>Your name</span><input class="field" name="name" type="text" value="${escapeHtml(this.studentName)}" required /></label>
              <label><span>Student ID (optional)</span><input class="field" name="studentId" type="text" value="${escapeHtml(this.studentId)}" /></label>
              <div class="button-row"><button class="primary-button" type="submit">Connect</button></div>
            </form>
            ${this.joinDenied ? `<div class="offline-banner"><strong>${escapeHtml(this.joinDenied)}</strong></div>` : ''}
          </section>
          <section class="view-card">
            <h3>What you will see</h3>
            <div class="card-grid">
              <div class="metric-card"><div class="row-title">XP Dashboard</div><div class="muted">Track your level, streak, and quest progress.</div></div>
              <div class="metric-card"><div class="row-title">Assignments</div><div class="muted">Mark work in progress or submit it for teacher review.</div></div>
              <div class="metric-card"><div class="row-title">Avatar Lab</div><div class="muted">Unlock fun cosmetics with XP milestones.</div></div>
            </div>
          </section>
        </div>
      </section>
    `;
  }

  renderDashboard() {
    const student = this.getCurrentStudent();
    const tabs = [
      ['dashboard', 'Dashboard'],
      ['assignments', 'Assignments'],
      ['badges', 'Badges'],
      ['leaderboard', 'Leaderboard'],
      ['avatar', 'Avatar'],
    ];
    return `
      <section class="dashboard">
        <div class="dashboard-header">
          <div>
            <p class="eyebrow">Student dashboard</p>
            <h2>${escapeHtml(this.state.classInfo.name)} · ${escapeHtml(this.studentName || student?.name || 'Student')}</h2>
            <p class="muted">Class code ${escapeHtml(this.state.classInfo.code)} · Pending queue ${this.pendingCount}</p>
          </div>
          <div class="level-chip">${student ? `Level ${student.level}` : 'Awaiting approval'}</div>
        </div>
        ${this.peer.hostOnline ? '' : '<div class="offline-banner"><strong>Host Offline</strong><span>Your last synced data is available. Pending actions will retry automatically.</span></div>'}
        <div class="tab-row">${tabs.map(([id, label]) => `<button class="tab-pill ${this.currentTab === id ? 'active' : ''}" type="button" data-tab="${id}">${label}</button>`).join('')}</div>
        ${this.renderStudentPanel()}
      </section>
    `;
  }

  renderStudentPanel() {
    switch (this.currentTab) {
      case 'assignments':
        return this.renderAssignments();
      case 'badges':
        return this.renderBadges();
      case 'leaderboard':
        return this.renderLeaderboard();
      case 'avatar':
        return this.renderAvatar();
      default:
        return this.renderOverview();
    }
  }

  renderOverview() {
    const student = this.getCurrentStudent();
    if (!student) return '<div class="view-card"><div class="empty-state">Waiting for teacher approval.</div></div>';
    const progress = getLevelProgress(student.xp || 0);
    return `
      <div class="student-layout">
        <section class="view-card">
          <div class="metric-card">
            <div class="metric-label">XP to next level</div>
            <div class="metric-value">${student.xp}</div>
            <div class="xp-bar-shell"><div class="xp-bar-fill" style="width:${progress.percent}%"></div></div>
            <p class="muted">${progress.toNextLevel} XP until Level ${Math.min(student.level + 1, 20)}</p>
          </div>
          <div class="dashboard-grid">
            <div class="metric-card"><div class="metric-label">Current level</div><div class="metric-value">${student.level}</div></div>
            <div class="metric-card"><div class="metric-label">Streak</div><div class="metric-value">${student.streak}</div></div>
            <div class="metric-card"><div class="metric-label">Badges</div><div class="metric-value">${(student.badges || []).length}</div></div>
          </div>
          <div class="timeline-card">
            <h3>Recent moments</h3>
            <div class="timeline-list">
              ${(this.state.behaviorLog || []).filter((event) => event.studentId === student.id).slice(0, 8).map((event) => `
                <div class="timeline-item">
                  <strong>${event.points > 0 ? '+' : ''}${event.points} XP</strong>
                  <div class="muted">${new Date(event.timestamp).toLocaleString()}</div>
                  ${event.note ? `<div>${escapeHtml(event.note)}</div>` : ''}
                </div>
              `).join('') || '<div class="empty-state">No recent events yet.</div>'}
            </div>
          </div>
        </section>
        <section class="view-card">
          <div class="level-chip">Level ${student.level}</div>
          <h3>Your active streak</h3>
          <p class="muted">Keep positive behavior and completed work going to extend your streak.</p>
          <div class="hero-stat"><span>Total XP</span><strong>${student.xp}</strong></div>
          <div class="hero-stat"><span>Class rank</span><strong>#${this.getRank(student.id)}</strong></div>
          <div class="hero-stat"><span>Connection</span><strong>${this.peer.hostOnline ? 'Live with teacher host' : 'Offline-safe snapshot mode'}</strong></div>
        </section>
      </div>
    `;
  }

  renderAssignments() {
    const student = this.getCurrentStudent();
    const assignments = Object.values(this.state.assignments || {}).filter((assignment) => !assignment.archived);
    return `
      <section class="assignment-grid">
        ${assignments.length ? assignments.map((assignment) => {
          const status = assignment.studentStatuses?.[student?.id] || 'assigned';
          return `
            <article class="assignment-card">
              <div class="inline-actions">
                <h3>${escapeHtml(assignment.title)}</h3>
                <span class="mini-pill">${assignment.xpReward} XP</span>
              </div>
              <p>${escapeHtml(assignment.desc)}</p>
              <p class="muted">Due ${escapeHtml(assignment.dueDate)} · Status <span class="assign-status ${status}">${escapeHtml(status)}</span></p>
              <div class="button-row">
                <button class="secondary-button" type="button" data-action="mark-progress" data-assignment-id="${assignment.id}">Mark In Progress</button>
                <button class="primary-button" type="button" data-action="submit-assignment" data-assignment-id="${assignment.id}">Submit</button>
              </div>
            </article>
          `;
        }).join('') : '<div class="empty-state">No assignments yet.</div>'}
      </section>
    `;
  }

  renderBadges() {
    const student = this.getCurrentStudent();
    const earned = new Set(student?.badges || []);
    return `
      <section class="badge-grid">
        ${(this.state.badges || []).map((badge) => `
          <article class="badge-card ${earned.has(badge.id) ? '' : 'locked'}">
            <div class="badge-icon">${badge.icon}</div>
            <h3>${escapeHtml(badge.name)}</h3>
            <p class="muted">${escapeHtml(badge.desc)}</p>
            <span class="status-pill ${earned.has(badge.id) ? 'online' : ''}">${earned.has(badge.id) ? 'Earned' : 'Locked'}</span>
          </article>
        `).join('')}
      </section>
    `;
  }

  renderLeaderboard() {
    const ranked = Object.values(this.state.students || {}).sort((a, b) => b.xp - a.xp);
    return `
      <section class="view-card">
        <h3>Class leaderboard</h3>
        <div class="leaderboard-list">
          ${ranked.map((student, index) => `
            <div class="leaderboard-row ${student.id === this.studentId ? 'highlight' : ''}">
              <div>
                <div class="row-title">#${index + 1} · ${escapeHtml(student.name)}</div>
                <div class="muted">Level ${student.level} · ${student.streak} streak</div>
              </div>
              <div class="inline-actions">
                <span class="mini-pill">${student.xp} XP</span>
                <span class="mini-pill positive">${(student.badges || []).length} badges</span>
              </div>
            </div>
          `).join('')}
        </div>
      </section>
    `;
  }

  renderAvatar() {
    const student = this.getCurrentStudent();
    const avatar = student?.avatar || { color: '#7c3aed', hat: 'none', accessory: 'none' };
    const unlocks = getAvatarUnlocks(student?.xp || 0);
    return `
      <div class="student-layout">
        <section class="avatar-card">
          <div class="avatar-preview">
            <div class="avatar-body">
              <div class="avatar-hat ${avatar.hat}"></div>
              <div class="avatar-head"></div>
              <div class="avatar-accessory ${avatar.accessory}"></div>
              <div class="avatar-torso" style="background:${escapeHtml(avatar.color)}"></div>
            </div>
          </div>
        </section>
        <section class="view-card">
          <h3>Customize your avatar</h3>
          <form id="avatar-form" class="form-stack">
            <label><span>Color</span><input class="field" type="color" name="color" value="${escapeHtml(avatar.color)}" /></label>
            <label><span>Hat</span><select class="field" name="hat">${unlocks.hats.map((hat) => `<option value="${hat}" ${avatar.hat === hat ? 'selected' : ''}>${hat}</option>`).join('')}</select></label>
            <label><span>Accessory</span><select class="field" name="accessory">${unlocks.accessories.map((accessory) => `<option value="${accessory}" ${avatar.accessory === accessory ? 'selected' : ''}>${accessory}</option>`).join('')}</select></label>
            <div class="button-row"><button class="primary-button" type="submit">Save Avatar</button></div>
          </form>
          <p class="muted">Unlocks: crown at 500 XP, halo at 1500 XP, star at 400 XP, bowtie at 900 XP.</p>
        </section>
      </div>
    `;
  }

  getRank(studentId) {
    return Object.values(this.state.students || {})
      .sort((a, b) => b.xp - a.xp)
      .findIndex((student) => student.id === studentId) + 1;
  }

  bindEvents() {
    this.root.querySelectorAll('[data-tab]').forEach((button) => {
      button.addEventListener('click', () => {
        this.currentTab = button.dataset.tab;
        this.render();
      });
    });

    this.root.querySelector('#student-join-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      await this.joinClassroom(new FormData(event.currentTarget));
    });

    this.root.querySelectorAll('[data-action="mark-progress"]').forEach((button) => {
      button.addEventListener('click', () => {
        this.peer.sendIntent('INTENT_MARK_IN_PROGRESS', {
          assignmentId: button.dataset.assignmentId,
          studentId: this.studentId,
        });
        this.toast('Marked as in progress.');
      });
    });

    this.root.querySelectorAll('[data-action="submit-assignment"]').forEach((button) => {
      button.addEventListener('click', () => {
        this.peer.sendIntent('INTENT_SUBMIT_ASSIGNMENT', {
          assignmentId: button.dataset.assignmentId,
          studentId: this.studentId,
        });
        this.toast('Submission intent sent to teacher.');
      });
    });

    this.root.querySelector('#avatar-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const student = this.getCurrentStudent();
      if (!student) return;
      student.avatar = {
        color: form.get('color'),
        hat: form.get('hat'),
        accessory: form.get('accessory'),
      };
      this.persistStudentSnapshot();
      this.toast('Avatar saved locally.');
      this.render();
    });
  }
}
