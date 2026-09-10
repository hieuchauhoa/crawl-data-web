import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { BridgeEvent, CrawlRecipe, Phase0State, RelationSuggestion, WorkspaceConfig } from "@crawl/shared";
import { phase1Dir, phase2Dir } from "./config.js";

const statePath = path.join(phase2Dir, "state.json");
const legacyStatePath = path.join(phase1Dir, "state.json");

const emptyState = (): Phase0State => ({
  lastExtensionSeen: null, lastPageUrl: null, database: null,
  repeatedItem: null, detailUrl: null, detailField: null, seo: null,
  activeRecipeId: null, recipes: [], events: []
});
let state: Phase0State = emptyState();
let persistQueue: Promise<void> = Promise.resolve();

export async function initState() {
  await fs.mkdir(phase2Dir, { recursive: true });
  try { state = { ...emptyState(), ...JSON.parse(await fs.readFile(statePath, "utf8")) }; }
  catch {
    try { state = { ...emptyState(), ...JSON.parse(await fs.readFile(legacyStatePath, "utf8")), recipes: [], activeRecipeId: null }; }
    catch { state = emptyState(); }
    await persist();
  }
}
async function persist() {
  const snapshot = JSON.stringify(state, null, 2);
  const job = persistQueue.catch(() => undefined).then(async () => {
    const tempPath = `${statePath}.${process.pid}.${randomUUID()}.tmp`;
    try { await fs.writeFile(tempPath, snapshot, "utf8"); await fs.rename(tempPath, statePath); }
    finally { await fs.rm(tempPath, { force: true }).catch(() => undefined); }
  });
  persistQueue = job; return job;
}
export function getState(): Phase0State { return state; }
export async function setDatabase(database: Phase0State["database"]) { state.database = database; await persist(); }
// Clears only the local pointer to the active SQL workspace so the wizard goes back to the upload
// screen for a different file — the underlying MariaDB database itself is left untouched (reversible:
// an operator can always re-import to get the same data back, or drop the DB by hand if they're sure).
// Recipes are intentionally left alone: they target a source website, not this destination schema, so
// they may still be reusable against a fresh import of the same or a similarly-shaped site.
export async function clearDatabase() { state.database = null; await persist(); }
export async function setWorkspaceConfig(config: WorkspaceConfig) { if (!state.database) throw new Error("Chưa có workspace."); state.database.config = config; await persist(); }
export async function replaceRelations(relations: RelationSuggestion[]) { if (!state.database) throw new Error("Chưa có workspace."); state.database.config.relations = relations; await persist(); }
export async function updateWorkspaceSchema(schema: NonNullable<Phase0State["database"]>["schema"]) { if (!state.database) throw new Error("Chưa có workspace."); state.database.schema = schema; state.database.deltaOperationCount = 0; await persist(); }
export async function incrementDelta(n: number) { if (!state.database || !n) return; state.database.deltaOperationCount += n; await persist(); }

export async function saveRecipe(recipe: CrawlRecipe) {
  const now = new Date().toISOString();
  const normalized: CrawlRecipe = { ...recipe, version: 2, updatedAt: now, createdAt: recipe.createdAt || now };
  const index = state.recipes.findIndex(r => r.id === normalized.id);
  if (index >= 0) state.recipes[index] = normalized; else state.recipes.push(normalized);
  state.activeRecipeId = normalized.id;
  await persist(); return normalized;
}
export async function deleteRecipe(id: string) { state.recipes = state.recipes.filter(r => r.id !== id); if (state.activeRecipeId === id) state.activeRecipeId = null; await persist(); }
// Mirrors the same fallback the Extension's content script uses when tagging a Recipe (siteHostname()
// in content.ts): a file:// URL has no hostname at all, so the recipe was saved with its containing
// folder standing in for one (the folder, not the full file path — a local list.html and its own
// product-a.html detail page live in the same folder and must resolve to the same stand-in, or
// navigating from one to the other would never find the recipe just saved for it).
function urlHostname(url: URL): string { return url.hostname || `local-file:${url.pathname.replace(/\/[^/]*$/, "")}`; }
export function findRecipeForUrl(rawUrl: string) {
  let url: URL; try { url = new URL(rawUrl); } catch { return null; }
  const hostname = urlHostname(url);
  return state.recipes.find(r => r.hostname === hostname && (url.pathname === r.source.listPath || url.pathname.startsWith(r.source.listPath.replace(/\/$/, "") + "/")))
    || state.recipes.find(r => r.hostname === hostname) || null;
}
export async function applyBridgeEvent(event: BridgeEvent) {
  state.lastExtensionSeen = event.at; state.lastPageUrl = event.pageUrl;
  switch (event.type) {
    case "list.item.selected": state.repeatedItem = event.payload; break;
    case "detail.url.selected": state.detailUrl = event.payload; break;
    case "detail.field.selected": state.detailField = event.payload; break;
    case "seo.extracted": state.seo = event.payload; break;
    case "recipe.updated": await saveRecipe(event.payload); break;
  }
  state.events = [...state.events, event].slice(-150); await persist();
}
