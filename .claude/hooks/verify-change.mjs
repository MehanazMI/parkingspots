#!/usr/bin/env node
// PostToolUse hook: after Claude edits a TS/TSX file, verify the app still
// typechecks and lints. On failure, print the errors to stderr and exit 2 so
// Claude Code feeds them back to the model to fix. Uses Node (not jq) to parse
// the hook's stdin JSON, since jq isn't installed in this environment.
import { execSync } from "node:child_process";

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  let filePath = "";
  try {
    filePath = JSON.parse(input)?.tool_input?.file_path ?? "";
  } catch {
    process.exit(0); // unparseable payload — don't block
  }

  // Only care about TypeScript source changes.
  if (!/\.(ts|tsx)$/i.test(filePath)) process.exit(0);

  const problems = [];

  // Project-wide typecheck: a one-file edit can break a different file.
  // `--incremental false` is required: the project's tsconfig sets
  // incremental:true, and `tsc --noEmit --incremental` only reports errors on
  // the run that first sees a change — later runs read .tsbuildinfo, decide
  // "nothing changed", and exit 0 without re-reporting. That would make this
  // check silently miss errors. Forcing non-incremental re-checks every time.
  try {
    execSync("npx tsc --noEmit --incremental false", { stdio: "pipe" });
  } catch (e) {
    const out = `${e.stdout ?? ""}${e.stderr ?? ""}`.trim();
    problems.push(`TypeScript (tsc --noEmit) failed:\n${out}`);
  }

  // Lint just the file that changed (fast).
  try {
    execSync(`npx eslint "${filePath}"`, { stdio: "pipe" });
  } catch (e) {
    const out = `${e.stdout ?? ""}${e.stderr ?? ""}`.trim();
    problems.push(`ESLint failed for ${filePath}:\n${out}`);
  }

  if (problems.length > 0) {
    process.stderr.write(
      `Post-edit verification failed — fix before continuing:\n\n${problems.join("\n\n")}\n`
    );
    process.exit(2); // 2 = blocking error; stderr is fed back to Claude
  }

  process.exit(0);
});
