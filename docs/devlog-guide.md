# 📋 Devlog Guide — Rules for Reading & Updating

> Save as: `docs/devlog-guide.md`
> Trigger: "read DEVLOG" / "@DEVLOG" / "check devlog"

---

## 🤖 Core Principle

**AI DOES NOT NEED TO ASK. AI ACTS DIRECTLY.**

All inferences are performed automatically based on document contents.
Empty fields → write suggestions immediately.
Ambiguous status → interpret based on context.
No confirmation needed before providing a response.

---

## Step 1 — Read & Parse Session Handoff

Read the `⚡ Session Handoff` section of `docs/devlog.md`. Parse each field:

| Field        | If Filled             | If Empty                                                              |
| ------------ | --------------------- | --------------------------------------------------------------------- |
| Last Session | Use as time context   | Write: `[No previous session data]`                                   |
| Worked On    | Use as Devlog         | Infer from Active Tasks P0 with most recent `Last touched`            |
| Stopped At   | Use as resume point   | Infer from `Last touched` + `Next Action` of P0 task                  |
| Next Action  | Execute this directly | Infer from Active Tasks: pick P0 that isn't blocked, write suggestion |
| Open Issues  | Note as constraint    | Write: `[No open issues recorded]`                                    |

---

## Step 2 — Automatic Task Status Inference

Read `🔥 ACTIVE TASKS` from the devlog from `docs/devlog.md`. For each task, determine actual status based on:

### Task is ready to work on if:

- Status = 🟡 AND Blocked by = `-` AND Next Action is filled

### Task is actually complete if:

- Status is still 🟡 BUT a task with the same name/ID
  already exists in `✅ COMPLETED` or `📋 COMPLETED HISTORY`
- → Mark as `[ALREADY COMPLETE — needs to be moved]`
  and provide a suggestion to move it

### Task is actually blocked if:

- Blocked by contains another task that is still active
- → Write: `[BLOCKED by X which is not yet complete]`

### Task needs update if:

- `Last touched` is more than 3 days ago but status is still 🟡
- → Write suggestion: `[Needs confirmation: still active or already complete?]`
  directly in the response, without waiting to be asked

### Which task to work on first:

Auto-sort: P0 not blocked → P1 not blocked → P2
Recommend the top one directly.

---

## Step 3 — Auto-Fill Empty Fields

If any field is empty or `[NEEDS FILLING]`, don't leave it blank.
Write suggestions directly in the response based on inference:

### Empty Session Handoff:

```
💡 Suggestion Session Handoff:
Last Session: [no data — fill manually]
Worked On: Likely: [P0 task name with most recent Last touched]
Stopped At: Likely: [file from Doc field of P0 task]
Next Action: → [Next Action from active P0 task that isn't blocked]
Open Issues: [see tasks where Blocked by is not empty]
```

### Empty Next Action in Active Task:

Infer from task name + scope + status doc:

```
💡 Suggestion Next Action [TASK-ID]:
→ [concrete action based on task name and existing scope]
```

### Empty Est. remaining:

Infer from complexity scope:

- 1–3 scope items → `~2–4 hours`
- 4–7 scope items → `~1–2 days`
- 8+ scope items → `~3–5 days`

### Empty Doc:

Infer from task name → suggest path:

```
💡 Suggestion Doc path:
docs/[category]/[number]-[YYYYMMDD]-[slug-task-name].md
```

---

## Step 4 — Read Completed History Selectively

Don't read the entire devlog history every session. Read ONLY when relevant:

| Trigger                               | What to Read                                |
| ------------------------------------- | ------------------------------------------- |
| User asks "what's been done?"         | Completed items from the last 7 days only   |
| User mentions a specific task name/ID | Search history by ID or name                |
| About to start a new task             | Check if a similar task was previously done |
| Task has no Doc path                  | Check history to infer the correct path     |
| Debugging an issue                    | Check if a similar issue was fixed before   |

---

## Step 5 — Automatic Response at Session Start

Without being asked, output this when DEVLOG is read:

```
## 📍 Current Status

**Last worked on:** [Last Session]
**Working on:** [Worked On]
**Stopped at:** [Stopped At]

---

## ⚡ Continue Now

[Next Action from Session Handoff]

**Active task:** [P0 name that isn't blocked]
**Status:** [status + est. remaining]
**Doc:** [path]

---

## ⚠️ Needs Attention

[List items from Open Issues]
[List tasks that need update because Last touched > 3 days]
[List tasks that are likely complete but haven't been moved]

---

## 💡 Suggestions

[All empty fields that need filling, with suggested values]
```

If nothing needs attention → skip that section.
If no suggestions → skip that section.

---

## Status Interpretation Rules

### 🟡 In Progress

Task is running. Check Blocked by:

- `-` → can be continued directly
- Has content → cannot be continued, mention the blocker

### 🟡 Design Review / Awaiting Approval

Task is waiting for a decision. No external blocker needed.
AI can provide design summary and recommendation
without being asked.

### 🟢 Complete (but still in Active Tasks)

→ Auto-detect as "needs to be moved to Completed"
→ Include template table row for moving:

```
| [ID] | `tag` | Task Name — impact | HH:MM | commit | [link](path) |
```

### ⏸️ Paused

Check Resume Trigger:

- Trigger is met (a related task was completed in history)
  → Write: `[READY TO RESUME — trigger met]`
- Trigger not met
  → Write: `[Wait: X]` and don't recommend it

---

## Rules for Completed History

### How to read by date:

- Most recent date = most relevant work for current context
- Scan backward only until you find the context you need
- Stop when you have enough, don't read everything

### Detecting duplicates:

If two items share the same doc path:

- Older item → mark `*(see [newer item ID])*`
- Newer item → this is the valid one

### Detecting wrong dates:

If a file name contains a date different from the
header section (e.g., file `20260602` but in `2026-01-20` section):
→ Note in response: `[POSSIBLE WRONG DATE: file shows YYYY-MM-DD]`

---

## Automatic Technical Context

Before coding, AI automatically:

1. **Read coding standards** from project root configs (`tsconfig.json`, `package.json`)
   If not found → write: `[WARNING: No coding standards config found]`

2. **Identify project type** from `package.json` and `src/` structure
   Use for all tasks tagged `ext`, `feat`, `fix`

3. **Check recent releases** from `CHANGELOG.md`
   Use to ensure task doesn't conflict with recent changes

---

## Tag → Reference Document Mapping

| Task Tag    | Document to Read Automatically                    |
| ----------- | ------------------------------------------------- |
| `ext`       | `docs/architecture/` — extension architecture     |
| `feat`      | `docs/features/` — feature specs                  |
| `fix`       | `docs/issues/` — bug reports and fixes            |
| `models`    | `docs/references/` — model registry docs          |
| `streaming` | `docs/features/` — streaming-related feature docs |
| `routing`   | `docs/features/` — routing-related feature docs   |
| `security`  | `docs/issues/` — security-related issue docs      |

---

## Automatic Update Templates

AI includes ready-to-use templates in the response
without being asked, for all status changes:

### When a task is completed:

```
📋 Update DEVLOG:

1. REMOVE from Active Tasks: [ID]

2. ADD to Completed (last 7 days):
   ### 📅 [TODAY'S DATE]
   | [ID] | `[tag]` | [Task Name] — [brief impact] | [TIME] | [commit] | [link](path) |

3. UPDATE Session Handoff:
   Worked On: [name of completed task]
   Stopped At: [last file touched]
   Next Action: → [next P0 task that isn't blocked]
```

### When a task is started:

```
📋 Add to Active Tasks in DEVLOG:

### [PREFIX-XX] Task Name
**Status:** 🟡 In Progress
**Priority:** [P0/P1/P2] | **Est. remaining:** ~[X hours/days]
**Started:** [TODAY] [TIME]
**Last touched:** [TODAY] [TIME]
**Next Action:** → [concrete first step]
**Blocked by:** -
**Doc:** `docs/[path]/[number]-[date]-[slug].md`
```

---

## Common Questions → Automatic Answers

| User Question              | AI Response                                   |
| -------------------------- | --------------------------------------------- |
| "what are you working on?" | Active P0 + its Next Action                   |
| "what's been done?"        | Completed in last 7 days, summarized per day  |
| "how's task X?"            | Search by ID/name, state status + next action |
| "what's next?"             | P0 not blocked → P1 → P2, list in order       |
| "why hasn't X been done?"  | Check Paused/Blocked + Resume Trigger         |
| "how much longer?"         | Est. remaining from task field                |
| "is anything blocking?"    | List all tasks with non-empty Blocked by      |
| "what's pending?"          | Active Tasks + Open Issues + Paused tasks     |

---

## Absolute Prohibitions

- ❌ Don't ask the user before providing an answer/suggestion
- ❌ Don't leave fields empty without a suggestion
- ❌ Don't read the entire Completed History every session
- ❌ Don't skip Session Handoff
- ❌ Don't recommend Blocked or Paused tasks whose trigger isn't met
- ❌ Don't update documents directly — provide templates only

---

_Rules v3.0 | Updated: 2026-06-12_
_Paired with: `docs/devlog.md`_
