import {
  createDefaultStateFragments,
  createEmptyAvatar,
  evaluateEarnedBadges,
  getLevelForXP,
  updateGoalsProgress,
  updateStudentGamification,
} from './gamification.js';

const hostId = 'teacher';

export function generateId(prefix = 'cq') {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function generateClassCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  while (code.length < 6) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

export function createInitialState(classInfo = {}) {
  const fragments = createDefaultStateFragments();
  const state = {
    version: 0,
    versionVector: { [hostId]: 0 },
    classInfo: {
      name: classInfo.name || 'Quest Academy',
      period: classInfo.period || 'Period 1',
      code: classInfo.code || generateClassCode(),
    },
    students: {},
    assignments: {},
    behaviorCategories: fragments.behaviorCategories,
    behaviorLog: [],
    goals: [
      {
        id: generateId('goal'),
        title: 'Reach 5000 XP',
        targetXP: 5000,
        currentXP: 0,
        reward: 'Epic class celebration',
        completed: false,
      },
    ],
    badges: fragments.badges,
    rewardStore: fragments.rewardStore,
    settings: fragments.settings,
  };
  return classInfo.seedDemo ? seedSampleContent(state) : state;
}

export function hydrateState(rawState) {
  const base = createInitialState(rawState?.classInfo || {});
  const hydrated = {
    ...base,
    ...structuredClone(rawState || {}),
    students: structuredClone(rawState?.students || base.students),
    assignments: structuredClone(rawState?.assignments || base.assignments),
    behaviorCategories: structuredClone(rawState?.behaviorCategories || base.behaviorCategories),
    behaviorLog: structuredClone(rawState?.behaviorLog || []),
    goals: structuredClone(rawState?.goals || base.goals),
    badges: structuredClone(rawState?.badges || base.badges),
    rewardStore: structuredClone(rawState?.rewardStore || base.rewardStore),
    settings: structuredClone(rawState?.settings || base.settings),
  };
  hydrated.version = Number(hydrated.version || 0);
  hydrated.versionVector = hydrated.versionVector || { [hostId]: hydrated.version };
  updateGoalsProgress(hydrated);
  return hydrated;
}

function createDemoStudent(id, name, xp, overrides = {}) {
  return {
    id,
    name,
    xp,
    level: getLevelForXP(xp),
    streak: overrides.streak || 0,
    lastActive: Date.now() - Math.floor(Math.random() * 3600000),
    lastPositiveDate: Date.now() - 86400000,
    badges: overrides.badges || [],
    connStatus: overrides.connStatus || 'offline',
    avatar: overrides.avatar || createEmptyAvatar(),
    submissionLog: overrides.submissionLog || {},
  };
}

function seedSampleContent(state) {
  if (Object.keys(state.students || {}).length > 0) return state;
  const maya = createDemoStudent('maya', 'Maya Patel', 420, { streak: 3, badges: ['first-steps', 'participation-pro'] });
  const leo = createDemoStudent('leo', 'Leo Brooks', 190, { streak: 2, badges: ['first-steps'] });
  const aria = createDemoStudent('aria', 'Aria Kim', 650, { streak: 5, badges: ['first-steps', 'team-player', 'xp-hunter'] });
  state.students = {
    [maya.id]: maya,
    [leo.id]: leo,
    [aria.id]: aria,
  };
  const assignmentId = generateId('assignment');
  state.assignments[assignmentId] = {
    id: assignmentId,
    title: 'Vocabulary Quest',
    desc: 'Complete the vocabulary challenge and use each word in a sentence.',
    dueDate: new Date(Date.now() + 86400000 * 3).toISOString().slice(0, 10),
    xpReward: 50,
    latePenalty: 10,
    archived: false,
    studentStatuses: {
      maya: 'completed',
      leo: 'in-progress',
      aria: 'submitted',
    },
    studentSubmissionMeta: {
      maya: { updatedAt: Date.now() - 86400000, awarded: true },
      leo: { updatedAt: Date.now() - 3600000 },
      aria: { updatedAt: Date.now() - 1800000 },
    },
  };
  state.behaviorLog = [
    {
      id: generateId('behavior'),
      studentId: 'maya',
      categoryId: 'participation',
      points: 10,
      timestamp: Date.now() - 7200000,
      note: 'Shared a thoughtful answer during discussion.',
    },
    {
      id: generateId('behavior'),
      studentId: 'aria',
      categoryId: 'teamwork',
      points: 15,
      timestamp: Date.now() - 5400000,
      note: 'Led her small-group brainstorm.',
    },
  ];
  updateGoalsProgress(state);
  return state;
}

function finalizeState(state) {
  updateGoalsProgress(state);
  for (const student of Object.values(state.students || {})) {
    student.level = getLevelForXP(student.xp || 0);
    student.badges = [...new Set(student.badges || [])];
    student.avatar = student.avatar || createEmptyAvatar();
    student.submissionLog = student.submissionLog || {};
  }
  return state;
}

export function reduceState(currentState, action) {
  const state = hydrateState(currentState);
  const meta = { awardedBadges: [], celebrations: [] };

  switch (action.type) {
    case 'APPROVE_STUDENT': {
      const existing = state.students[action.student.id] || {};
      const student = {
        id: action.student.id,
        name: action.student.name,
        xp: existing.xp || 0,
        level: existing.level || 1,
        streak: existing.streak || 0,
        lastActive: Date.now(),
        lastPositiveDate: existing.lastPositiveDate || null,
        badges: [...new Set([...(existing.badges || []), 'first-steps'])],
        connStatus: 'online',
        avatar: existing.avatar || createEmptyAvatar(),
        submissionLog: existing.submissionLog || {},
      };
      state.students[student.id] = student;
      meta.awardedBadges.push({ studentId: student.id, badgeIds: ['first-steps'] });
      break;
    }
    case 'SET_STUDENT_STATUS': {
      if (state.students[action.studentId]) {
        state.students[action.studentId].connStatus = action.status;
        state.students[action.studentId].lastActive = Date.now();
      }
      break;
    }
    case 'LOG_BEHAVIOR': {
      const category = state.behaviorCategories.find((item) => item.id === action.categoryId);
      const multiplier = category?.isPositive ? Number(state.settings?.xpWeights?.participation || 1) : 1;
      for (const studentId of action.studentIds || []) {
        const student = state.students[studentId];
        if (!student || !category) continue;
        const points = Math.round(category.points * multiplier);
        const event = {
          id: generateId('behavior'),
          studentId,
          categoryId: category.id,
          points,
          timestamp: action.timestamp || Date.now(),
          note: action.note || '',
        };
        state.behaviorLog.unshift(event);
        const result = updateStudentGamification(student, {
          xpDelta: points,
          activityDate: event.timestamp,
          positive: category.isPositive && points > 0,
        });
        state.students[studentId] = result.student;
        if (result.leveledUp) {
          meta.celebrations.push({ studentId, level: result.student.level });
        }
      }
      break;
    }
    case 'ADD_BEHAVIOR_CATEGORY': {
      state.behaviorCategories.push({
        id: action.category.id || generateId('category'),
        name: action.category.name,
        points: Number(action.category.points || 0),
        isPositive: Boolean(action.category.isPositive),
      });
      break;
    }
    case 'UPSERT_ASSIGNMENT': {
      const id = action.assignment.id || generateId('assignment');
      const current = state.assignments[id] || { studentStatuses: {}, studentSubmissionMeta: {} };
      state.assignments[id] = {
        ...current,
        ...action.assignment,
        id,
        xpReward: Number(action.assignment.xpReward || current.xpReward || 0),
        latePenalty: Number(action.assignment.latePenalty || current.latePenalty || 0),
        archived: Boolean(action.assignment.archived),
        studentStatuses: current.studentStatuses || {},
        studentSubmissionMeta: current.studentSubmissionMeta || {},
      };
      break;
    }
    case 'ARCHIVE_ASSIGNMENT': {
      if (state.assignments[action.assignmentId]) {
        state.assignments[action.assignmentId].archived = true;
      }
      break;
    }
    case 'MARK_ASSIGNMENT_STATUS': {
      const assignment = state.assignments[action.assignmentId];
      if (!assignment) break;
      assignment.studentStatuses = assignment.studentStatuses || {};
      assignment.studentSubmissionMeta = assignment.studentSubmissionMeta || {};
      assignment.studentStatuses[action.studentId] = action.status;
      assignment.studentSubmissionMeta[action.studentId] = {
        ...(assignment.studentSubmissionMeta[action.studentId] || {}),
        updatedAt: action.timestamp || Date.now(),
        note: action.note || '',
      };
      if (state.students[action.studentId]) {
        state.students[action.studentId].lastActive = Date.now();
      }
      break;
    }
    case 'REVIEW_SUBMISSION': {
      const assignment = state.assignments[action.assignmentId];
      const student = state.students[action.studentId];
      if (!assignment || !student) break;
      assignment.studentStatuses = assignment.studentStatuses || {};
      assignment.studentSubmissionMeta = assignment.studentSubmissionMeta || {};
      const dueTime = assignment.dueDate ? new Date(assignment.dueDate).getTime() : Infinity;
      const isLate = Date.now() > dueTime;
      if (action.approved) {
        assignment.studentStatuses[action.studentId] = isLate ? 'late' : 'completed';
        const alreadyAwarded = assignment.studentSubmissionMeta[action.studentId]?.awarded;
        if (!alreadyAwarded) {
          const reward = Math.max(0, Number(assignment.xpReward || 0) - (isLate ? Number(assignment.latePenalty || 0) : 0));
          const result = updateStudentGamification(student, {
            xpDelta: reward,
            activityDate: action.timestamp || Date.now(),
            positive: true,
          });
          state.students[action.studentId] = result.student;
          assignment.studentSubmissionMeta[action.studentId] = {
            ...(assignment.studentSubmissionMeta[action.studentId] || {}),
            updatedAt: action.timestamp || Date.now(),
            awarded: true,
            reward,
          };
          student.submissionLog[assignment.id] = { onTime: !isLate, approvedAt: action.timestamp || Date.now() };
          if (result.leveledUp) {
            meta.celebrations.push({ studentId: student.id, level: result.student.level });
          }
        }
      } else {
        assignment.studentStatuses[action.studentId] = 'in-progress';
        assignment.studentSubmissionMeta[action.studentId] = {
          ...(assignment.studentSubmissionMeta[action.studentId] || {}),
          updatedAt: action.timestamp || Date.now(),
          denied: true,
        };
      }
      break;
    }
    case 'ADD_GOAL': {
      state.goals.unshift({
        id: generateId('goal'),
        title: action.goal.title,
        targetXP: Number(action.goal.targetXP || 0),
        currentXP: 0,
        reward: action.goal.reward || 'Mystery reward',
        completed: false,
      });
      break;
    }
    case 'UPDATE_CLASS_INFO': {
      state.classInfo = { ...state.classInfo, ...action.classInfo };
      break;
    }
    case 'UPDATE_SETTINGS': {
      state.settings = {
        ...state.settings,
        ...action.settings,
        xpWeights: {
          ...(state.settings?.xpWeights || {}),
          ...(action.settings?.xpWeights || {}),
        },
        streakConfig: {
          ...(state.settings?.streakConfig || {}),
          ...(action.settings?.streakConfig || {}),
        },
      };
      break;
    }
    case 'UPDATE_BADGE_RULE': {
      state.badges = state.badges.map((badge) => (
        badge.id === action.badgeId
          ? { ...badge, rule: { ...badge.rule, threshold: Number(action.threshold || badge.rule.threshold) } }
          : badge
      ));
      break;
    }
    case 'UPDATE_AVATAR': {
      if (state.students[action.studentId]) {
        state.students[action.studentId].avatar = {
          ...state.students[action.studentId].avatar,
          ...action.avatar,
        };
      }
      break;
    }
    default:
      break;
  }

  for (const studentId of Object.keys(state.students || {})) {
    const newBadges = evaluateEarnedBadges(state, studentId);
    if (newBadges.length) {
      state.students[studentId].badges = [...new Set([...(state.students[studentId].badges || []), ...newBadges])];
      meta.awardedBadges.push({ studentId, badgeIds: newBadges });
    }
  }

  state.version = Number(state.version || 0) + 1;
  state.versionVector = {
    ...(state.versionVector || {}),
    [hostId]: state.version,
  };
  finalizeState(state);
  return { state, meta };
}

export function createDelta(previousVersion, action) {
  return {
    id: generateId('delta'),
    type: 'STATE_DELTA',
    fromVersion: previousVersion,
    version: previousVersion + 1,
    vector: { [hostId]: previousVersion + 1 },
    action,
    timestamp: Date.now(),
  };
}

export function applyDelta(state, delta) {
  const current = hydrateState(state);
  if ((delta?.fromVersion ?? -1) !== current.version) {
    return { state: current, applied: false };
  }
  const result = reduceState(current, delta.action);
  result.state.version = delta.version;
  result.state.versionVector = delta.vector || { [hostId]: delta.version };
  return { state: result.state, applied: true, meta: result.meta };
}
