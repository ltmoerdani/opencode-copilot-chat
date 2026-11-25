/**
 * Read an OpenCode Go API key from the OpenCode CLI credential store.
 *
 * CONTRACT: node-only, no `vscode` import. The key is returned to the caller
 * and never logged; errors degrade to `undefined` so the sign-in command can
 * fall back to the Console browser flow.
 */
import { execFileSync } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";

const CLI_DB_PATH = path.join(os.homedir(), ".local", "share", "opencode", "opencode.db");
const CREDENTIAL_SQL = "SELECT value FROM credential WHERE integration_id = 'opencode-go' ORDER BY active DESC, time_updated DESC LIMIT 1";

/** Where users create a personal API key in the OpenCode Console. */
export const CONSOLE_KEYS_URL = "https://opencode.ai/console/api#personal-api-keys";

/** Accept the `sqlite3 -json` row shape and the `node:sqlite` single-row shape. */
export function parseCredentialRows(rows: unknown): string | undefined {
  const first: unknown = Array.isArray(rows) ? (rows[0] as unknown) : rows;
  if (!first || typeof first !== "object") {
    return undefined;
  }
  const value = (first as { value?: unknown }).value;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

interface SqliteDatabase {
  prepare(sql: string): { get(): unknown };
  close(): void;
}

/** Try the built-in reader first, then the `sqlite3` binary (issue #262 pattern). */
export function readCliGoApiKey(): string | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require("node:sqlite") as {
      DatabaseSync?: new (dbPath: string, options: { readOnly: boolean }) => SqliteDatabase;
    };
    if (typeof DatabaseSync === "function") {
      const db = new DatabaseSync(CLI_DB_PATH, { readOnly: true });
      try {
        const key = parseCredentialRows(db.prepare(CREDENTIAL_SQL).get());
        if (key) {
          return key;
        }
      } finally {
        db.close();
      }
    }
  } catch {
    // No built-in SQLite on this host — fall through to the binary.
  }

  try {
    const output = execFileSync("sqlite3", ["-readonly", "-json", CLI_DB_PATH, CREDENTIAL_SQL], {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return parseCredentialRows(JSON.parse(output) as unknown);
  } catch {
    return undefined;
  }
}
