import { readFileSync } from "node:fs";
import tseslint from "typescript-eslint";

const gitignore = readFileSync(new URL(".gitignore", import.meta.url), "utf8")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#") && !line.startsWith("!"));

export default tseslint.config(
  {
    ignores: gitignore,
  },
  ...tseslint.configs.recommended,
);
