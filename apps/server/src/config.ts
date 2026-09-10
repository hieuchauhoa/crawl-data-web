import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoWorkspaceRoot = fileURLToPath(new URL("../../../workspaces/", import.meta.url));

export const config = {
  host: process.env.HOST || "127.0.0.1",
  port: Number(process.env.PORT || 17321),
  workspaceRoot: process.env.WORKSPACE_ROOT || repoWorkspaceRoot,
  maria: {
    host: process.env.MARIADB_HOST || "127.0.0.1",
    port: Number(process.env.MARIADB_PORT || 3306),
    user: process.env.MARIADB_USER || "root",
    password: process.env.MARIADB_PASSWORD || "",
    cli: process.env.MARIADB_CLI || "",
    dumpCli: process.env.MARIADB_DUMP_CLI || ""
  }
};

// Keep older state readable. Phase 2 persists into its own folder.
export const phase0Dir = path.join(config.workspaceRoot, "phase0");
export const phase1Dir = path.join(config.workspaceRoot, "phase1");
export const phase2Dir = path.join(config.workspaceRoot, "phase2");
export const phase3Dir = path.join(config.workspaceRoot, "phase3");
export const phase4Dir = path.join(config.workspaceRoot, "phase4");
