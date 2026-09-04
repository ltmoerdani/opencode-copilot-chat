#!/usr/bin/env node
// Intelligent pre-commit lint gate.
//
// Instead of linting the whole tree on every commit (slow), lint only what a
// change can actually affect:
//   - ESLint runs on the staged JS/TS files PLUS their direct dependents
//     (files that import a staged file), so changing a module can never leave
//     type-aware errors behind in its consumers.
//   - markdownlint runs on staged Markdown files.
//   - editorconfig-checker runs on staged files.
//   - shellcheck runs on staged .husky scripts.
//   - Type-checking (tsc -p tsconfig.check.json) and unit tests are
//     whole-project by nature and only run when src/ or scripts/ changed.
//
// Formatting (prettier --write, eslint --fix, markdownlint --fix) is left to
// lint-staged, which runs after this gate. The full-tree lint (including
// tests) stays available as `npm run lint` and is enforced in CI.

import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import pc from "picocolors";

const root = path.resolve(import.meta.dirname, "..");

const bin = (name: string): string => {
  const base = path.join(root, "node_modules", ".bin", name);
  // On Windows the npm shims are `.cmd` files and must be spawned through the
  // shell; spawning the extension-less shim yields ENOENT.
  return process.platform === "win32" ? `${base}.cmd` : base;
};

const SRC_DIRS = ["src", "scripts"];
const TS_EXT = new Set([".ts", ".tsx", ".js", ".cjs", ".cts"]);
const IMPORT_RE = /(?:from\s*|import\s*\(\s*|require\s*\(\s*)["'](\.[^"']+)["']/g;

interface CommandResult {
  status: number | null;
  output: string;
}

function run(cmd: string, args: string[]): CommandResult {
  const res: SpawnSyncReturns<string> = spawnSync(cmd, args, {
    cwd: root,
    encoding: "utf8",
    // Windows cannot exec `.cmd` shims directly; route through the shell.
    shell: process.platform === "win32",
  });
  return { status: res.status, output: `${res.stdout}${res.stderr}`.trim() };
}

/** Staged (added/copied/modified/renamed) file paths relative to the repo root. */
function stagedFiles(): string[] {
  // Include renamed (R) files and enable rename detection so a staged rename's
  // new path is linted too.
  const res = run("git", ["diff", "--cached", "--name-only", "-z", "--find-renames", "--diff-filter=ACMR"]);
  if (res.status !== 0) {
    return [];
  }
  return res.output.split("\0").filter(Boolean);
}

/** Every TS/JS source file under src/ and scripts/. */
function collectSourceFiles(): string[] {
  const out: string[] = [];
  for (const dir of SRC_DIRS) {
    const walk = (dirPath: string): void => {
      for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          walk(path.join(dirPath, entry.name));
        } else if (TS_EXT.has(path.extname(entry.name))) {
          out.push(path.join(dirPath, entry.name));
        }
      }
    };
    walk(dir);
  }
  return out;
}

/** Resolve a relative import specifier to an existing file, if any. */
function resolveImport(fromFile: string, spec: string): string | undefined {
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.cjs`,
    path.join(base, "index.ts"),
    path.join(base, "index.js"),
  ];
  // NodeNext-style: in ESM, `./foo.js` resolves to `./foo.ts`. Without this,
  // changing foo.ts would not lint its dependents (this repo imports ESM
  // scripts with `.js` specifiers that map to `.ts` sources).
  if (/\.(js|cjs|mjs)$/.test(base)) {
    const tsBase = base.replace(/\.(js|cjs|mjs)$/, "");
    candidates.unshift(`${tsBase}.ts`, `${tsBase}.tsx`);
  }
  for (const candidate of candidates) {
    try {
      statSync(candidate);
      return candidate;
    } catch {
      // keep trying
    }
  }
  return undefined;
}

/** resolved file path → set of source files importing it (one level deep). */
function buildImporters(): Map<string, Set<string>> {
  const importers = new Map<string, Set<string>>();
  for (const file of collectSourceFiles()) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(IMPORT_RE)) {
      const resolved = resolveImport(file, match[1]);
      if (!resolved) {
        continue;
      }
      let set = importers.get(resolved);
      if (!set) {
        set = new Set();
        importers.set(resolved, set);
      }
      set.add(file);
    }
  }
  return importers;
}

/**
 * Files related to the staged ones: their direct dependents within src/ and
 * scripts/, so changing a module's contract also lints its consumers.
 */
function relatedFiles(changedFiles: string[]): string[] {
  const importers = buildImporters();
  const related = new Set<string>();
  for (const file of changedFiles) {
    for (const importer of importers.get(file) ?? []) {
      related.add(importer);
    }
  }
  return [...related];
}

const staged = stagedFiles();
if (staged.length === 0) {
  console.log(pc.green("No staged files — nothing to lint."));
  process.exit(0);
}

const jsTsFiles = staged.filter((file) => TS_EXT.has(path.extname(file)));
const mdFiles = staged.filter((file) => file.endsWith(".md"));
const huskyFiles = staged.filter((file) => file.startsWith(".husky/"));
const sourceChanged = staged.some((file) => SRC_DIRS.some((dir) => file.startsWith(`${dir}/`)));

const eslintTargets = [...new Set([...jsTsFiles, ...relatedFiles(jsTsFiles)])];

interface StagedStep {
  label: string;
  cmd: string;
  args: string[];
  run: boolean;
}

const steps: StagedStep[] = [
  { label: "ESLint", cmd: bin("eslint"), args: ["--max-warnings", "0", ...eslintTargets], run: eslintTargets.length > 0 },
  { label: "Markdown", cmd: bin("markdownlint-cli2"), args: ["--config", ".markdownlint-cli2.json", ...mdFiles], run: mdFiles.length > 0 },
  { label: "Editorconfig", cmd: bin("editorconfig-checker"), args: [...staged], run: true },
  { label: "Shell", cmd: bin("shellcheck"), args: [...huskyFiles], run: huskyFiles.length > 0 },
  { label: "TypeScript", cmd: bin("tsc"), args: ["-p", "tsconfig.check.json"], run: sourceChanged },
  { label: "Tests", cmd: "npm", args: ["test"], run: sourceChanged },
];

console.log(pc.bold("Lint (staged)"));
let failed = false;
for (const step of steps) {
  if (!step.run) {
    console.log(`  ${pc.dim("-")} ${step.label} (nothing affected)`);
    continue;
  }
  let { status, output } = run(step.cmd, step.args);
  if (shouldRetryEditorconfig(step, status, output)) {
    console.log(`  ${pc.yellow("↻")} ${step.label} (retrying after transient download failure)`);
    const retried = run(step.cmd, step.args);
    status = retried.status;
    output = retried.output;
  }
  if (shouldSkipEditorconfig(step, status, output)) {
    console.log(`  ${pc.yellow("⚠")} ${step.label} (skipped: checker binary download unavailable)`);
    continue;
  }
  if (status === 0) {
    console.log(`  ${pc.green("✔")} ${step.label}`);
  } else {
    failed = true;
    console.log(`  ${pc.red("✖")} ${step.label}`);
    if (output) {
      console.log(indent(output));
    }
  }
}
console.log(failed ? pc.red("Failed") : pc.green("Passed"));
process.exit(failed ? 1 : 0);

function indent(text: string): string {
  return text
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
}

function shouldRetryEditorconfig(step: StagedStep, status: number | null, output: string): boolean {
  return step.label === "Editorconfig" && status !== 0 && isEditorconfigDownloadFailure(output);
}

function shouldSkipEditorconfig(step: StagedStep, status: number | null, output: string): boolean {
  return step.label === "Editorconfig" && status !== 0 && isEditorconfigDownloadFailure(output);
}

function isEditorconfigDownloadFailure(output: string): boolean {
  return (
    output.includes("Failed to download binary") ||
    /\bHttpError:.*\b(ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN)\b/i.test(output) ||
    /\bGET .* - 5\d\d\b/.test(output)
  );
}
