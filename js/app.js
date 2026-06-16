import { TeacherApp } from './teacher.js';
import { StudentApp } from './student.js';

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
    <section class="hero">
      <div>
        <p class="eyebrow">Static SPA · Peer-to-peer · GitHub Pages ready</p>
        <h2>Turn classroom management into a team-powered quest.</h2>
        <p>ClassQuest gives teachers a browser-based host dashboard, students a live progress center, and both sides resilient local storage with PeerJS + demo-mode syncing.</p>
        <div class="hero-actions">
          <button class="primary-button" id="open-teacher" type="button">I'm a Teacher</button>
          <button class="secondary-button" id="open-student" type="button">I'm a Student</button>
        </div>
      </div>
      <div class="hero-panel">
        <div class="hero-stat"><span>Teacher toolkit</span><strong>Sessions, roster, behavior, assignments, goals, settings</strong></div>
        <div class="hero-stat"><span>Student toolkit</span><strong>Dashboard, badges, leaderboard, avatar customization</strong></div>
        <div class="hero-stat"><span>Tech stack</span><strong>Vanilla ES modules, IndexedDB, localStorage, PeerJS, BroadcastChannel</strong></div>
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
