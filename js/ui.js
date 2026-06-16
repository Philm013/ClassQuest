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
    title: 'ClassQuest Key Art',
    label: 'Launch Splash',
    prompt: 'Classroom MMORPG hub, diverse students and teacher avatars, glowing quest board, cozy fantasy academy, pixel-inspired UI, high-energy composition',
    style: 'pixel fantasy classroom concept art',
    lighting: 'sunlit windows with magical neon UI glow',
    shot: 'wide hero scene',
    aspect: '16:10',
    palette: 'violet, gold, cyan, slate',
    negative: 'photorealism, weapons, violence, empty room, dystopian mood',
  },
  teacher: {
    title: 'Teacher Command Center',
    label: 'GM Console',
    prompt: 'teacher game master station overlooking classroom guild hall, holographic lesson quests, student badges, collaborative goals, magical tactical map',
    style: 'stylized strategy dashboard illustration',
    lighting: 'gold rim light with cool holographic accents',
    shot: 'three-quarter environment shot',
    aspect: '4:3',
    palette: 'navy, amethyst, amber, teal',
    negative: 'office cubicles, blank whiteboards, realism, clutter',
  },
  student: {
    title: 'Student Adventure Portrait',
    label: 'Player Card',
    prompt: 'student hero portrait in fantasy classroom academy, badge sash, quest journal, expressive and optimistic, school-safe MMORPG aesthetic',
    style: 'character card illustration',
    lighting: 'soft key light with magical spark particles',
    shot: 'medium portrait',
    aspect: '3:4',
    palette: 'purple, sky blue, warm gold',
    negative: 'adult features, dark horror, gritty realism, weapons',
  },
  quest: {
    title: 'Lesson Quest Poster',
    label: 'Quest Tile',
    prompt: 'quest poster for a classroom lesson mission, floating books, puzzle icons, reward stamps, stylized map fragments, school-safe fantasy adventure',
    style: 'posterized UI concept art',
    lighting: 'dramatic top glow with paper texture',
    shot: 'framed mission poster',
    aspect: '4:5',
    palette: 'indigo, parchment, gold, emerald',
    negative: 'battle damage, scary monsters, realistic guns, empty poster',
  },
  badge: {
    title: 'Achievement Emblem Sheet',
    label: 'Badge Concept',
    prompt: 'collectible achievement emblems for classroom quests, enamel pins, stars, books, teamwork crests, progression tiers',
    style: 'vector badge sheet',
    lighting: 'studio soft light',
    shot: 'flat lay icon sheet',
    aspect: '1:1',
    palette: 'gold, ruby, sapphire, silver',
    negative: 'corporate logos, photo textures, low contrast',
  },
  avatar: {
    title: 'Avatar Wardrobe Board',
    label: 'Cosmetic Sheet',
    prompt: 'customizable student avatar cosmetic wardrobe, capes, hats, glasses, crowns, friendly classroom fantasy fashion',
    style: 'character customization concept board',
    lighting: 'bright showroom glow',
    shot: 'front-facing turnaround sheet',
    aspect: '5:4',
    palette: 'orchid, blue, gold, coral',
    negative: 'armor violence, realistic skin pores, dark mood',
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
  return `
    <figure class="placeholder-art" data-scene="${escapeHtml(sceneKey)}" data-prompt="${escapeHtml(scene.prompt)}" data-style="${escapeHtml(scene.style)}" data-lighting="${escapeHtml(scene.lighting)}" data-shot="${escapeHtml(scene.shot)}" data-aspect="${escapeHtml(scene.aspect)}" data-palette="${escapeHtml(scene.palette)}" data-negative="${escapeHtml(scene.negative)}">
      <div class="placeholder-art-frame">
        <span class="placeholder-art-label">${escapeHtml(scene.label)}</span>
        <div class="placeholder-art-orb"></div>
        <div class="placeholder-art-grid"></div>
      </div>
      <figcaption class="placeholder-art-meta">
        <strong>${escapeHtml(scene.title)}</strong>
        <span><b>Prompt:</b> ${escapeHtml(scene.prompt)}</span>
        <span><b>Style:</b> ${escapeHtml(scene.style)}</span>
        <span><b>Light:</b> ${escapeHtml(scene.lighting)}</span>
        <span><b>Shot:</b> ${escapeHtml(scene.shot)} · <b>Aspect:</b> ${escapeHtml(scene.aspect)}</span>
        <span><b>Palette:</b> ${escapeHtml(scene.palette)}</span>
        <span><b>Negative:</b> ${escapeHtml(scene.negative)}</span>
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
