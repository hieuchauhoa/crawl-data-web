import type {
  BreadcrumbLevel, CrawlRecipe, ImageCandidate, PaginationRecipe, Phase0State, RecipeField,
  SchemaTable, SelectorStrategy, SeoData
} from "@crawl/shared";

type Mode = "idle" | "item" | "detail-url" | "avatar" | "breadcrumb" | "pagination" | "field" | "gallery" | "click-target" | "range-start" | "range-end";
type LocalResponse<T> = { ok: boolean; status: number; data?: T; error?: string };
const LOCAL_UI = "http://127.0.0.1:5173";
const PANEL_ID = "crawl-data-web-phase2-host";

// crypto.randomUUID() only exists in a "secure context" per spec (https, localhost, or file://) — on a
// plain http:// page (a real case: an old site itself, or a bare image URL like
// http://cdn.example.com/x.jpg that the browser renders as its own page) it's simply undefined, and
// every id generated on that page would throw. This manual fallback is just as good for a client-side
// id — nothing here needs cryptographic randomness — so it isn't gated by the same restriction.
function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

if (!["127.0.0.1", "localhost"].includes(location.hostname)) boot();

function boot() {
  let mode: Mode = "idle";
  let connected = false;
  let error = "";
  let schemaTables: SchemaTable[] = [];
  let mainTable = "";
  let relatedTables: string[] = [];
  let targetTable = "";
  let targetColumn = "";
  let extraction: RecipeField["extraction"] = "text";
  let pendingClickSelector: SelectorStrategy | null = null;
  let step = 1;
  let showPage2Input = false;
  let recipe = freshRecipe();
  let sampleUrls: string[] = [];
  let sampleIndex = -1;
  let sampleBusy = false;
  // For the "Vùng dữ liệu" (no wrapping container) extraction mode: two elements the operator picks
  // directly on the page, held as live references (not selectors yet) until both are chosen and the
  // range is confirmed — see "save-range" in action().
  let rangeStartEl: Element | null = null;
  let rangeEndEl: Element | null = null;
  // A normal field pick takes exactly the clicked leaf (a <p>, a <span>) — often narrower than the
  // whole container the operator actually meant (e.g. a big "article body" wrapper div, where the
  // click naturally lands on a paragraph inside it, not the wrapper itself). "Mở rộng lên cấp cha"
  // re-applies the same pick one level up the DOM each time it's pressed, so the operator can widen a
  // too-narrow pick without re-clicking on the page. Column/table are captured at pick time (not read
  // live off the dropdowns at widen time) so changing the dropdown in between can't silently redirect
  // a widen onto the wrong column.
  let lastFieldEl: Element | null = null;
  let lastFieldItemEl: Element | null = null;
  let lastFieldTable = "";
  let lastFieldColumn = "";

  const host = document.createElement("div");
  host.id = PANEL_ID;
  host.style.all = "initial";
  document.documentElement.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });

  const highlighter = document.createElement("div");
  Object.assign(highlighter.style, {
    position: "fixed", zIndex: "2147483646", pointerEvents: "none",
    border: "3px solid #2563eb", background: "rgba(37,99,235,.10)", borderRadius: "7px",
    display: "none", boxSizing: "border-box"
  });
  document.documentElement.appendChild(highlighter);

  function freshRecipe(): CrawlRecipe {
    const now = new Date().toISOString();
    const host = siteHostname();
    return {
      id: `recipe-${host}-${uuid()}`, version: 2,
      name: `${host} ${location.pathname}`, hostname: host,
      createdAt: now, updatedAt: now,
      source: { startUrl: location.href, listPath: location.pathname },
      list: {
        item: null, itemCount: 0, detailUrl: null, detailUrlSample: null,
        avatar: null, imageCandidates: [], breadcrumb: [],
        pagination: { kind: "none", reason: "not-visible", page2Url: null }
      },
      detail: { fields: [], gallery: null, galleryCount: 0 }, seo: { automatic: true, sample: null }
    };
  }

  const esc = (v: unknown) => String(v ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

  function done(n: number) {
    if (n === 1) return !!recipe.list.item;
    if (n === 2) return !!recipe.list.detailUrl;
    if (n === 3) return !!recipe.list.avatar;
    if (n === 4) return recipe.list.pagination.kind !== "none" || recipe.list.pagination.reason === "single-page";
    if (n === 5) return recipe.detail.fields.length > 0 || recipe.list.breadcrumb.length > 0;
    return false;
  }

  function stepTitle() {
    return ["", "Chọn nhóm sản phẩm / bài viết", "Chọn link trang chi tiết", "Chọn ảnh đại diện", "Thiết lập phân trang", "Map dữ liệu trang chi tiết", "Kiểm tra & lưu Recipe"][step];
  }

  function render() {
    const currentTable = targetTable || mainTable || schemaTables[0]?.name || "";
    const cols = schemaTables.find(t => t.name === currentTable)?.columns || [];
    if (!targetColumn || !cols.some(c => c.name === targetColumn)) targetColumn = cols[0]?.name || "";
    // render() replaces the whole panel's innerHTML on every state change (every click/pick), which
    // resets its own internal scroll to the top — jarring when repeatedly picking fields deep in a
    // long card. Save and restore the scroll position across the rebuild.
    const prevScroll = shadow.querySelector(".panel")?.scrollTop || 0;

    shadow.innerHTML = `<style>
      :host{all:initial}*{box-sizing:border-box}
      .panel{position:fixed;right:18px;top:18px;width:360px;max-height:calc(100vh - 36px);overflow:auto;overflow-x:hidden;z-index:2147483647;font:13px -apple-system,BlinkMacSystemFont,Inter,system-ui,sans-serif;color:#1d1d1f;background:#fff;border:1px solid rgba(0,0,0,.1);border-radius:14px;box-shadow:0 10px 34px rgba(0,0,0,.16)}
      .head{position:sticky;top:0;z-index:4;background:#fff;color:#1d1d1f;padding:13px 14px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(0,0,0,.08)}
      .body{padding:14px}.brand{font-weight:650}.conn{font-size:11px;color:#68686d}.progress{display:flex;gap:4px;margin-bottom:14px}
      .dot{height:3px;flex:1;background:#e5e5e5;border-radius:999px}.dot.active{background:#0066cc}.dot.done{background:#1a7f43}
      .eyebrow{font-size:11px;color:#68686d;font-weight:650;text-transform:uppercase;letter-spacing:.06em}.title{font-size:16px;font-weight:650;margin:3px 0 6px}.help{font-size:12px;color:#68686d;line-height:1.5;margin-bottom:12px}
      .notice{padding:9px 10px;border-radius:8px;background:#f5f5f5;color:#1d1d1f;font-size:12px;line-height:1.45;margin-bottom:10px;border-left:2px solid #0066cc}.err{background:#fbeeed;color:#c4291a;border-left-color:#c4291a}
      .success{background:#eaf7ee;color:#1a7f43;border-left-color:#1a7f43}.card{border-top:1px solid rgba(0,0,0,.08);padding-top:10px;margin-top:12px}.card b{display:block;margin-bottom:5px;font-weight:650}
      button,select,input{width:100%;font:13px inherit;border:1px solid rgba(0,0,0,.16);border-radius:8px;background:#fff;padding:9px 10px;color:#1d1d1f;min-height:38px}
      button{cursor:pointer;font-weight:600;text-align:center;transition:background .12s}
      button.primary{background:#0066cc;border-color:#0066cc;color:#fff}
      button.pick{background:#fff;border-color:rgba(0,0,0,.16);color:#0066cc}button.pick:hover{background:#f5f5f5}
      button.ghost{background:transparent;border-color:transparent;color:#68686d}button.ghost:hover{color:#1d1d1f}
      button.danger{background:transparent;border-color:transparent;color:#c4291a}
      .row{display:flex;gap:7px}.row>*{flex:1;min-width:0}.actions{display:flex;gap:7px;margin-top:12px}.actions button{flex:1}
      .small{font-size:11px;color:#68686d;line-height:1.45}.mono{font:11px ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:anywhere}.check{color:#1a7f43;font-weight:650}.label{font-size:11px;font-weight:650;color:#68686d;text-transform:uppercase;letter-spacing:.04em;margin:10px 0 4px}
      .option{display:flex;align-items:flex-start;gap:9px;width:100%;text-align:left;padding:9px 0;border-top:1px solid rgba(0,0,0,.06)}.option:first-child{border-top:0}.option input{width:auto;min-height:auto;margin-top:2px;accent-color:#0066cc}.option strong{display:block;font-weight:600}.option span{font-size:11px;color:#68686d;font-weight:400}
      .crumb{padding:8px 0;border-top:1px solid rgba(0,0,0,.06)}.crumb:first-child{border-top:0}.crumbtext{font-weight:600;margin-bottom:5px;white-space:normal;overflow-wrap:anywhere}.mapped{padding:7px 0;border-top:1px solid rgba(0,0,0,.06);margin-top:5px}.toolbar{display:flex;gap:2px;padding:2px;background:#f5f5f5;border-radius:8px}.toolbar button{font-size:12px;padding:7px;min-height:32px;border:0;background:transparent;color:#68686d;border-radius:6px}.toolbar button.primary{background:#fff;color:#1d1d1f;box-shadow:0 1px 2px rgba(0,0,0,.12)}.pill{display:inline-block;padding:3px 8px;border-radius:999px;background:#f5f5f5;color:#68686d;font-size:10px;margin:2px 3px 2px 0}.footerlink{margin-top:10px;text-align:center;font-size:11px;color:#68686d;cursor:pointer}
    </style>
    <div class="panel">
      <div class="head"><span class="brand">Crawl Builder</span><span class="conn">${connected ? "● Đã kết nối" : "○ Mất kết nối"}</span></div>
      <div class="body">
        <div class="progress">${[1,2,3,4,5,6].map(n => `<div class="dot ${step===n?"active":done(n)?"done":""}"></div>`).join("")}</div>
        <div class="eyebrow">Bước ${step}/6</div>
        <div class="title">${esc(stepTitle())}</div>
        ${error ? `<div class="notice err">${esc(error)}</div>` : ""}
        ${mode !== "idle" ? `<div class="notice">Đang chọn trên website… Rê chuột để thấy vùng highlight rồi click đúng phần tử.</div>` : ""}
        ${renderStep(step, currentTable, cols)}
        ${renderNavigation()}
        <div class="footerlink" data-action="local-ui">Mở Local Tool</div>
      </div>
    </div>`;

    bindUI();
    const panelEl = shadow.querySelector(".panel");
    if (panelEl) panelEl.scrollTop = prevScroll;
  }

  function renderStep(n: number, currentTable: string, cols: SchemaTable["columns"]) {
    if (n === 1) return `
      <div class="help">Click <b>một card mẫu</b>. Tool sẽ tự tìm các card giống nó. Không cần chọn cả danh sách.</div>
      ${recipe.list.item ? `<div class="notice success">✓ Đã nhận diện <b>${recipe.list.itemCount}</b> item giống nhau.</div>` : ""}
      <button class="pick" data-mode="item">${recipe.list.item ? "Chọn lại nhóm item" : "Bắt đầu chọn một item"}</button>
      <div class="small" style="margin-top:8px">Mẹo: click vào vùng trống/khung của card thay vì menu hoặc breadcrumb.</div>`;

    if (n === 2) return `
      <div class="help">Trong một item, click <b>tên, ảnh hoặc nút</b> dẫn tới trang chi tiết.</div>
      ${recipe.list.detailUrlSample ? `<div class="card"><b>Đã chọn</b><div class="mono">${esc(recipe.list.detailUrlSample)}</div></div>` : ""}
      <button class="pick" data-mode="detail-url">${recipe.list.detailUrl ? "Chọn lại link chi tiết" : "Chọn link chi tiết"}</button>`;

    if (n === 3) return `
      <div class="help">Click ảnh đại diện trong card. Tool sẽ tự dò thêm ảnh lớn từ srcset, data-src, link ảnh gốc và OG.</div>
      ${recipe.list.avatar ? `<div class="notice success">✓ Đã chọn ảnh. Tìm thấy ${recipe.list.imageCandidates.length} nguồn ảnh.</div>` : ""}
      ${recipe.list.imageCandidates.length ? `<div class="card"><b>Ảnh có thể dùng</b>${recipe.list.imageCandidates.slice(0,4).map((x,i)=>`<div class="mapped"><span class="check">${i===0?"Đề xuất":"Candidate"}</span> · ${esc(x.source)} ${x.width?`· ${x.width}×${x.height||"?"}`:""}<div class="mono">${esc(x.url)}</div></div>`).join("")}</div>` : ""}
      <button class="pick" data-mode="avatar">${recipe.list.avatar ? "Chọn lại ảnh" : "Chọn ảnh đại diện"}</button>`;

    if (n === 4) {
      const p = recipe.list.pagination;
      return `<div class="help">Nếu trang có các nút 1, 2, 3… hãy click <b>cả cụm phân trang</b>. Nếu không thấy paging, chọn một phương án bên dưới.</div>
        ${p.kind === "url-pattern" ? `<div class="notice success">✓ Đã hiểu phân trang: <span class="mono">${esc(p.pattern)}</span>${p.detectedMax?` · trang 1→${p.detectedMax}`:""}</div>` : p.kind === "none" && p.reason === "single-page" ? `<div class="notice success">✓ Đã đặt website chỉ có một trang.</div>` : ""}
        <button class="pick" data-mode="pagination">Chọn cụm phân trang trên website</button>
        <div class="label">Nếu không có cụm paging</div>
        <button class="ghost" data-action="single-page">Website chỉ có một trang</button>
        <button class="ghost" style="margin-top:7px" data-action="toggle-page2">Tôi biết website có nhiều trang</button>
        ${showPage2Input ? `<div class="card"><div class="label" style="margin-top:0">Dán URL trang 2</div><input data-bind="page2" placeholder="https://domain.com/...page=2"><button class="primary" style="margin-top:7px" data-action="infer-page2">Tự nhận dạng phân trang</button></div>` : ""}`;
    }

    if (n === 5) {
      const onList = location.pathname === recipe.source.listPath;
      return `<div class="help">Map breadcrumb/category và các cột SQL bằng cách chọn cột trước, sau đó click dữ liệu trên website. Phần lớn nên làm trên <b>trang chi tiết</b> — nhưng nếu 1 dữ liệu (VD mô tả ngắn) chỉ có ở <b>trang danh sách</b>, không lặp lại ở trang chi tiết, cứ map ngay tại đây: tool tự nhận và lấy đúng theo từng mục khi crawl.</div>
        ${onList && recipe.list.detailUrlSample ? `<button class="primary" data-action="open-detail">Mở trang chi tiết mẫu →</button>` : ""}
        ${onList ? `<div class="notice">Đang ở trang danh sách — dữ liệu bạn map bên dưới sẽ lấy theo từng mục (click phải nằm trong 1 item).</div>` : `<div class="notice success">✓ Đang ở trang chi tiết. SEO đã được đọc tự động.</div>`}

        <div class="card"><b>Chuyển sang mục mẫu khác</b>
          <div class="small">Mục này thiếu trường nào so với mục khác? Bấm nút này để Tool tự mở một mục khác trong cùng danh sách — map tiếp ở đó, dữ liệu sẽ cộng dồn vào đúng Recipe này, không tạo recipe mới.${sampleIndex >= 0 && sampleUrls.length ? ` (Mẫu ${sampleIndex+1}/${sampleUrls.length})` : ""}</div>
          <button class="pick" style="margin-top:7px" data-action="next-sample" ${sampleBusy?"disabled":""}>${sampleBusy ? "Đang tìm…" : "→ Mục mẫu khác"}</button>
        </div>

        <div class="card"><b>Category / Breadcrumb</b>
          <div class="small">Click một lần vào cả cụm breadcrumb, ví dụ: Trang chủ › Sản phẩm › Máy lọc nước.</div>
          <button class="pick" style="margin-top:7px" data-mode="breadcrumb">${recipe.list.breadcrumb.length ? "Chọn lại breadcrumb" : "Chọn breadcrumb"}</button>
          ${recipe.list.breadcrumb.length ? `<div style="margin-top:6px">${recipe.list.breadcrumb.map((x,i)=>renderCrumb(x,i)).join("")}</div>` : ""}
        </div>

        <div class="card"><b>Gallery nhiều ảnh</b>
          <div class="small">Click vào một ảnh trong dải ảnh (thumbnail). Hệ thống tự tìm các ảnh còn lại cùng nhóm.</div>
          <button class="pick" style="margin-top:7px" data-mode="gallery">${recipe.detail.gallery ? "Chọn lại gallery" : "Chọn gallery ảnh"}</button>
          ${recipe.detail.gallery ? `<div class="mapped" style="margin-top:6px"><span class="check">✓ Phát hiện ${recipe.detail.galleryCount} ảnh cùng nhóm</span></div>` : ""}
        </div>

        <div class="card"><b>Map field SQL</b>
          ${(() => { const allowed = mainTable ? [mainTable, ...relatedTables] : []; const options = allowed.length ? schemaTables.filter(t => allowed.includes(t.name)) : schemaTables; return `<div class="label">Bảng đích</div><select data-bind="table">${options.map(t=>`<option value="${esc(t.name)}" ${t.name===currentTable?"selected":""}>${esc(t.name)}</option>`).join("")}</select>`; })()}
          <div class="label">Cột cần lấy dữ liệu</div>
          <select data-bind="column"><option value="">— Chọn cột —</option>${cols.map(c=>`<option value="${esc(c.name)}" ${c.name===targetColumn?"selected":""}>${esc(c.name)}</option>`).join("")}</select>
          <div class="label">Nút "Xem thêm" trước khi lấy (nếu nội dung bị ẩn, tùy chọn)</div>
          <div class="small">Một số web chỉ hiện đủ nội dung sau khi bấm "Xem thêm"/"Đọc thêm". Chọn nút đó ở đây, tool sẽ tự bấm trước khi lấy dữ liệu.</div>
          <button class="pick" style="margin-top:7px" data-mode="click-target">${pendingClickSelector ? "✓ Đã chọn — chọn lại" : "Chọn nút mở rộng nội dung"}</button>
          ${pendingClickSelector ? `<button class="ghost" style="margin-top:7px;margin-left:6px" data-action="clear-click-target">Bỏ chọn</button>` : ""}
          <div class="label">Cách lấy</div>
          <div class="toolbar">
            <button data-extraction="text" class="${extraction==="text"?"primary":"ghost"}">Text</button>
            <button data-extraction="html" class="${extraction==="html"?"primary":"ghost"}">HTML</button>
            <button data-extraction="range" class="${extraction==="range"?"primary":"ghost"}">Vùng dữ liệu</button>
          </div>
          ${extraction === "range" ? `
            <div class="small" style="margin-top:6px">Dùng khi dữ liệu KHÔNG nằm gọn trong 1 khối/class bao quanh. Chọn 2 <b>mốc tham chiếu</b> (2 phần tử phải là anh em cùng cấp cha) — chỉ cần chúng lặp lại ổn định qua các bài, không cần là chính dữ liệu cần lấy. Tool sẽ lấy phần <b>NẰM GIỮA</b> 2 mốc — bản thân 2 mốc KHÔNG bị lấy vào dữ liệu.</div>
            <div class="row" style="margin-top:7px">
              <button class="pick" data-mode="range-start">${rangeStartEl ? "✓ Đã chọn mốc trên" : "1. Chọn mốc trên"}</button>
              <button class="pick" data-mode="range-end" ${!rangeStartEl ? "disabled" : ""}>${rangeEndEl ? "✓ Đã chọn mốc dưới" : "2. Chọn mốc dưới"}</button>
            </div>
            ${rangeStartEl && rangeEndEl ? `<div class="row" style="margin-top:7px"><button class="primary" data-action="save-range">Lưu vùng này</button><button class="ghost" data-action="clear-range">Chọn lại</button></div>` : ""}
          ` : `<button class="pick" style="margin-top:8px" data-mode="field">Chọn dữ liệu trên website</button>
            ${lastFieldEl && lastFieldTable===targetTable && lastFieldColumn===targetColumn ? `<div class="small" style="margin-top:6px">Click trúng bị hẹp hơn cả khung bao (VD dính vào 1 đoạn &lt;p&gt; con)? Bấm nút dưới để nới ra khung cha, xem preview bên dưới to dần tới khi đủ.</div><button class="ghost" style="margin-top:6px" data-action="widen-field">↑ Mở rộng lên cấp cha</button>` : ""}`}
          <div class="small" style="margin-top:7px">Đã map ${recipe.detail.fields.filter(f=>f.source==="dom").length} field từ trang này. Giá trị cố định / ngày giờ tự động: cấu hình ở Local Tool (Bước 3, mục "Giá trị mặc định cho cột"), không làm ở đây nữa.</div>
          ${recipe.detail.fields.filter(f=>f.source==="dom").slice().reverse().slice(0,8).map(f=>`<div class="mapped"><span class="check">✓ ${esc(f.targetColumn)}</span> ← ${esc(f.extraction)}${f.scope==="list"?' <span class="pill">danh sách</span>':""}<div class="small">${esc((f.sampleValue||"").slice(0,90))}</div><button class="danger" data-delete-field="${esc(f.id)}" style="margin-top:5px;min-height:28px;padding:4px 7px;font-size:11px">Xóa field này</button></div>`).join("")}
          <div class="notice" style="margin-top:9px">Mục này thiếu trường nào so với mục khác? Cứ <b>mở một mục KHÁC</b> trên cùng website có trường đó rồi map tiếp — Tool tự nhận đúng Recipe này theo tên miền, dữ liệu map thêm sẽ cộng dồn vào cùng cấu hình, không tạo recipe mới.</div>
        </div>
        <div class="card"><b>SEO</b><div class="small">SEO tự đọc, không cần click.</div>${recipe.seo.sample?.title ? `<div class="mapped"><span class="check">✓ ${esc(recipe.seo.sample.title)}</span><div class="small">${esc(recipe.seo.sample.description||"Không có meta description")}</div></div>` : `<div class="small">Chưa đọc được SEO trên trang này.</div>`}</div>`;
    }

    const p = recipe.list.pagination;
    return `<div class="help">Kiểm tra nhanh trước khi lưu. Có thể quay lại bất kỳ bước nào để chọn lại.</div>
      <div class="card">
        ${summaryLine("Nhóm item", recipe.list.item ? `${recipe.list.itemCount} item` : "Chưa chọn", !!recipe.list.item)}
        ${summaryLine("Link chi tiết", recipe.list.detailUrl ? "Đã chọn" : "Chưa chọn", !!recipe.list.detailUrl)}
        ${summaryLine("Ảnh đại diện", recipe.list.avatar ? `${recipe.list.imageCandidates.length} candidate` : "Chưa chọn", !!recipe.list.avatar)}
        ${summaryLine("Phân trang", p.kind === "url-pattern" ? p.pattern : p.kind === "none" && p.reason === "single-page" ? "Một trang" : "Chưa xác nhận", p.kind !== "none" || p.reason === "single-page")}
        ${summaryLine("Breadcrumb", recipe.list.breadcrumb.length ? `${recipe.list.breadcrumb.length} cấp` : "Chưa chọn / không dùng", true)}
        ${summaryLine("Gallery", recipe.detail.gallery ? `${recipe.detail.galleryCount} ảnh` : "Chưa chọn / không dùng", true)}
        ${summaryLine("Detail fields", `${recipe.detail.fields.length} field`, recipe.detail.fields.length > 0)}
        ${summaryLine("SEO", recipe.seo.sample?.title ? "Đã đọc" : "Chưa có", !!recipe.seo.sample?.title)}
      </div>
      <button class="primary" data-action="save-final">Lưu Recipe</button>
      <button class="ghost" style="margin-top:7px" data-action="reload">Load lại Recipe đã lưu</button>`;
  }

  function renderCrumb(x: BreadcrumbLevel, i: number) {
    const value = x.ignored || !x.targetTable || !x.targetColumn ? "" : `${x.targetTable}::${x.targetColumn}`;
    const allowed = relatedTables.filter(t => t !== mainTable);
    const options = allowed.length ? schemaTables.filter(t => allowed.includes(t.name)) : schemaTables.filter(t => t.name !== mainTable);
    return `<div class="crumb"><div class="crumbtext">${i+1}. ${esc(x.text)}</div>
      <select data-crumb-target="${i}">
        <option value="" ${!value?"selected":""}>Bỏ qua cấp này</option>
        ${options.flatMap(t => t.columns.map(c => `<option value="${esc(t.name)}::${esc(c.name)}" ${value===`${t.name}::${c.name}`?"selected":""}>${esc(t.name)} → ${esc(c.name)}</option>`)).join("")}
      </select></div>`;
  }

  function summaryLine(label: string, value: string, ok: boolean) {
    return `<div class="mapped"><b style="display:inline">${ok?"✓":"○"} ${esc(label)}</b><span class="small" style="float:right">${esc(value)}</span></div>`;
  }

  function renderNavigation() {
    if (step === 6) return `<div class="actions"><button class="ghost" data-action="prev">← Quay lại</button></div>`;
    return `<div class="actions">${step>1?`<button class="ghost" data-action="prev">← Quay lại</button>`:""}<button class="primary" data-action="next">Tiếp tục →</button></div>`;
  }

  function bindUI() {
    shadow.querySelectorAll<HTMLButtonElement>("button[data-mode]").forEach(b => b.onclick = () => {
      mode = b.dataset.mode as Mode; error = ""; render();
    });
    shadow.querySelectorAll<HTMLElement>("[data-action]").forEach(el => el.onclick = e => {
      e.preventDefault(); void action(el.dataset.action || "");
    });
    shadow.querySelector<HTMLSelectElement>('select[data-bind="table"]')?.addEventListener("change", e => {
      targetTable = (e.target as HTMLSelectElement).value;
      targetColumn = schemaTables.find(t => t.name === targetTable)?.columns[0]?.name || ""; render();
    });
    shadow.querySelector<HTMLSelectElement>('select[data-bind="column"]')?.addEventListener("change", e => {
      targetColumn = (e.target as HTMLSelectElement).value;
    });
    shadow.querySelectorAll<HTMLButtonElement>("button[data-extraction]").forEach(b => b.onclick = () => {
      extraction = b.dataset.extraction as RecipeField["extraction"]; render();
    });
    shadow.querySelectorAll<HTMLSelectElement>("select[data-crumb-target]").forEach(el => el.onchange = () => {
      const i = Number(el.dataset.crumbTarget); const c = recipe.list.breadcrumb[i]; if (!c) return;
      if (!el.value) { c.ignored = true; c.targetTable = null; c.targetColumn = null; }
      else { const [table, column] = el.value.split("::"); c.ignored = false; c.targetTable = table ?? null; c.targetColumn = column ?? null; }
      void save(false);
    });
    shadow.querySelectorAll<HTMLButtonElement>("button[data-delete-field]").forEach(b => b.onclick = () => {
      recipe.detail.fields = recipe.detail.fields.filter(f => f.id !== b.dataset.deleteField); void save(false); render();
    });
  }

  async function action(a: string) {
    error = "";
    if (a === "prev") { mode = "idle"; hide(); step = Math.max(1, step - 1); render(); return; }
    if (a === "next") { mode = "idle"; hide(); step = Math.min(6, step + 1); render(); return; }
    if (a === "local-ui") { window.open(LOCAL_UI, "_blank", "noopener,noreferrer"); return; }
    if (a === "reload") { await sync(); return; }
    if (a === "toggle-page2") { showPage2Input = !showPage2Input; render(); return; }
    if (a === "single-page") { recipe.list.pagination = { kind: "none", reason: "single-page", page2Url: null }; await save(false); render(); return; }
    if (a === "infer-page2") {
      const input = shadow.querySelector<HTMLInputElement>('input[data-bind="page2"]');
      const page2 = input?.value.trim() || "";
      if (!page2) { error = "Hãy dán URL của trang 2."; render(); return; }
      try { recipe.list.pagination = inferPagination([recipe.source.startUrl, page2], null); await save(false); render(); }
      catch { error = "Không đọc được URL trang 2."; render(); }
      return;
    }
    if (a === "clear-click-target") { pendingClickSelector = null; render(); return; }
    if (a === "clear-range") { rangeStartEl = null; rangeEndEl = null; render(); return; }
    if (a === "save-range") {
      if (!rangeStartEl || !rangeEndEl) { error = "Hãy chọn đủ mốc trên và mốc dưới."; render(); return; }
      if (!targetTable || !targetColumn) { error = "Hãy chọn cột SQL trước."; render(); return; }
      // The two clicks can land in either visual order — normalize so "start" is always whichever one
      // actually comes first in document order, or the sibling-walk below would silently return nothing.
      const forward = !!(rangeStartEl.compareDocumentPosition(rangeEndEl) & Node.DOCUMENT_POSITION_FOLLOWING);
      const first = forward ? rangeStartEl : rangeEndEl, last = forward ? rangeEndEl : rangeStartEl;
      const f: RecipeField = {
        id: uuid(), targetTable, targetColumn, source: "dom", extraction: "range",
        attribute: null, selector: null, sampleValue: rangeHtmlPreview(first, last),
        rangeSelector: { start: strategy(first, "document"), end: strategy(last, "document") }
      };
      recipe.detail.fields = recipe.detail.fields.filter(x => !(x.targetTable === targetTable && x.targetColumn === targetColumn)).concat(f);
      rangeStartEl = null; rangeEndEl = null;
      await save(false); render(); return;
    }
    if (a === "widen-field") {
      if (!lastFieldEl) { error = "Chưa có field nào để mở rộng — hãy chọn dữ liệu trên website trước."; render(); return; }
      const parent = lastFieldEl.parentElement;
      if (!parent || parent === document.body || parent === document.documentElement) { error = "Đã tới giới hạn, không thể mở rộng thêm."; render(); return; }
      if (lastFieldItemEl && lastFieldEl === lastFieldItemEl) { error = "Đã tới đúng ranh giới của 1 item — mở rộng thêm sẽ lấy sang item khác, không hợp lý."; render(); return; }
      // Re-target the dropdowns to whatever column this field actually is, in case they were changed
      // in between picks — applyFieldPick always saves into the live targetTable/targetColumn, and a
      // stale selection here would otherwise silently widen the wrong column's field.
      targetTable = lastFieldTable; targetColumn = lastFieldColumn;
      const onListNow = location.pathname === recipe.source.listPath;
      applyFieldPick(parent, lastFieldItemEl, onListNow);
      await save(false); render(); return;
    }
    if (a === "open-detail") { if (recipe.list.detailUrlSample) location.href = recipe.list.detailUrlSample; return; }
    if (a === "save-final") { recipe.seo.sample = extractSeo(); await save(true); return; }
    if (a === "next-sample") {
      sampleBusy = true; render();
      try {
        if (!sampleUrls.length) sampleUrls = await fetchSampleUrls(recipe);
        if (sampleUrls.length < 2) { error = "Không tìm thấy đủ mục khác trên trang danh sách để chuyển qua."; sampleBusy = false; render(); return; }
        // Every click navigates the page, which re-runs this whole content script from scratch — any
        // remembered "current index" variable is wiped by that reload before the next click ever sees
        // it, so counting from a remembered index always restarted from the same spot and bounced
        // between just the first couple of URLs. Deriving the position from the page's OWN current URL
        // instead survives the reload for free: wherever the browser actually is IS the position.
        const current = location.href.split("#")[0] ?? location.href;
        const pos = sampleUrls.indexOf(current);
        sampleIndex = (pos + 1) % sampleUrls.length;
        location.href = sampleUrls[sampleIndex]!;
      } catch (e) { error = e instanceof Error ? e.message : "Không lấy được danh sách mục mẫu."; sampleBusy = false; render(); }
      return;
    }
  }

  document.addEventListener("mousemove", e => {
    if (mode === "idle" || e.composedPath().includes(host)) return;
    const t = e.target; if (t instanceof Element && t !== highlighter) show(t);
  }, true);

  document.addEventListener("click", e => {
    if (mode === "idle" || e.composedPath().includes(host)) return;
    const t = e.target; if (!(t instanceof Element)) return;
    e.preventDefault(); e.stopImmediatePropagation(); void select(t);
  }, true);

  function applyFieldPick(el: Element, itemEl: Element | null, onListNow: boolean) {
    const value = extraction === "html" ? (el as HTMLElement).innerHTML : clean(el.textContent || "");
    const f: RecipeField = {
      id: uuid(), targetTable, targetColumn, source: "dom", extraction,
      attribute: null,
      selector: strategy(el, itemEl ? "item" : "document", itemEl), sampleValue: value,
      clickBeforeExtract: pendingClickSelector,
      scope: onListNow ? "list" : "detail"
    };
    recipe.detail.fields = recipe.detail.fields.filter(x => !(x.targetTable === targetTable && x.targetColumn === targetColumn)).concat(f);
    lastFieldEl = el; lastFieldItemEl = itemEl; lastFieldTable = targetTable; lastFieldColumn = targetColumn;
  }

  async function select(target: Element) {
    error = "";
    try {
      if (mode === "item") {
        const found = detectRepeated(target);
        if (!found) throw new Error("Không nhận diện được nhóm lặp. Hãy click vào chính card sản phẩm/bài viết.");
        recipe.list.item = found.selector; recipe.list.itemCount = found.count; step = 2;
      } else if (mode === "detail-url") {
        const a = resolveLink(target);
        if (!a) throw new Error("Không thấy link. Hãy click tên, ảnh hoặc nút đi tới trang chi tiết.");
        const itemEl = closestItem(a, recipe.list.item?.primary);
        recipe.list.detailUrl = strategy(a, itemEl ? "item" : "document", itemEl);
        recipe.list.detailUrlSample = new URL(a.href, location.href).href; step = 3;
      } else if (mode === "avatar") {
        const img = resolveImageElement(target);
        if (!img) throw new Error("Không thấy ảnh tại vùng đã chọn.");
        const itemEl = closestItem(img, recipe.list.item?.primary);
        recipe.list.avatar = strategy(img, itemEl ? "item" : "document", itemEl);
        recipe.list.imageCandidates = imageCandidates(img); step = 4;
      } else if (mode === "gallery") {
        const found = detectRepeated(target);
        if (!found) throw new Error("Không nhận diện được nhóm ảnh lặp lại. Hãy click vào một ảnh trong dải ảnh.");
        recipe.detail.gallery = found.selector; recipe.detail.galleryCount = found.count;
      } else if (mode === "breadcrumb") {
        recipe.list.breadcrumb = breadcrumbLevels(target);
        if (!recipe.list.breadcrumb.length) throw new Error("Không đọc được breadcrumb. Hãy click cả cụm breadcrumb.");
      } else if (mode === "pagination") {
        const container = bestPaginationContainer(target);
        const urls = [...container.querySelectorAll<HTMLAnchorElement>("a[href]")].map(a => new URL(a.href, location.href).href);
        if (urls.length < 2) throw new Error("Cụm này chưa có đủ link phân trang. Hãy click cả cụm số trang.");
        recipe.list.pagination = inferPagination(urls, strategy(container, "document"));
        if (recipe.list.pagination.kind === "none") throw new Error("Đã thấy link nhưng chưa suy ra được quy luật trang. Dùng lựa chọn URL trang 2 bên dưới.");
      } else if (mode === "click-target") {
        pendingClickSelector = strategy(target, "document");
      } else if (mode === "field") {
        if (!targetTable || !targetColumn) throw new Error("Hãy chọn cột SQL trước.");
        // On the list page, a field only makes sense scoped to whichever item card it was clicked
        // inside — the same way avatar/detailUrl are already scoped — so it can be re-found per item
        // during list discovery (see RecipeField.scope / discover() in crawl.ts). Off the list page
        // (the normal, detail-page case) this is unchanged: a plain document-scoped selector.
        const onListNow = location.pathname === recipe.source.listPath;
        const itemEl = onListNow ? closestItem(target, recipe.list.item?.primary) : null;
        if (onListNow && !itemEl) throw new Error("Đang ở trang danh sách — hãy click vào dữ liệu NẰM TRONG 1 item, không click ở ngoài.");
        applyFieldPick(target, itemEl, onListNow);
      } else if (mode === "range-start") {
        rangeStartEl = target; rangeEndEl = null;
      } else if (mode === "range-end") {
        if (!rangeStartEl) throw new Error("Hãy chọn mốc trên trước.");
        if (target === rangeStartEl) throw new Error("Mốc dưới phải khác mốc trên — hãy chọn 1 điểm khác.");
        rangeEndEl = target;
      }
      // Picking a range endpoint only records a live element reference for the picker's own use — it
      // isn't a Recipe field yet (that only happens on "save-range", once both ends are chosen), so
      // there's nothing to persist to the server here the way every other mode's pick has.
      if (mode === "range-start" || mode === "range-end") { mode = "idle"; hide(); render(); return; }
      mode = "idle"; hide(); recipe.seo.sample = extractSeo(); await save(false); render();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e); mode = "idle"; hide(); render();
    }
  }

  async function local<T>(path: string, method: "GET"|"POST"|"PUT"|"DELETE" = "GET", body?: unknown): Promise<LocalResponse<T>> {
    try { return await chrome.runtime.sendMessage({ type: "LOCAL_FETCH", path, method, body }) as LocalResponse<T>; }
    catch (e) { return { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) }; }
  }

  async function save(showMessage = false) {
    recipe.updatedAt = new Date().toISOString();
    const r = await local<{ok:boolean;recipe:CrawlRecipe}>("/api/recipes", "POST", recipe);
    // status 0 means the request never reached the server at all (background.ts's fetch threw) — that's
    // the only case that's actually "mất kết nối". Any real HTTP response (200 or a validation 400)
    // means the connection is fine; treating a 400 as "disconnected" hid the real error behind a
    // misleading status flip instead of showing what the server actually said was wrong.
    connected = r.status !== 0;
    if (r.ok && r.data?.recipe) { recipe = r.data.recipe; if (showMessage) error = ""; }
    else error = r.error || "Không lưu được Recipe.";
    render();
  }

  async function sync() {
    const st = await local<Phase0State>("/api/state"); connected = st.status !== 0;
    if (st.ok && st.data?.database) {
      schemaTables = st.data.database.schema.tables; mainTable = st.data.database.config.mainTable || "";
      relatedTables = st.data.database.config.relatedTables || [];
      targetTable = targetTable || mainTable || schemaTables[0]?.name || "";
      targetColumn = targetColumn || schemaTables.find(t => t.name === targetTable)?.columns[0]?.name || "";
    }
    const rr = await local<{ok:boolean;recipe:CrawlRecipe|null}>(`/api/recipes/activate?url=${encodeURIComponent(location.href)}`);
    if (rr.ok && rr.data?.recipe) recipe = rr.data.recipe;
    recipe.seo.sample = extractSeo();
    // Nếu đang ở trang detail, đi thẳng tới bước mapping để người dùng không phải bấm lại 4 bước list.
    if (location.pathname !== recipe.source.listPath && recipe.list.detailUrl) step = 5;
    render();
  }

  function show(el: Element) {
    const r = el.getBoundingClientRect();
    Object.assign(highlighter.style, { display: "block", left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  }
  function hide() { highlighter.style.display = "none"; }
  void sync();
}

// A file:// page has no hostname at all (location.hostname is ""), which the server's Recipe
// validation rejects outright (falsy hostname). The stand-in has to be the *folder*, not the full file
// path — an offline mirror of a site is a folder of pages (list.html, product-a.html, product-b.html),
// and using the full path per file would make every single page its own "site", so navigating from the
// list page to a detail page inside the very same folder would never find the recipe just saved for
// it. findRecipeForUrl on the server mirrors this exact fallback so activation lookups agree.
function siteHostname(): string { return location.hostname || `local-file:${location.pathname.replace(/\/[^/]*$/, "")}`; }
function clean(s: string) { return s.replace(/\s+/g, " ").trim(); }
function cssEsc(s: string) { return CSS.escape(s); }
// `generalize` skips both the id-shortcut and the nth-child disambiguation, producing a selector
// that matches every sibling with the same tag/classes instead of pinning to one instance. This is
// required for the repeated-item container itself (it must match all cards, not just the first) —
// see detectRepeated(), which is the only caller that passes generalize=true.
// Classes that common lazy-load/UI-state libraries toggle at runtime (e.g. lazysizes-style
// "loading" -> "loaded" on scroll/intersection). A selector pinned to one of these only matches
// once a browser has actually rendered/scrolled the element into view — which a crawler visiting
// pages headlessly and reading the DOM immediately after domcontentloaded usually hasn't done, so
// the selector silently matches nothing on every future crawl even though the element is right
// there. Filtered out so the selector falls back to the element's other, structural classes.
const VOLATILE_CLASS = /^(loaded|loading|lazyloaded|lazyload|active|hover(ed)?|selected|open|closed|visible|hidden|error|disabled|checked|focus(ed)?|current|in-view|is-visible|is-active|is-loaded)$/i;
function simpleSelector(el: Element, generalize = false) {
  if (el.id && !generalize) return `#${cssEsc(el.id)}`;
  const stable = [...el.classList].filter(c => c.length < 48 && !/[0-9a-f]{8,}/i.test(c) && !VOLATILE_CLASS.test(c)).slice(0, 3);
  let s = el.tagName.toLowerCase() + stable.map(c => `.${cssEsc(c)}`).join("");
  if (generalize) return s;
  const parent = el.parentElement;
  if (parent && parent.querySelectorAll(`:scope > ${s}`).length > 1) {
    const ix = [...parent.children].indexOf(el) + 1; s += `:nth-child(${ix})`;
  }
  return s;
}
// `stop` bounds the walk (used to scope a selector to inside one repeated item, see select() below).
// `generalizeTarget` generalizes only the first (deepest) segment — the element being described —
// while ancestors above it still get normal disambiguation for correct page-section scoping.
function selectorFor(el: Element, stop?: Element|null, generalizeTarget = false) {
  const parts: string[] = []; let cur: Element|null = el; let isTarget = true;
  while (cur && cur !== stop && parts.length < 6) {
    const generalizeThis = generalizeTarget && isTarget;
    parts.unshift(simpleSelector(cur, generalizeThis));
    if (cur.id && !generalizeThis) break;
    isTarget = false; cur = cur.parentElement;
  }
  return parts.join(" > ");
}
function xpathFor(el: Element) {
  const parts: string[] = []; let cur: Element|null = el;
  while (cur && cur.nodeType === 1 && parts.length < 8) {
    const tag = cur.tagName.toLowerCase();
    const sib = cur.parentElement ? [...cur.parentElement.children].filter(x => x.tagName === cur!.tagName) : [];
    parts.unshift(`${tag}${sib.length > 1 ? `[${sib.indexOf(cur)+1}]` : ""}`); cur = cur.parentElement;
  }
  return "/" + parts.join("/");
}
function strategy(el: Element, relativeTo: "document"|"item", stop?: Element|null, generalizeTarget = false): SelectorStrategy {
  const attrs: Record<string,string> = {};
  for (const k of ["itemprop","role","name","type","aria-label","data-testid"]) { const v = el.getAttribute(k); if (v) attrs[k] = v; }
  return {
    primary: selectorFor(el, stop, generalizeTarget),
    fallback: [el.tagName.toLowerCase(), ...Object.entries(attrs).map(([k,v]) => `${el.tagName.toLowerCase()}[${k}="${CSS.escape(v)}"]`)].filter((v,i,a)=>a.indexOf(v)===i).slice(0,4),
    xpath: xpathFor(el), relativeTo, stableAttributes: attrs,
    fingerprint: { tag: el.tagName.toLowerCase(), classes: [...el.classList].slice(0,6), childTags: [...el.children].slice(0,12).map(c=>c.tagName.toLowerCase()), depth: depth(el), textHint: clean(el.textContent||"").slice(0,80)||null }
  };
}
function depth(el: Element) { let n=0,c:Element|null=el; while(c?.parentElement){n++;c=c.parentElement;} return n; }
function signature(el: Element) { return `${el.tagName}|${[...el.children].map(c=>c.tagName).join(",")}|a${el.querySelectorAll("a[href]").length}|i${el.querySelectorAll("img").length}`; }
function detectRepeated(clicked: Element) {
  let cur: Element|null = clicked; let best:{selector:SelectorStrategy;count:number;score:number}|null=null;
  for(let level=0;cur&&cur!==document.body&&level<7;level++,cur=cur.parentElement){
    const p=cur.parentElement;if(!p)continue;const sig=signature(cur);const peers=[...p.children].filter(x=>signature(x)===sig);
    const text=clean(cur.textContent||"");const links=cur.querySelectorAll("a[href]").length;const imgs=cur.querySelectorAll("img").length;
    const navPenalty=cur.closest("header,nav,footer,aside")?8:0;const score=peers.length*2+Math.min(links,2)+Math.min(imgs,2)+(text.length>20?1:0)-navPenalty;
    if(peers.length>=2&&score>(best?.score??-999))best={selector:strategy(cur,"document",null,true),count:peers.length,score};
  }
  return best;
}
// Finds the ancestor (or self) matching the saved repeated-item selector, so a field picked inside
// a card (detail link, avatar) gets a selector scoped to that card — not an absolute page path that
// would only ever match the specific card it was recorded from.
function closestItem(el: Element, itemSelector: string|null|undefined): Element|null {
  if (!itemSelector) return null;
  try { return el.closest(itemSelector); } catch { return null; }
}
// A raw click almost never lands exactly on the two block-level elements the operator means — it lands
// on whatever leaf happens to be under the pointer (a <p>, a <span> of text inside it), often several
// levels deeper than the actual "block" they're pointing at. Requiring the two clicks to already be
// Preview only — the real crawl-time extraction uses the same DOM Range approach server-side (see
// extractRange in crawl.ts) so the saved sample always matches what a real crawl will actually produce.
// The two picked elements are landmarks, not content — chosen because they repeat reliably across
// every article, not because they belong to the data itself. They do NOT need to be siblings: the
// native Range API captures everything strictly BETWEEN them in document order regardless of nesting
// depth (e.g. start can be a top-level section and end a node nested deep inside a later section), and
// setStartAfter/setEndBefore excludes both landmarks themselves from what's actually captured.
function rangeHtmlPreview(start: Element, end: Element): string {
  try {
    const r = document.createRange();
    r.setStartAfter(start);
    r.setEndBefore(end);
    const div = document.createElement("div");
    div.appendChild(r.cloneContents());
    return clean(div.innerHTML).slice(0, 300);
  } catch {
    return "";
  }
}
function resolveLink(el: Element){return el.closest("a[href]") as HTMLAnchorElement|null || el.querySelector("a[href]") as HTMLAnchorElement|null;}
function resolveImageElement(el: Element){return el.closest("img") as HTMLImageElement|null || el.querySelector("img") as HTMLImageElement|null;}
function imageCandidates(img: HTMLImageElement): ImageCandidate[] {
  const out: ImageCandidate[]=[];
  const add=(url:string|null|undefined,source:ImageCandidate["source"],w:number|null=null,h:number|null=null)=>{if(!url)return;try{const abs=new URL(url,location.href).href;if(!out.some(x=>x.url===abs))out.push({url:abs,source,width:w,height:h,score:(w||0)*(h||0)+(source==="parent-link"?500000:0)});}catch{}};
  add(img.currentSrc||img.src,"src",img.naturalWidth||null,img.naturalHeight||null);add(img.getAttribute("data-src"),"data-src");add(img.getAttribute("data-original"),"data-original");
  for(const part of (img.getAttribute("srcset")||"").split(",")){const [u,desc]=part.trim().split(/\s+/);if(u)add(u,"srcset",desc?.endsWith("w")?Number(desc.slice(0,-1)):null,null);}
  const pic=img.closest("picture");pic?.querySelectorAll("source[srcset]").forEach(s=>{const [u]=((s as HTMLSourceElement).srcset||"").split(",").pop()!.trim().split(/\s+/);add(u,"picture");});
  const pa=img.closest("a[href]") as HTMLAnchorElement|null;if(pa&&/\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(pa.href))add(pa.href,"parent-link");
  add(document.querySelector<HTMLMetaElement>('meta[property="og:image"]')?.content||null,"og:image");return out.sort((a,b)=>b.score-a.score);
}
function breadcrumbLevels(target: Element): BreadcrumbLevel[] {
  const root=target.closest('nav,[aria-label*="breadcrumb" i],.breadcrumb,.breadcrumbs')||target;
  const nodes=[...root.querySelectorAll("a,span,li")].filter(x=>clean(x.textContent||"").length>0&&clean(x.textContent||"").length<120);
  const uniq=nodes.filter((x,i)=>!nodes.some((y,j)=>j<i&&clean(y.textContent||"")===clean(x.textContent||"")));
  return uniq.slice(0,8).map((el,index)=>({index,text:clean(el.textContent||""),selector:strategy(el,"document"),targetTable:null,targetColumn:null,ignored:index===0}));
}
function bestPaginationContainer(t: Element){return t.closest('nav,.pagination,.paging,.pager,[class*="page"]')||t.parentElement||t;}
// Lets a person mapping a detail page jump straight to a DIFFERENT sample product without leaving the
// panel — needed because real catalogs are inconsistent (one product has a spec table, another
// doesn't), so a single sample page never has every column. Re-derives the list-page's detail links
// using the exact selectors already saved on the recipe (same ones the server crawler itself uses),
// so "another sample" always means "a real product from this recipe's own list", not a guess.
async function fetchSampleUrls(recipe: CrawlRecipe): Promise<string[]> {
  const itemSel = recipe.list.item, linkSel = recipe.list.detailUrl;
  if (!itemSel || !linkSel) return [];
  const listUrl = new URL(recipe.source.startUrl, location.href).href;
  const sameDoc = new URL(listUrl).hostname === location.hostname && new URL(listUrl).pathname === location.pathname;
  let doc: Document;
  if (sameDoc) doc = document;
  else {
    // Fetched via the background service worker, not a direct fetch() here — a content script's own
    // fetch to file:// fails outright ("Failed to fetch"), and this same relay works unchanged for a
    // normal http(s) list page too.
    const r = await chrome.runtime.sendMessage({ type: "FETCH_TEXT", url: listUrl }) as LocalResponse<string>;
    if (!r.ok || !r.data) throw new Error(r.error || "Không tải được trang danh sách để tìm mục khác.");
    doc = new DOMParser().parseFromString(r.data, "text/html");
  }
  let items: Element[] = [];
  for (const sel of [itemSel.primary, ...itemSel.fallback]) { try { const found = [...doc.querySelectorAll(sel)]; if (found.length) { items = found; break; } } catch {} }
  const urls: string[] = [];
  for (const item of items) {
    for (const sel of [linkSel.primary, ...linkSel.fallback]) {
      try {
        const a = item.querySelector<HTMLAnchorElement>(sel);
        const href = a?.getAttribute("href");
        if (href) { urls.push(new URL(href, listUrl).href); break; }
      } catch {}
    }
  }
  return [...new Set(urls)];
}
function inferPagination(urls:string[],container:SelectorStrategy|null):PaginationRecipe{
  const parsed=urls.map(u=>new URL(u,location.href));
  // Path-based numbering is checked FIRST, ahead of a numeric query parameter — a changing filename
  // (page-2.html, page-3.html) is what actually serves different content on plenty of sites (static
  // mirrors especially), whereas a numeric query key can vary for reasons that have nothing to do with
  // pagination (tracking, an anchor id) while every link keeps pointing at the very same page. Checking
  // query params first meant a page whose links vary BOTH ways picked the query pattern even when it
  // was the wrong one — every generated "page" resolved to the exact same file.
  const pathNums=parsed.map(u=>u.pathname.match(/(\d+)(?!.*\d)/)?.[1]).filter((x):x is string=>!!x);
  if(pathNums.length>=2&&new Set(pathNums).size>=2){const first=parsed.find(u=>/(\d+)(?!.*\d)/.test(u.pathname))!;return{kind:"url-pattern",container,pattern:first.pathname.replace(/(\d+)(?!.*\d)/,"{page}")+first.search,start:1,detectedMax:Math.max(...pathNums.map(Number)),sampleUrls:urls};}
  const keys=new Set(parsed.flatMap(u=>[...u.searchParams.keys()]));
  for(const k of keys){const vals=parsed.map(u=>u.searchParams.get(k)).filter((v):v is string=>!!v);if(vals.length>=2&&vals.every(v=>/^\d+$/.test(v))&&new Set(vals).size>=2){const nums=vals.map(Number);const sample=parsed.find(u=>u.searchParams.has(k))!;sample.searchParams.set(k,"{page}");
    // URLSearchParams percent-encodes "{"/"}" on serialization (sample.search), so the placeholder
    // comes back as "%7Bpage%7D" instead of the literal "{page}" the crawler looks for. Undo just
    // that encoding — it's the one token we know we inserted ourselves above.
    const pattern=(sample.pathname+sample.search).replace(/%7Bpage%7D/gi,"{page}");
    return{kind:"url-pattern",container,pattern,start:1,detectedMax:Math.max(...nums),sampleUrls:urls};}}
  return{kind:"none",reason:"not-visible",page2Url:urls[1]||null};
}
function extractSeo():SeoData{
  const meta=(q:string)=>document.querySelector<HTMLMetaElement>(q)?.content?.trim()||null;const link=(q:string)=>document.querySelector<HTMLLinkElement>(q)?.href||null;const jsonLd:unknown[]=[];
  document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]').forEach(s=>{try{jsonLd.push(JSON.parse(s.textContent||"null"));}catch{}});
  return{title:document.title?.trim()||null,description:meta('meta[name="description"]'),keywords:meta('meta[name="keywords"]'),canonical:link('link[rel="canonical"]'),ogTitle:meta('meta[property="og:title"]'),ogDescription:meta('meta[property="og:description"]'),ogImage:meta('meta[property="og:image"]'),ogUrl:meta('meta[property="og:url"]'),twitterTitle:meta('meta[name="twitter:title"]'),twitterDescription:meta('meta[name="twitter:description"]'),twitterImage:meta('meta[name="twitter:image"]'),robots:meta('meta[name="robots"]'),jsonLd};
}
