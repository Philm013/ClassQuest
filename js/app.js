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
        <p class="eyebrow">Welcome to ClassQuest</p>
        <h2>Make everyday class progress feel like a shared adventure.</h2>
        <p>Teachers can run class routines with less friction, and students can follow goals, celebrate wins, and stay motivated from any device.</p>
        <div class="hero-actions">
          <button class="primary-button" id="open-teacher" type="button">I'm a Teacher</button>
          <button class="secondary-button" id="open-student" type="button">I'm a Student</button>
        </div>
      </div>
      <div class="hero-panel">
        <div class="hero-stat"><span>Teacher workflow</span><strong>Create class sessions, guide behavior, and review assignments in one place.</strong></div>
        <div class="hero-stat"><span>Student experience</span><strong>Track XP, build streaks, unlock badges, and personalize your avatar.</strong></div>
        <div class="hero-stat"><span>Built for classrooms</span><strong>Fast setup, local recovery, and live updates during class time.</strong></div>
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
