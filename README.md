# ClassQuest PRD

## 1. Product Overview & Vision
ClassQuest is a gamified classroom management platform that helps teachers and students track behavior, assignments, achievements, and academic growth through interactive game-like systems. Its value proposition is improved classroom motivation, transparency, and engagement without adding administrative burden. ClassQuest is differentiated by a local-first, fully browser-based peer-to-peer model: the teacher runs the authoritative classroom session directly in their browser, and student browsers connect through PeerJS with no traditional backend server or centralized database for core product operation.

## 2. User Personas & Permissions
### Teacher / Host Node
- Creates classroom sessions and generates unique classroom join codes.
- Admits/removes students and binds student IDs to active peer connections.
- Owns authoritative state for behavior events, assignments, XP, badge awards, and class goals.
- Can create/edit/delete assignments, define behavior categories, apply rewards/penalties, and resolve sync conflicts.
- Can trigger snapshot exports/imports for backup and continuity.

### Student / Client Node
- Joins a class using classroom code + student ID.
- Views personal progress (XP, level, streaks, assignment status, badges, avatar).
- Submits assignment completion evidence/status updates (subject to teacher validation rules).
- Receives real-time state updates from host.
- Cannot mutate global/classroom-authoritative state directly; sends intents/events to host for validation.

## 3. Core Gamification Mechanics
- **XP & Levels:** Students earn XP for positive behavior, assignment completion, and streak milestones. Teacher-configurable XP weights by activity type.
- **Behavior Event Engine:** Behavior actions map to positive/negative point events with transparent categories (e.g., teamwork, participation, disruption, late work).
- **Customizable Avatars:** Unlock cosmetic avatar items using XP/achievement thresholds; cosmetics are non-paywalled and classroom-safe.
- **Achievement Badges:** Rule-based badges (e.g., “Homework Hero: 5 on-time submissions,” “Collaboration Pro: 10 teamwork points”).
- **Streak Tracking:** Daily/weekly streaks for attendance, assignment submissions, or positive behavior; streak-break grace rules configurable by teacher.
- **Class-Wide Collaborative Goals:** Shared objectives (e.g., “Class reaches 5,000 XP this month”) that unlock collective rewards chosen by teacher.
- **Progress Timeline:** Per-student chronological feed combining behavior events, assignment outcomes, badge unlocks, and streak changes.
- **Reward Store (Classroom Currency):** Optional teacher-managed redemption catalog where students exchange earned points for classroom privileges.

All mechanics must be directly tied to behavior and assignment events to ensure educational relevance and avoid “points without purpose.”

## 4. Feature Requirements (MoSCoW framework)
### Classroom setup & Peer connection
**Must-Have**
- Teacher-hosted session creation in-browser with unique classroom code.
- Student join flow via classroom code + student ID using PeerJS.
- Connection status indicators (connected/reconnecting/offline).
- Host-side student roster with join/leave presence.

**Should-Have**
- Rejoin flow preserving student identity after refresh/disconnect.
- Teacher approval gate for unknown student IDs.

**Could-Have**
- QR code representation of classroom code.
- Optional proximity/name hints for easier student identification.

**Won’t-Have (for MVP)**
- Account-based cloud login.
- Centralized roster directory service.

### Behavior & Progress tracking
**Must-Have**
- Teacher-defined behavior categories with point impacts.
- Real-time behavior logging and automatic XP recalculation.
- Individual student progress views (XP, level, recent events).

**Should-Have**
- Bulk behavior actions (apply to groups).
- Configurable weighted behavior rules by period/subject.

**Could-Have**
- Behavior heatmap trends by day/time.
- Student self-reflection prompts tied to behavior events.

**Won’t-Have (for MVP)**
- AI-driven behavior inference.

### Assignment management
**Must-Have**
- Assignment create/edit/archive by teacher.
- Student assignment status tracking (assigned/in progress/submitted/completed/late).
- Assignment-linked XP and badge triggers.

**Should-Have**
- Rubric-style completion criteria.
- Late policy configuration affecting streak/XP.

**Could-Have**
- Attachment metadata references (local-only pointers, no centralized storage dependency).
- Peer collaboration assignment types.

**Won’t-Have (for MVP)**
- LMS-gradebook integrations.

### Gamification/Rewards
**Must-Have**
- XP/level system, badge engine, streak tracking.
- Teacher-configurable reward definitions.
- Class-wide collaborative goal tracking.

**Should-Have**
- Seasonal events/challenges template presets.
- Team quests (small groups).

**Could-Have**
- Student-voted reward options.
- Thematic avatar sets.

**Won’t-Have (for MVP)**
- Real-money purchases or external monetization mechanics.

## 5. Technical Architecture & Data Strategy
### Architecture Baseline
- 100% browser-based client application.
- No Node/Express API, no Firebase, no Postgres, no centralized backend required for core behavior/assignment/gamification logic.
- Peer-to-peer communication via PeerJS.

### PeerJS Connection Handshake (Host vs Client)
1. Teacher launches host mode and creates a PeerJS host peer ID for the classroom session.
2. App generates a human-friendly classroom code mapped locally to the host peer ID.
3. Student enters classroom code + student ID and initiates PeerJS connection to host peer.
4. Host validates join payload (student ID format, duplicate handling, optional teacher approval).
5. On acceptance, host returns:
   - session metadata (class name, period, rule config version),
   - current authoritative state snapshot (roster, assignments, XP, badges, goals),
   - sync token/version vector for subsequent delta updates.
6. Student client stores snapshot locally and subscribes to host broadcast deltas.

### Data Persistence (Local)
- **IndexedDB (primary):** authoritative state snapshots, event log, assignments, behavior rules, gamification rules, student profiles, badge definitions.
- **localStorage (secondary):** lightweight session pointers (last classroom code, student ID, UI preferences, last known host peer ID).
- Host performs periodic local checkpoints plus event-log compaction.
- Export/import JSON backup flows for teacher-controlled disaster recovery.

### State Syncing (Teacher-authoritative model)
- Host maintains canonical state and monotonically increasing state version.
- Student actions are submitted as intent messages (e.g., `REQUEST_ASSIGNMENT_SUBMIT`) rather than direct writes.
- Host validates intents, applies deterministic reducers, increments version, and broadcasts delta patches.
- Clients apply patches only if version ordering is valid; otherwise request resync snapshot.
- On reconnect, client sends last seen version; host returns missed deltas or fresh snapshot when gap exceeds retention.

## 6. Edge Cases & Error Handling
1. **Teacher browser closes/crashes (host unavailable)**
   - **UX fallback:** Students see “Class Host Offline” banner and enter read-only local mode with last synced data.
   - **Technical fallback:** Host restores from latest IndexedDB checkpoint/event log on relaunch and resumes same classroom code when possible; students auto-reconnect and request delta/snapshot reconciliation.

2. **Student loses WiFi / intermittent connection**
   - **UX fallback:** Student sees reconnecting indicator and local pending-action queue count.
   - **Technical fallback:** Client buffers non-authoritative intents locally with timestamps/idempotency keys, retries on reconnect, and discards/updates queue based on host acknowledgements.

3. **Data conflicts from stale client state**
   - **UX fallback:** User receives non-blocking “Data refreshed to latest class state” notice.
   - **Technical fallback:** Host rejects stale version mutations, returns canonical values plus conflict reason; client replays valid intents against latest snapshot where applicable.

4. **Duplicate student IDs attempting to join**
   - **UX fallback:** Teacher prompted to approve replacement, deny, or alias new connection.
   - **Technical fallback:** Host enforces unique active identity map and terminates superseded peer connection based on teacher decision.

5. **Corrupted local persistence**
   - **UX fallback:** Guided recovery flow with restore-from-export option.
   - **Technical fallback:** Validate schema/version checksums at load; if invalid, roll back to last valid checkpoint or import package.

### Compliance Check Against Evaluation Criteria
Core tracking and gamification logic relies exclusively on browser-local persistence (IndexedDB/localStorage) and PeerJS synchronization between teacher and student peers. No centralized backend is required for required functionality.
