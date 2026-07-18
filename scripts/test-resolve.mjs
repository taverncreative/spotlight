// Resolver hook for `node --test`, so test files and the lib modules under test
// can use the repo's "@/..." path alias (which Next resolves via tsconfig paths,
// but bare Node does not). Scoped to the test run only via --import; it never
// touches the Next build.
//
// Maps "@/x" -> "<repo root>/x", appending ".ts" when the bare path has no
// extension (Node's ESM resolver does not add extensions itself).
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      let target = resolve(root, specifier.slice(2));
      if (!existsSync(target) && existsSync(`${target}.ts`)) target += ".ts";
      return { url: pathToFileURL(target).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
