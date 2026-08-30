import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../../..",
);

loadEnv({ path: path.join(repoRoot, ".env") });
loadEnv({
  path: path.join(repoRoot, "artifacts/api-server/.env"),
  override: true,
});
