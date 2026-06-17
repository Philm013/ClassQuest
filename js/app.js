import { TeacherApp } from './teacher.js';
import { StudentApp } from './student.js';
import { renderPlaceholderArtwork } from './ui.js';

const appRoot = document.getElementById('app');
const toastRegion = document.getElementById('toast-region');
const celebrationRoot = document.getElementById('celebration-root');
const globalConnectionPill = document.getElementById('global-connection-pill');
const homeButton = document.getElementById('home-button');

let activeView = null;

function toast(message) {
  if (!message) return;
  const item = document.createElement('div');
  item.className = 'toast';
  item.textContent = message;
  toastRegion.appendChild(item);
  setTimeout(() => item.remove(), 3600);
}

function celebrate(message) {
  const wrapper = document.createElement('div');
  wrapper.className = 'celebration';
  wrapper.innerHTML = `
    <div class="celebration-card">
      <h3>LEVEL UP!</h3>
      <p>${message}</p>
    </div>
  `;
  celebrationRoot.appendChild(wrapper);
  setTimeout(() => wrapper.remove(), 2400);
}

function updateConnectionPill(label, tone = '') {
  globalConnectionPill.textContent = label;
  globalConnectionPill.className = `status-pill ${tone}`.trim();
}

function renderLanding() {
  updateConnectionPill('Ready');
  appRoot.innerHTML = `
    <section class="hero hero-portal">
      <div class="hero-copy">
        <p class="eyebrow">Welcome to ClassQuest</p>
        <h2>Run classroom progress with one practical workspace.</h2>
        <p>Manage behavior, assignments, and student growth in real time with a lightweight browser-first platform built for daily classroom use.</p>
        <div class="hero-actions">
          <button class="primary-button" id="open-teacher" type="button">Open Teacher Workspace</button>
          <button class="secondary-button" id="open-student" type="button">Open Student View</button>
        </div>
        <div class="hero-token-row">
          <span class="status-pill online">Live classroom sync</span>
          <span class="status-pill">Assignment lifecycle tracking</span>
          <span class="status-pill">Student progress visibility</span>
        </div>
      </div>
      <div class="hero-stage">
        ${renderPlaceholderArtwork('landing')}
      </div>
    </section>
    <section class="dashboard quest-lobby">
      <div class="dashboard-grid">
        <article class="metric-card feature-card">
          <span class="mini-pill positive">Teachers</span>
          <h3>Manage class operations</h3>
          <p class="muted">Track behavior, assignments, goals, and recognition from a streamlined daily dashboard.</p>
        </article>
        <article class="metric-card feature-card">
          <span class="mini-pill">Students</span>
          <h3>See progress clearly</h3>
          <p class="muted">Students can follow current work, accomplishments, and momentum in one place.</p>
        </article>
        <article class="metric-card feature-card">
          <span class="mini-pill">Classroom reliability</span>
          <h3>Built for real class time</h3>
          <p class="muted">Peer-to-peer sync, local snapshots, and quick joins keep workflows moving when schedules are tight.</p>
        </article>
      </div>
      <div class="three-col">
        <article class="view-card lore-card">
          <p class="eyebrow">Daily workflow</p>
          <h3>Track, respond, and reinforce</h3>
          <p class="muted">Capture classroom moments quickly and turn them into visible progress students can understand.</p>
        </article>
        <article class="view-card lore-card">
          <p class="eyebrow">Class continuity</p>
          <h3>Built-in resilience</h3>
          <p class="muted">Offline-safe snapshots and restore options help protect class progress across interruptions.</p>
        </article>
        <article class="view-card lore-card">
          <p class="eyebrow">Student engagement</p>
          <h3>Motivation with structure</h3>
          <p class="muted">Recognition, goals, and clear status cues keep the experience encouraging and academically focused.</p>
        </article>
      </div>
    </section>
  `;
  document.getElementById('open-teacher')?.addEventListener('click', () => launchTeacher());
  document.getElementById('open-student')?.addEventListener('click', () => launchStudent());
}

function destroyActiveView() {
  activeView?.destroy?.();
  activeView = null;
}

async function launchTeacher() {
  destroyActiveView();
  activeView = new TeacherApp({
    root: appRoot,
    toast,
    celebrate,
    updateConnectionPill,
  });
  await activeView.init();
}

async function launchStudent() {
  destroyActiveView();
  const params = new URLSearchParams(window.location.search);
  activeView = new StudentApp({
    root: appRoot,
    toast,
    celebrate,
    updateConnectionPill,
    initialCode: params.get('code') || '',
  });
  await activeView.init();
}

homeButton.addEventListener('click', () => {
  destroyActiveView();
  renderLanding();
});

const mode = new URLSearchParams(window.location.search).get('mode');
if (mode === 'teacher') launchTeacher();
else if (mode === 'student') launchStudent();
else renderLanding();
