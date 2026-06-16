function escapeHtml(text = '') {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export const PLACEHOLDER_SCENES = {
  landing: {
    title: 'Classroom operations at a glance',
    label: 'Platform Overview',
    summary: 'Track behavior, assignments, and progress from one live classroom workspace.',
    highlights: ['Live updates', 'Class snapshots', 'Progress visibility'],
  },
  teacher: {
    title: 'Teacher command center',
    label: 'Session Management',
    summary: 'Run attendance, activity logs, assignments, and goals in a single teaching flow.',
    highlights: ['Fast setup', 'Roster control', 'Reliable backups'],
  },
  student: {
    title: 'Student progress view',
    label: 'Learner Experience',
    summary: 'Give students a clear view of goals, recognition, and next steps.',
    highlights: ['Personal progress', 'Assignment status', 'Badge milestones'],
  },
  quest: {
    title: 'Assignment card',
    label: 'Lesson Workflow',
    summary: 'Keep each assignment scoped with due dates, XP impact, and review status.',
    highlights: ['Due dates', 'Progress states', 'Teacher review'],
  },
  badge: {
    title: 'Recognition system',
    label: 'Achievement Tracking',
    summary: 'Celebrate meaningful milestones with transparent classroom criteria.',
    highlights: ['Clear criteria', 'Student motivation', 'Visible growth'],
  },
  avatar: {
    title: 'Student identity tools',
    label: 'Customization',
    summary: 'Support student ownership with safe, classroom-friendly personalization.',
    highlights: ['Unlocked options', 'Class-safe visuals', 'Progress rewards'],
  },
};

export function getStudentTitle(student = {}) {
  const level = student.level || 1;
  if (level >= 15) return 'Headmaster Legend';
  if (level >= 10) return 'Mythic Scholar';
  if (level >= 7) return 'Guild Champion';
  if (level >= 4) return 'Quest Adept';
  return 'Rookie Adventurer';
}

export function getStudentAffinity(student = {}) {
  if ((student.streak || 0) >= 7) return 'Streakfire';
  if ((student.badges || []).length >= 4) return 'Badgekeeper';
  if ((student.xp || 0) >= 500) return 'Starforged';
  return 'Pathfinder';
}

export function getQuestDifficulty(xpReward = 0) {
  if (xpReward >= 100) return { label: 'Epic', tone: 'epic' };
  if (xpReward >= 60) return { label: 'Rare', tone: 'rare' };
  if (xpReward >= 30) return { label: 'Common', tone: 'common' };
  return { label: 'Tutorial', tone: 'tutorial' };
}

export function getQuestStatusMeta(status = 'assigned') {
  const map = {
    assigned: { label: 'Ready to begin', tone: 'assigned' },
    'in-progress': { label: 'Quest in progress', tone: 'progress' },
    submitted: { label: 'Awaiting teacher review', tone: 'submitted' },
    completed: { label: 'Quest cleared', tone: 'completed' },
    late: { label: 'Late completion', tone: 'late' },
  };
  return map[status] || map.assigned;
}

export function getRankTitle(index = 0) {
  if (index === 0) return 'Class Champion';
  if (index === 1) return 'Elite Raider';
  if (index === 2) return 'Master Explorer';
  return 'Guild Member';
}

export function renderPlaceholderArtwork(sceneKey, overrides = {}) {
  const scene = { ...(PLACEHOLDER_SCENES[sceneKey] || PLACEHOLDER_SCENES.quest), ...overrides };
  const highlights = (scene.highlights || []).slice(0, 3);
  return `
    <figure class="placeholder-art" data-scene="${escapeHtml(sceneKey)}">
      <div class="placeholder-art-frame">
        <span class="placeholder-art-label">${escapeHtml(scene.label)}</span>
        <div class="placeholder-art-orb"></div>
        <div class="placeholder-art-grid"></div>
      </div>
      <figcaption class="placeholder-art-meta">
        <strong>${escapeHtml(scene.title)}</strong>
        ${scene.summary ? `<span>${escapeHtml(scene.summary)}</span>` : ''}
        ${highlights.length ? `<div class="placeholder-art-highlights">${highlights.map((item) => `<span class="mini-pill">${escapeHtml(item)}</span>`).join('')}</div>` : ''}
      </figcaption>
    </figure>
  `;
}

export function renderAvatarMedallion(student = {}, options = {}) {
  const avatar = student.avatar || {};
  const title = options.title || getStudentTitle(student);
  const affinity = options.affinity || getStudentAffinity(student);
  return `
    <div class="avatar-medallion">
      <div class="avatar-preview compact">
        <div class="avatar-body">
          <div class="avatar-hat ${escapeHtml(avatar.hat || 'none')}"></div>
          <div class="avatar-head"></div>
          <div class="avatar-accessory ${escapeHtml(avatar.accessory || 'none')}"></div>
          <div class="avatar-torso" style="background:${escapeHtml(avatar.color || '#7c3aed')}"></div>
        </div>
      </div>
      <div class="avatar-medallion-copy">
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(affinity)}</span>
      </div>
    </div>
  `;
}
