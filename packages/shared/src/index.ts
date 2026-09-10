export type SeoData = {
  title: string | null;
  description: string | null;
  keywords: string | null;
  canonical: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  ogImage: string | null;
  ogUrl: string | null;
  twitterTitle: string | null;
  twitterDescription: string | null;
  twitterImage: string | null;
  robots: string | null;
  jsonLd: unknown[];
};

export type ElementSummary = { tag: string; text: string; selector: string; classes: string[] };
export type RepeatedItemSelection = { clicked: ElementSummary; container: ElementSummary; count: number; selector: string; detailCandidates: Array<{ text: string; href: string }> };
export type DetailUrlSelection = { href: string; text: string; selector: string };
export type DetailFieldSelection = { field: string; value: string; selector: string; extraction: "text" };

export type SelectorStrategy = {
  primary: string;
  fallback: string[];
  xpath: string | null;
  relativeTo: "document" | "item";
  stableAttributes: Record<string, string>;
  fingerprint: {
    tag: string;
    classes: string[];
    childTags: string[];
    depth: number;
    textHint: string | null;
  };
};

export type ExtractionMode = "text" | "html" | "attribute" | "meta" | "constant" | "generated" | "source-url" | "range" | "relation" | "database-default" | "null";

// Two boundary elements picked directly on the page (see rangeSelector below) — for data that isn't
// wrapped in any single container the recipe could select as one element, only bounded by "starts
// after this sibling, ends at that one."
export type RangeSelector = { start: SelectorStrategy; end: SelectorStrategy };

export type RecipeField = {
  id: string;
  targetTable: string;
  targetColumn: string;
  source: "dom" | "meta" | "constant" | "generated" | "source-url" | "relation" | "database-default" | "null";
  extraction: ExtractionMode;
  attribute: string | null;
  selector: SelectorStrategy | null;
  sampleValue: string | null;
  // Only meaningful when extraction is "generated": computed at import time (not crawl time), so it
  // reflects when the record actually lands in the new database rather than when it was scraped.
  generator?: "now-timestamp" | "now-date" | null;
  // A "read more"/"show full content" toggle to click before reading this field's value — some sites
  // only populate the full content into the DOM after such a click, not on initial page load.
  clickBeforeExtract?: SelectorStrategy | null;
  // Only meaningful when extraction is "source-url": the crawled item's own URL frequently needs a
  // fixed prefix/segment stripped before it means anything on the new site (e.g. a local file:// path,
  // or the old domain) — same find/replace rule shape as an asset's urlRewrite, applied to item.url
  // instead of an image URL.
  urlRewrite?: UrlRewriteRule[];
  // Only meaningful when extraction is "range": the two picked boundary elements (see RangeSelector).
  rangeSelector?: RangeSelector;
  // "list" (default when absent, for recipes saved before this existed, is "detail"): some sites only
  // ever show a field (an excerpt, a category label) on the LISTING page, not on the item's own detail
  // page — a "detail"-scoped field has nothing there to select. A "list" field's selector is captured
  // relative to the repeated item (like avatar/detailUrl already are) and its value is read once per
  // item while the list pages are discovered, the same way avatar/detailUrl already work.
  scope?: "list" | "detail";
};

export type ImageCandidate = {
  url: string;
  source: "src" | "srcset" | "data-src" | "data-original" | "picture" | "parent-link" | "background-image" | "og:image";
  width: number | null;
  height: number | null;
  score: number;
};

export type BreadcrumbLevel = {
  index: number;
  text: string;
  selector: SelectorStrategy;
  targetTable: string | null;
  targetColumn: string | null;
  ignored: boolean;
};

export type PaginationRecipe =
  | { kind: "none"; reason: "single-page" | "not-visible"; page2Url: string | null }
  | { kind: "url-pattern"; container: SelectorStrategy | null; pattern: string; start: number; detectedMax: number | null; sampleUrls: string[] }
  | { kind: "load-more"; container: SelectorStrategy | null }
  | { kind: "infinite-scroll"; container: SelectorStrategy | null };

export type CrawlRecipe = {
  id: string;
  version: 2;
  name: string;
  hostname: string;
  createdAt: string;
  updatedAt: string;
  source: { startUrl: string; listPath: string };
  list: {
    item: SelectorStrategy | null;
    itemCount: number;
    detailUrl: SelectorStrategy | null;
    detailUrlSample: string | null;
    avatar: SelectorStrategy | null;
    imageCandidates: ImageCandidate[];
    breadcrumb: BreadcrumbLevel[];
    pagination: PaginationRecipe;
  };
  detail: { fields: RecipeField[]; gallery: SelectorStrategy | null; galleryCount: number };
  seo: { automatic: true; sample: SeoData | null };
};

export type BridgeEvent =
  | { type: "extension.ping"; pageUrl: string; at: string }
  | { type: "list.item.selected"; pageUrl: string; at: string; payload: RepeatedItemSelection }
  | { type: "detail.url.selected"; pageUrl: string; at: string; payload: DetailUrlSelection }
  | { type: "detail.field.selected"; pageUrl: string; at: string; payload: DetailFieldSelection }
  | { type: "seo.extracted"; pageUrl: string; at: string; payload: SeoData }
  | { type: "recipe.updated"; pageUrl: string; at: string; payload: CrawlRecipe };

export type SchemaColumn = { name: string; type: string; nullable: boolean; defaultValue: string | null; key: string; extra: string; ordinal: number };
export type SchemaIndex = { name: string; unique: boolean; primary: boolean; columns: string[] };
export type SchemaTable = { name: string; engine: string | null; collation: string | null; estimatedRows: number | null; columns: SchemaColumn[]; indexes: SchemaIndex[] };
export type RelationSuggestion = { id: string; sourceTable: string; sourceColumn: string; targetTable: string; targetColumn: string; confidence: number; reason: string; status: "suggested" | "confirmed" | "rejected" };
export type SchemaInspection = { database: string; tables: SchemaTable[]; required: Record<"bmws_product" | "bmws_news" | "bmws_seo", boolean>; relations: RelationSuggestion[] };

export type SeoMappingConfig = {
  seoTable: string;
  parentColumn: string;
  comColumn: string;
  actColumn: string;
  typeColumn: string;
  titleColumn: string | null;
  descriptionColumn: string | null;
  keywordsColumn: string | null;
  com: string;
  act: string;
  type: string;
};
export type ExistingRecordPolicy = { matchColumns: string[]; policy: "skip" };
// A plain substring find/replace on the resolved asset URL, applied before download — every site
// structures its thumb/watermark/CDN paths differently, so the operator can point at a real example
// URL and describe the fix in the same terms they'd use to explain it to a person ("replace this bit
// with that"), rather than needing to know regex. Rules apply in order, each is a straight substring
// replace of every occurrence (not just the first).
export type UrlRewriteRule = { find: string; replace: string };
export type AssetMappingConfig = {
  avatarColumn: { table: string; column: string } | null;
  galleryTable: { table: string; parentColumn: string; pathColumn: string } | null;
  urlRewrite: UrlRewriteRule[];
};
export type WorkspaceConfig = {
  mainTable: string | null;
  relatedTables: string[];
  relations: RelationSuggestion[];
  seo: SeoMappingConfig | null;
  existingRecord: ExistingRecordPolicy | null;
  assets: AssetMappingConfig | null;
};
export type WorkspaceInfo = { id: string; database: string; originalName: string; storedPath: string; importCopyPath: string; baselinePath: string; exportDir: string; assetsStoreDir: string; assetsExportDir: string; deltaLogPath: string; createdAt: string; sha256Before: string; sha256After: string; inputUnchanged: boolean; removedDatabaseLevelStatements: number; schema: SchemaInspection; config: WorkspaceConfig; deltaOperationCount: number };
export type SqlImportResult = WorkspaceInfo;
export type TableRowsResult = { table: string; columns: string[]; rows: Array<Record<string, unknown>>; total: number; offset: number; limit: number };

export type Phase0State = {
  lastExtensionSeen: string | null;
  lastPageUrl: string | null;
  database: WorkspaceInfo | null;
  repeatedItem: RepeatedItemSelection | null;
  detailUrl: DetailUrlSelection | null;
  detailField: DetailFieldSelection | null;
  seo: SeoData | null;
  activeRecipeId: string | null;
  recipes: CrawlRecipe[];
  events: BridgeEvent[];
};

export type CrawlQueueStatus = "pending" | "running" | "success" | "failed" | "skipped";
export type CrawlQueueItem = {
  id: string; url: string; canonicalUrl: string; sourcePage: string; status: CrawlQueueStatus;
  attempt: number; httpStatus: number | null; lastError: string | null;
  createdAt: string; startedAt: string | null; completedAt: string | null;
  avatarCandidates: string[];
  // Values for "list"-scoped RecipeFields (see RecipeField.scope), read once per item while the list
  // pages are discovered — the only chance to read them, since a "list" field may have nothing to
  // select on the item's own detail page at all.
  listFields?: Record<string, string | null>;
  extracted?: {
    fields: Record<string,string|null>; seo: SeoData; breadcrumb: Array<{ index: number; text: string }>;
    galleryCandidates: string[];
  };
};
export type CrawlLogEntry = { at: string; runId: string; url: string | null; stage: "run"|"list"|"detail"; worker: number | null; level: "info"|"error"; message: string; error?: string };
export type CrawlRunStatus = "idle"|"discovering"|"running"|"paused"|"completed"|"failed";
export type CrawlRun = {
  id: string; recipeId: string; status: CrawlRunStatus; mode: "test"|"full";
  workers: number; maxWorkers: number; createdAt: string; startedAt: string | null; completedAt: string | null;
  discoveryDone: boolean; discoveredPages: number; queue: CrawlQueueItem[]; logs: CrawlLogEntry[];
};
export type CrawlRuntimeState = { activeRunId: string | null; runs: CrawlRun[] };

export type AssetKind = "avatar" | "gallery" | "content";
export type AssetDownloadStatus = "downloaded" | "reused" | "error";
export type AssetDownloadResult = {
  sourceUrl: string;
  kind: AssetKind;
  status: AssetDownloadStatus;
  sha256: string | null;
  ext: string | null;
  mime: string | null;
  width: number | null;
  height: number | null;
  bytes: number | null;
  exportName: string | null;
  error: string | null;
};

export type ImportItemStatus = "inserted" | "updated" | "skipped" | "error";
export type ImportItemResult = {
  queueItemId: string;
  url: string;
  status: ImportItemStatus;
  mainId: number | null;
  error: string | null;
  assets: AssetDownloadResult[];
};
export type ImportRun = {
  id: string;
  runId: string;
  recipeId: string;
  createdAt: string;
  completedAt: string | null;
  inserted: number;
  updated: number;
  skipped: number;
  failed: number;
  insertedRows: number;
  assetsDownloaded: number;
  assetsReused: number;
  assetsFailed: number;
  items: ImportItemResult[];
  // Set once this run's rows have been deleted via the "Xoá dữ liệu đã import" rollback — kept on the
  // run record (rather than deleting the run itself) so the operator still has a record of what
  // happened and can't accidentally roll it back twice.
  rolledBack?: boolean;
};

// A conflict is a crawled item whose configured match columns already match an existing row. The
// frontend shows these to the operator (FileZilla-style) before writing anything, instead of always
// silently skipping — "skip" remains the default choice per item, but overwrite/insert-anyway are on
// the table too.
export type ImportDecision = "skip" | "overwrite" | "insert";
export type ImportConflict = { queueItemId: string; url: string; matchedId: number; matchedOn: Record<string, string | null> };
export type ImportPreviewResult = { runId: string; recipeId: string; totalSuccess: number; conflicts: ImportConflict[] };

export type ExportBundleResult = {
  fileName: string;
  downloadUrl: string;
  sha256: string;
  createdAt: string;
  finalSqlBytes: number;
  deltaSqlBytes: number;
  assetCount: number;
  recipeCount: number;
};
