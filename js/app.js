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
        <h2>Turn the classroom into a living MMORPG campaign.</h2>
        <p>Launch guild-ready lessons, collectible badges, student avatars, and classroom quests from one browser-first world built for teachers and adventurers.</p>
        <div class="hero-actions">
          <button class="primary-button" id="open-teacher" type="button">Enter Teacher Command</button>
          <button class="secondary-button" id="open-student" type="button">Join the Guild</button>
        </div>
        <div class="hero-token-row">
          <span class="status-pill online">Live classroom raids</span>
          <span class="status-pill demo">Quest boards as lessons</span>
          <span class="status-pill">Avatar progression</span>
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
          <h3>Game master your class</h3>
          <p class="muted">Run behavior, quests, goals, and rewards from a board that feels closer to a guild hall than a grade spreadsheet.</p>
        </article>
        <article class="metric-card feature-card">
          <span class="mini-pill">Students</span>
          <h3>Level through lessons</h3>
          <p class="muted">See progress as quests, collect badges, and grow an avatar identity that makes school momentum visible.</p>
        </article>
        <article class="metric-card feature-card">
          <span class="mini-pill">Classroom world</span>
          <h3>Built for browser co-op</h3>
          <p class="muted">Peer-to-peer sync, local snapshots, and low-friction joins keep the campaign moving during real class time.</p>
        </article>
      </div>
      <div class="three-col">
        <article class="view-card lore-card">
          <p class="eyebrow">Realm loop</p>
          <h3>Quest → reward → celebrate</h3>
          <p class="muted">Assignments become missions, positive moments grant XP, and every class milestone looks like a visible unlock.</p>
        </article>
        <article class="view-card lore-card">
          <p class="eyebrow">Placeholder art metadata</p>
          <h3>Future-ready concept prompts</h3>
          <p class="muted">Every major visual surface now carries structured prompt, lighting, framing, palette, and negative-prompt metadata for later image production.</p>
        </article>
        <article class="view-card lore-card">
          <p class="eyebrow">Player fantasy</p>
          <h3>School-safe classroom MMORPG</h3>
          <p class="muted">The tone stays academic and welcoming while pushing harder on adventure, progression, parties, and collectible identity.</p>
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
