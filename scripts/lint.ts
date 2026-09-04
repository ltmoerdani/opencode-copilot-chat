#!/usr/bin/env node
// Runs every linter (and the test suite) and prints a compact per-tool
// result. On success only a green check is shown; on failure the relevant
// error output is printed.

import { spawnSync } from "node:child_process";
import path from "node:path";
import pc from "picocolors";

const root = path.resolve(import.meta.dirname, "..");

const bin = (name: string): string => {
  const base = path.join(root, "node_modules", ".bin", name);
  // On Windows the npm shims are `.cmd` files and must be spawned through the
  // shell; spawning the extension-less shim yields ENOENT.
  return process.platform === "win32" ? `${base}.cmd` : base;
};

// Strip markdownlint-cli2 banner/summary noise and prettier's status header.
const NOISE = /^(markdownlint-cli2 v|Finding:|Linting:|Summary:|Checking formatting\.\.\.)/;

function clean(text: string): string {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !NOISE.test(line))
    .join("\n");
}

interface LintStep {
  label: string;
  cmd: string;
  args: string[];
}

interface StepResult {
  status: number | null;
  output: string;
}

const steps: LintStep[] = [
  { label: "Editorconfig", cmd: bin("editorconfig-checker"), args: [] },
  { label: "ESLint", cmd: bin("eslint"), args: [".", "--max-warnings", "0"] },
  {
    label: "Markdown",
    cmd: bin("markdownlint-cli2"),
    args: ["--config", ".markdownlint-cli2.json", "**/*.md", "#node_modules"],
  },
  { label: "Prettier", cmd: bin("prettier"), args: ["--check", ".", "--ignore-path", ".gitignore"] },
  { label: "Shell", cmd: bin("shellcheck"), args: [".husky/pre-commit"] },
  { label: "TypeScript", cmd: bin("tsc"), args: ["-p", "tsconfig.check.json"] },
  { label: "Tests", cmd: "npm", args: ["test"] },
];

console.log(pc.bold("Lint"));
let failed = false;
for (const step of steps) {
  const res = runStep(step);
  if (shouldRetryEditorconfig(step, res)) {
    console.log(`  ${pc.yellow("↻")} ${step.label} (retrying after transient download failure)`);
    const retried = runStep(step);
    if (retried.status === 0) {
      console.log(`  ${pc.green("✔")} ${step.label}`);
      continue;
    }
    res.status = retried.status;
    res.output = retried.output;
  }
  if (shouldSkipEditorconfig(step, res)) {
    console.log(`  ${pc.yellow("⚠")} ${step.label} (skipped: checker binary download unavailable)`);
    continue;
  }
  if (res.status === 0) {
    console.log(`  ${pc.green("✔")} ${step.label}`);
  } else {
    failed = true;
    console.log(`  ${pc.red("✖")} ${step.label}`);
    if (res.output) {
      console.log(indent(res.output));
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

function runStep(step: LintStep): StepResult {
  const res = spawnSync(step.cmd, step.args, {
    cwd: root,
    encoding: "utf8",
    // Windows cannot exec `.cmd` shims directly; route through the shell.
    shell: process.platform === "win32",
  });
  return { status: res.status, output: clean(`${res.stdout}${res.stderr}`) };
}

function shouldRetryEditorconfig(step: LintStep, res: StepResult): boolean {
  if (step.label !== "Editorconfig" || res.status === 0) {
    return false;
  }
  return isEditorconfigDownloadFailure(res.output);
}

function shouldSkipEditorconfig(step: LintStep, res: StepResult): boolean {
  return step.label === "Editorconfig" && res.status !== 0 && isEditorconfigDownloadFailure(res.output);
}

function isEditorconfigDownloadFailure(output: string): boolean {
  return (
    output.includes("Failed to download binary") ||
    /\bHttpError:.*\b(ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN)\b/i.test(output) ||
    /\bGET .* - 5\d\d\b/.test(output)
  );
}
