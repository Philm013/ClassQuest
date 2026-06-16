export const LEVEL_THRESHOLDS = [
  0,
  100,
  250,
  500,
  850,
  1300,
  1850,
  2500,
  3250,
  4100,
  5050,
  6100,
  7250,
  8500,
  9850,
  11300,
  12850,
  14500,
  16250,
  18100,
];

export const DEFAULT_BEHAVIOR_CATEGORIES = [
  { id: 'participation', name: 'Participation', points: 10, isPositive: true },
  { id: 'teamwork', name: 'Teamwork', points: 15, isPositive: true },
  { id: 'extra-credit', name: 'Extra Credit', points: 20, isPositive: true },
  { id: 'disruption', name: 'Disruption', points: -10, isPositive: false },
  { id: 'late-work', name: 'Late Work', points: -5, isPositive: false },
  { id: 'off-task', name: 'Off Task', points: -5, isPositive: false },
];

export const DEFAULT_BADGES = [
  { id: 'first-steps', name: 'First Steps', desc: 'Joined the class for the first time.', icon: '🚀', rule: { type: 'joins', threshold: 1 } },
  { id: 'homework-hero', name: 'Homework Hero', desc: 'Completed 5 assignments on time.', icon: '📘', rule: { type: 'onTimeSubmissions', threshold: 5 } },
  { id: 'streak-master', name: 'Streak Master', desc: 'Maintain a 7-day streak.', icon: '🔥', rule: { type: 'streak', threshold: 7 } },
  { id: 'participation-pro', name: 'Participation Pro', desc: 'Earn 50 participation points.', icon: '🎤', rule: { type: 'categoryPoints', categoryId: 'participation', threshold: 50 } },
  { id: 'team-player', name: 'Team Player', desc: 'Earn 30 teamwork points.', icon: '🤝', rule: { type: 'categoryPoints', categoryId: 'teamwork', threshold: 30 } },
  { id: 'xp-hunter', name: 'XP Hunter', desc: 'Reach level 5.', icon: '⚔️', rule: { type: 'level', threshold: 5 } },
  { id: 'scholar', name: 'Scholar', desc: 'Reach level 10.', icon: '🎓', rule: { type: 'level', threshold: 10 } },
  { id: 'legend', name: 'Legend', desc: 'Reach level 20.', icon: '👑', rule: { type: 'level', threshold: 20 } },
];

export const DEFAULT_REWARD_STORE = [
  { id: 'reward-seat', name: 'Choose Your Seat', cost: 120, available: true },
  { id: 'reward-dj', name: 'Class DJ for 10 Minutes', cost: 200, available: true },
  { id: 'reward-hint', name: 'Homework Hint Pass', cost: 160, available: true },
];

export const DEFAULT_SETTINGS = {
  xpWeights: {
    participation: 1,
    teamwork: 1,
    assignments: 1,
    latePenaltyMultiplier: 1,
  },
  streakConfig: {
    graceDays: 1,
    positiveBehaviorRequired: 1,
  },
};

export function getLevelForXP(xp = 0) {
  let level = 1;
  for (let index = 1; index < LEVEL_THRESHOLDS.length; index += 1) {
    if (xp >= LEVEL_THRESHOLDS[index]) level = index + 1;
  }
  return Math.min(level, 20);
}

export function getLevelProgress(xp = 0) {
  const level = getLevelForXP(xp);
  const currentThreshold = LEVEL_THRESHOLDS[level - 1] ?? 0;
  const nextThreshold = LEVEL_THRESHOLDS[level] ?? LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1];
  const span = Math.max(nextThreshold - currentThreshold, 1);
  return {
    level,
    currentThreshold,
    nextThreshold,
    percent: level >= 20 ? 100 : Math.min(100, Math.round(((xp - currentThreshold) / span) * 100)),
    toNextLevel: Math.max(0, nextThreshold - xp),
  };
}

export function createEmptyAvatar() {
  return {
    color: '#7c3aed',
    hat: 'none',
    accessory: 'none',
  };
}

export function createDefaultStateFragments() {
  return {
    behaviorCategories: structuredClone(DEFAULT_BEHAVIOR_CATEGORIES),
    badges: structuredClone(DEFAULT_BADGES),
    rewardStore: structuredClone(DEFAULT_REWARD_STORE),
    settings: structuredClone(DEFAULT_SETTINGS),
  };
}

function getStudentEvents(state, studentId) {
  return (state.behaviorLog || []).filter((event) => event.studentId === studentId);
}

function countOnTimeSubmissions(state, studentId) {
  return Object.values(state.assignments || {}).reduce((count, assignment) => {
    const result = assignment.studentStatuses?.[studentId];
    return result === 'completed' ? count + 1 : count;
  }, 0);
}

function countCategoryPoints(state, studentId, categoryId) {
  return getStudentEvents(state, studentId)
    .filter((event) => event.categoryId === categoryId && event.points > 0)
    .reduce((sum, event) => sum + event.points, 0);
}

export function evaluateEarnedBadges(state, studentId) {
  const student = state.students?.[studentId];
  if (!student) return [];
  const existing = new Set(student.badges || []);
  const earned = [];
  for (const badge of state.badges || []) {
    if (existing.has(badge.id)) continue;
    const rule = badge.rule || {};
    let unlocked = false;
    if (rule.type === 'joins') unlocked = true;
    if (rule.type === 'streak') unlocked = (student.streak || 0) >= (rule.threshold || 0);
    if (rule.type === 'level') unlocked = (student.level || 1) >= (rule.threshold || 1);
    if (rule.type === 'onTimeSubmissions') unlocked = countOnTimeSubmissions(state, studentId) >= (rule.threshold || 0);
    if (rule.type === 'categoryPoints') unlocked = countCategoryPoints(state, studentId, rule.categoryId) >= (rule.threshold || 0);
    if (unlocked) earned.push(badge.id);
  }
  return earned;
}

export function calculateStreak(previousDate, currentDate) {
  if (!currentDate) return 0;
  if (!previousDate) return 1;
  const start = new Date(previousDate);
  const end = new Date(currentDate);
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  const diff = Math.round((end - start) / 86400000);
  if (diff <= 0) return null;
  if (diff === 1) return 'increment';
  return 'reset';
}

export function updateStudentGamification(student, { xpDelta = 0, activityDate = Date.now(), positive = false } = {}) {
  const updated = {
    ...student,
    xp: Math.max(0, (student.xp || 0) + xpDelta),
    lastActive: activityDate,
  };
  const previousLevel = student.level || 1;
  updated.level = getLevelForXP(updated.xp);
  if (positive) {
    const streakState = calculateStreak(student.lastPositiveDate, activityDate);
    if (streakState === 'increment') updated.streak = (student.streak || 0) + 1;
    else if (streakState === 'reset') updated.streak = 1;
    else if (streakState === null) updated.streak = Math.max(1, student.streak || 0);
    updated.lastPositiveDate = activityDate;
  }
  return {
    student: updated,
    leveledUp: updated.level > previousLevel,
  };
}

export function updateGoalsProgress(state) {
  const totalXP = Object.values(state.students || {}).reduce((sum, student) => sum + (student.xp || 0), 0);
  state.goals = (state.goals || []).map((goal) => ({
    ...goal,
    currentXP: totalXP,
    completed: totalXP >= Number(goal.targetXP || 0),
  }));
  return state;
}

export function summarizeStudent(student) {
  const progress = getLevelProgress(student?.xp || 0);
  return {
    xp: student?.xp || 0,
    level: student?.level || 1,
    streak: student?.streak || 0,
    progress,
  };
}

export function getAvatarUnlocks(xp = 0) {
  return {
    hats: ['none', 'cap', ...(xp >= 500 ? ['crown'] : []), ...(xp >= 1500 ? ['halo'] : [])],
    accessories: ['none', 'glasses', ...(xp >= 400 ? ['star'] : []), ...(xp >= 900 ? ['bowtie'] : [])],
  };
}
