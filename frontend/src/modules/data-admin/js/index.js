// ============================================================
// 数据管理页逻辑
//
// 完全由后端元数据驱动：
//   GET  data-admin/entities          实体列表（渲染标签页）
//   GET  data-admin/{entity}/meta     列元数据（渲染表头/表单/筛选列）
//   POST data-admin/{entity}/list     分页查询
//   GET  data-admin/{entity}/{id}     详情（复合实体连带子行）
//   POST data-admin/{entity}          新增
//   PUT  data-admin/{entity}/{id}     修改（部分更新）
//   DELETE data-admin/{entity}/{id}   删除
//
// 前端不硬编码任何表名或列名；哪些列可写、可排序、可筛选全部来自后端白名单。
// ============================================================

import axiosClient from "../../../api/ApiManager.js";

// 请求客户端：默认走真实 Python 后端；
// URL 加 ?mock=1 时切换到 mock 适配器（Java 后端无法启动时用于界面联调，
// 适配器与后端 BaseResponse 同形，因此下面所有请求代码无需改动）。
// 请求客户端默认走真实 Python 后端。
// 后端不可达时（404 / 网络错误）会自动降级到静态数据，无需任何 URL 参数——
// 因为本页常被父页面的 iframe 加载，iframe 不继承父页面的查询串，靠参数并不可靠。
// URL 参数仅作为覆盖开关：?mock=1 强制静态数据；?mock=0 强制真实后端（不降级，便于排查）。
const MOCK_PARAM = new URLSearchParams(window.location.search).get("mock");
let client = axiosClient;

const state = {
  entities: [],
  entityKey: null,
  meta: null,
  childMeta: null,
  pageNum: 1,
  pageSize: 20,
  includeDeleted: false,
  sortBy: null,
  sortOrder: "desc",
  filters: {},
  rows: [],
  total: 0,
  editingId: null,   // null 表示新增
  detailRows: [],
  recomputeDirection: false
};

let editModal = null;

// ============================================================
// 通用工具
// ============================================================

/**
 * 取后端错误文案。
 * 现场 ResultUtils.error(ErrorCode, description) 把描述写进 message、枚举文案写进 data，
 * 所以按 message → description → data 依次兜底。
 */
function describeError(resp) {
  const body = (resp && resp.data) || {};
  if (body.message) return body.message;
  if (body.description) return body.description;
  if (typeof body.data === "string" && body.data) return body.data;
  return "请求失败";
}

async function callApi(request, failurePrefix) {
  let resp;
  try {
    resp = await request;
  } catch (e) {
    const err = new Error((failurePrefix || "接口调用失败") + ": " + (e && e.message ? e.message : e));
    // 附加传输层信息，供「后端是否真的不可达」判断使用
    err.httpStatus = (e && e.response && e.response.status) ? e.response.status : null;
    err.networkError = !(e && e.response);
    throw err;
  }
  const body = resp.data || {};
  if (body.code !== 0) {
    throw new Error(describeError(resp));
  }
  return body.data;
}

/**
 * 是否属于「后端不可达」类失败。
 *
 * 只在**连不上或路由不存在**时才算：404 / 网络错误。
 * 后端活着但返回业务错误（参数错误等）不算，避免用静态数据掩盖真实报错。
 */
function isBackendUnreachable(err) {
  if (!err) return false;
  if (err.networkError) return true;
  return err.httpStatus === 404;
}

function esc(v) {
  if (v === null || v === undefined) return "";
  return String(v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cellText(v) {
  if (v === null || v === undefined || v === "") {
    return '<span class="da-cell-empty">—</span>';
  }
  if (typeof v === "boolean") return v ? "是" : "否";
  let s = String(v);
  if (s.length > 60) {
    return '<span title="' + esc(s) + '">' + esc(s.slice(0, 60)) + "…</span>";
  }
  return esc(s);
}

function setMsg(text, isError) {
  const el = document.getElementById("formMsg");
  el.textContent = text || "";
  el.className = "form-msg" + (isError ? " error" : "");
}

function withBusy(button, label, task) {
  const original = button ? button.textContent : null;
  if (button) {
    button.disabled = true;
    button.textContent = label || "处理中…";
  }
  return Promise.resolve()
    .then(task)
    .finally(() => {
      if (button) {
        button.disabled = false;
        button.textContent = original;
      }
    });
}

// ============================================================
// 初始化
// ============================================================

async function init() {
  bindEvents();
  editModal = new bootstrap.Modal(document.getElementById("editModal"));

  // ?mock=1 强制静态数据；?mock=0 强制真实后端（不自动降级，便于排查问题）
  if (MOCK_PARAM === "1") {
    if (!(await enableStaticData(null))) return;
    return bootList();
  }
  if (MOCK_PARAM === "0") {
    try {
      return await bootList();
    } catch (e) {
      cocoMessage.error(e.message);
      showBanner("hint", "强制真实后端模式（<code>?mock=0</code>）下接口调用失败："
        + esc(e.message));
      return;
    }
  }

  // 默认：先试真实后端，探测到不可达再自动降级到静态数据
  try {
    await bootList();
  } catch (e) {
    if (!isBackendUnreachable(e)) {
      // 后端活着，是业务错误 —— 照实报错，不用静态数据掩盖
      cocoMessage.error(e.message);
      showBanner("hint", "接口调用失败：" + esc(e.message));
      return;
    }
    cocoMessage.warning("后端未响应，已自动切换到静态数据");
    if (!(await enableStaticData(e.message))) return;
    await bootList();
  }
}

/** 加载实体列表并选中第一个 */
async function bootList() {
  await loadEntities();
  if (state.entities.length > 0) {
    await selectEntity(state.entities[0].key);
  }
}

/** 切到静态数据（mock）客户端，并给出常驻说明 */
async function enableStaticData(reason) {
  try {
    // 注意：本文件在 js/ 子目录下，mock 目录与 js/ 平级，必须用 ../mock/
    const mod = await import("../mock/mock-api.js");
    client = await mod.createMockClient();
    showMockBanner(client.fixtureInfo, reason);
    return true;
  } catch (e) {
    cocoMessage.error("静态数据加载失败: " + e.message);
    return false;
  }
}

/** 顶部横幅统一入口：kind = "mock" | "hint" */
function showBanner(kind, html) {
  const el = document.getElementById("mockBanner");
  el.style.display = "";
  el.className = "mock-banner" + (kind === "hint" ? " mock-banner-hint" : "");
  el.innerHTML = html;
}

/**
 * 静态数据模式下的常驻横幅。
 * 必须显眼：避免有人把抽样快照当成机器人上的实时数据。
 */
function showMockBanner(info, reason) {
  const meta = info || {};
  const why = reason
    ? "原因：后端未响应（" + esc(reason) + "）"
    : "已按 <code>?mock=1</code> 手动开启";
  showBanner("mock",
    "⚠️ <b>静态数据模式 —— 当前显示的不是机器人上的实时数据</b><br>"
    + why
    + " ｜ 数据来源：<code>" + esc(meta.source || "本地快照") + "</code>"
    + "，生成于 " + esc(meta.generatedAt || "未知")
    + "（只读抽样，供界面联调）<br>"
    + "新增 / 修改 / 删除<b>只在浏览器内存中生效，刷新即还原</b>，不会影响数据库"
    + " ｜ 需要连真实后端时，确认后端已在 8088 启动后刷新本页即可");
}

/** 后端不可达且未降级时的提示 */
function showBackendHint(detail) {
  showBanner("hint", "后端未响应"
    + (detail ? "（" + esc(detail) + "）" : "")
    + "。确认 8088 上的服务已启动后刷新本页。");
}

function bindEvents() {
  document.getElementById("searchBtn").addEventListener("click", () => {
    applyFilter();
  });
  document.getElementById("filterKeyword").addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") applyFilter();
  });
  document.getElementById("resetBtn").addEventListener("click", () => {
    document.getElementById("filterKeyword").value = "";
    state.filters = {};
    state.pageNum = 1;
    loadData({ button: document.getElementById("resetBtn") });
  });
  document.getElementById("refreshBtn").addEventListener("click", (ev) => {
    loadData({ button: ev.currentTarget });
  });
  document.getElementById("includeDeleted").addEventListener("change", (ev) => {
    state.includeDeleted = ev.target.checked;
    state.pageNum = 1;
    loadData();
  });
  document.getElementById("createBtn").addEventListener("click", () => openForm(null));
  document.getElementById("saveBtn").addEventListener("click", (ev) => saveForm(ev.currentTarget));
  document.getElementById("prevBtn").addEventListener("click", () => {
    if (state.pageNum > 1) {
      state.pageNum--;
      loadData();
    }
  });
  document.getElementById("nextBtn").addEventListener("click", () => {
    const maxPage = Math.max(1, Math.ceil(state.total / state.pageSize));
    if (state.pageNum < maxPage) {
      state.pageNum++;
      loadData();
    }
  });
  document.getElementById("pageSize").addEventListener("change", (ev) => {
    state.pageSize = parseInt(ev.target.value, 10);
    state.pageNum = 1;
    loadData();
  });
  document.getElementById("addDetailRowBtn").addEventListener("click", () => {
    const blank = {};
    if (state.childMeta) {
      state.childMeta.columns.forEach((c) => {
        if (c.editable) blank[c.name] = "";
      });
    }
    state.detailRows.push(blank);
    renderDetailTable();
  });
}

// ============================================================
// 实体与元数据
// ============================================================

async function loadEntities() {
  state.entities = await callApi(client.get("data-admin/entities"), "加载实体列表失败");
  renderTabs();
}

function renderTabs() {
  const ul = document.getElementById("entityTabs");
  ul.innerHTML = "";
  state.entities.forEach((e) => {
    const li = document.createElement("li");
    li.className = "nav-item";
    const a = document.createElement("a");
    a.className = "nav-link" + (e.key === state.entityKey ? " active" : "");
    a.href = "#";
    a.textContent = e.label;
    a.addEventListener("click", (ev) => {
      ev.preventDefault();
      if (e.key !== state.entityKey) selectEntity(e.key);
    });
    li.appendChild(a);
    ul.appendChild(li);
  });
}

async function selectEntity(key) {
  state.entityKey = key;
  state.pageNum = 1;
  state.sortBy = null;
  state.sortOrder = "desc";
  state.filters = {};
  document.getElementById("filterKeyword").value = "";

  state.meta = await callApi(client.get("data-admin/" + key + "/meta"), "加载元数据失败");
  state.childMeta = null;
  if (state.meta.composite && state.meta.childEntityKey) {
    state.childMeta = await callApi(
      client.get("data-admin/" + state.meta.childEntityKey + "/meta"), "加载子表元数据失败");
  }

  renderTabs();
  renderFilterColumns();
  renderMetaHint();
  await loadData();
}

function renderFilterColumns() {
  const sel = document.getElementById("filterColumn");
  sel.innerHTML = "";
  state.meta.columns
    .filter((c) => c.filterable)
    .forEach((c) => {
      const o = document.createElement("option");
      o.value = c.name;
      o.textContent = c.label + " (" + c.name + ")";
      sel.appendChild(o);
    });
}

function renderMetaHint() {
  const m = state.meta;
  const parts = [];
  parts.push("表 <code>" + esc(m.table) + "</code>");
  parts.push(m.softDelete ? "逻辑删除（删除仅置 isDelete=1，可勾选「显示已删除」查看）" : "物理删除（无 isDelete 列）");
  if (m.composite) {
    parts.push("复合实体：<code>" + esc(m.childEntityKey) + "</code> 明细由 <code>"
      + esc(m.childForeignKey) + "</code> 关联，保存时整体替换");
  }
  if (m.derivedColumns && m.derivedColumns.length > 0) {
    parts.push("派生列（由明细自动维护，不可直接写）：<code>" + m.derivedColumns.map(esc).join(", ") + "</code>");
  }
  document.getElementById("metaHint").innerHTML = parts.join(" ｜ ");
}

// ============================================================
// 列表
// ============================================================

function applyFilter() {
  const col = document.getElementById("filterColumn").value;
  const kw = document.getElementById("filterKeyword").value;
  state.filters = kw && kw.trim() ? { [col]: kw.trim() } : {};
  state.pageNum = 1;
  loadData({ button: document.getElementById("searchBtn") });
}

async function loadData(opts) {
  const button = (opts && opts.button) || document.getElementById("refreshBtn");
  await withBusy(button, "加载中…", async () => {
    try {
      const payload = {
        pageNum: state.pageNum,
        pageSize: state.pageSize,
        includeDeleted: state.includeDeleted,
        filters: state.filters
      };
      if (state.sortBy) {
        payload.sortBy = state.sortBy;
        payload.sortOrder = state.sortOrder;
      }
      const page = await callApi(
        client.post("data-admin/" + state.entityKey + "/list", payload), "查询失败");
      state.rows = page.rows || [];
      state.total = page.total || 0;
      renderTable();
      renderPager();
    } catch (e) {
      cocoMessage.error(e.message);
    }
  });
}

function renderTable() {
  const m = state.meta;
  const head = document.getElementById("tableHead");
  const body = document.getElementById("tableBody");

  head.innerHTML = "";
  body.innerHTML = "";

  // 表头（可排序列点击排序）
  const tr = document.createElement("tr");
  m.columns.forEach((c) => {
    const th = document.createElement("th");
    th.textContent = c.label;
    if (!c.editable) th.className = "ro";
    if (c.hint) th.title = c.hint;
    if (c.sortable) {
      th.style.cursor = "pointer";
      if (state.sortBy === c.name) {
        th.textContent += state.sortOrder === "asc" ? " ▲" : " ▼";
      }
      th.addEventListener("click", () => {
        if (state.sortBy === c.name) {
          state.sortOrder = state.sortOrder === "asc" ? "desc" : "asc";
        } else {
          state.sortBy = c.name;
          state.sortOrder = "asc";
        }
        state.pageNum = 1;
        loadData();
      });
    }
    tr.appendChild(th);
  });
  const thAct = document.createElement("th");
  thAct.textContent = "操作";
  thAct.className = "da-col-actions";
  tr.appendChild(thAct);
  head.appendChild(tr);

  if (state.rows.length === 0) {
    const empty = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = m.columns.length + 1;
    td.className = "text-center da-cell-empty";
    td.textContent = "没有数据";
    empty.appendChild(td);
    body.appendChild(empty);
    return;
  }

  state.rows.forEach((row) => {
    const r = document.createElement("tr");
    const deleted = state.meta.softDelete && Number(row.isDelete) === 1;
    if (deleted) r.className = "row-deleted";

    m.columns.forEach((c) => {
      const td = document.createElement("td");
      const v = row[c.name];
      if (c.type === "boolean") {
        td.textContent = Number(v) === 1 ? "是" : "否";
      } else {
        td.innerHTML = cellText(v);
      }
      if (c.hint) td.title = c.hint;
      r.appendChild(td);
    });

    const tdAct = document.createElement("td");
    tdAct.className = "da-col-actions";
    const btnEdit = document.createElement("button");
    btnEdit.className = "btn btn-sm btn-outline-primary";
    btnEdit.textContent = "编辑";
    btnEdit.addEventListener("click", () => openForm(row.id));
    tdAct.appendChild(btnEdit);

    const btnDel = document.createElement("button");
    btnDel.className = "btn btn-sm btn-outline-danger";
    btnDel.textContent = deleted ? "已删除" : "删除";
    btnDel.disabled = deleted;
    btnDel.addEventListener("click", () => deleteRow(row, btnDel));
    tdAct.appendChild(btnDel);

    r.appendChild(tdAct);
    body.appendChild(r);
  });
}

function renderPager() {
  const maxPage = Math.max(1, Math.ceil(state.total / state.pageSize));
  document.getElementById("pageInfo").textContent =
    "第 " + state.pageNum + " / " + maxPage + " 页，共 " + state.total + " 条";
  document.getElementById("prevBtn").disabled = state.pageNum <= 1;
  document.getElementById("nextBtn").disabled = state.pageNum >= maxPage;
}

// ============================================================
// 删除
// ============================================================

async function deleteRow(row, button) {
  const name = row[state.meta.columns.find((c) => c.editable) ? state.meta.columns.find((c) => c.editable).name : "id"];
  const tip = state.meta.softDelete
    ? "将执行逻辑删除（isDelete=1），勾选「显示已删除」仍可看到，可人工恢复。"
    : "该表没有 isDelete 列，将执行物理删除且无法撤销。";
  if (!window.confirm("确认删除 id=" + row.id + "  " + (name || "") + "？\n\n" + tip)) {
    return;
  }
  await withBusy(button, "删除中…", async () => {
    try {
      await callApi(client.delete("data-admin/" + state.entityKey + "/" + row.id), "删除失败");
      cocoMessage.success("已删除");
      await loadData();
    } catch (e) {
      cocoMessage.error(e.message);
    }
  });
}

// ============================================================
// 表单（新增 / 编辑）
// ============================================================

async function openForm(id) {
  state.editingId = id;
  state.detailRows = [];
  state.recomputeDirection = false;
  setMsg("");

  document.getElementById("editTitle").textContent =
    (id === null ? "新增" : "编辑") + " " + state.meta.label + (id === null ? "" : "  id=" + id);

  let row = {};
  if (id !== null) {
    try {
      const detail = await callApi(
        client.get("data-admin/" + state.entityKey + "/" + id), "加载详情失败");
      row = detail.row || {};
      state.detailRows = detail.details || [];
    } catch (e) {
      cocoMessage.error(e.message);
      return;
    }
  }

  renderForm(row);
  renderDetailSection();
  editModal.show();
}

function renderForm(row) {
  const wrap = document.getElementById("formFields");
  wrap.innerHTML = "";

  state.meta.columns.forEach((c) => {
    const col = document.createElement("div");
    col.className = "col-md-4";

    const label = document.createElement("div");
    label.className = "form-row-label";
    label.innerHTML = esc(c.label)
      + (c.editable && c.required ? '<span class="req-mark">*</span>' : "")
      + ' <span class="da-cell-empty">' + esc(c.name) + "</span>";
    col.appendChild(label);

    const v = row[c.name];

    if (!c.editable) {
      // 只读列：展示但不可改
      const div = document.createElement("div");
      div.className = "ro-value";
      div.textContent = (v === null || v === undefined || v === "") ? "—" : String(v);
      col.appendChild(div);
    } else if (c.masked) {
      // 脱敏列（口令）：用密码框且**不回填**，留空即不修改。
      // 后端也会把空值与脱敏占位符一并跳过，这里是第一重防护。
      const input = document.createElement("input");
      input.className = "form-control form-control-sm";
      input.dataset.field = c.name;
      input.type = "password";
      input.autocomplete = "new-password";
      input.placeholder = "留空表示不修改";
      col.appendChild(input);
    } else if (c.type === "select" && c.options && c.options.length > 0) {
      const sel = document.createElement("select");
      sel.className = "form-select form-select-sm";
      sel.dataset.field = c.name;
      c.options.forEach((o) => {
        const opt = document.createElement("option");
        opt.value = o;
        opt.textContent = o === "" ? "（空）" : o;
        sel.appendChild(opt);
      });
      sel.value = v === null || v === undefined ? "" : String(v);
      col.appendChild(sel);
    } else {
      const input = document.createElement("input");
      input.className = "form-control form-control-sm";
      input.dataset.field = c.name;
      input.type = c.type === "number" ? "number" : "text";
      input.value = v === null || v === undefined ? "" : String(v);
      col.appendChild(input);
    }

    if (c.hint) {
      const h = document.createElement("div");
      h.className = "field-hint";
      h.textContent = c.hint;
      col.appendChild(h);
    }

    wrap.appendChild(col);
  });
}

function renderDetailSection() {
  const section = document.getElementById("detailSection");
  if (!state.meta.composite || !state.childMeta) {
    section.style.display = "none";
    return;
  }
  section.style.display = "";
  document.getElementById("detailTitle").textContent =
    state.childMeta.label + "（" + state.detailRows.length + " 条）";
  renderDetailTable();
}

function renderDetailTable() {
  const child = state.childMeta;
  if (!child) return;

  const editableCols = child.columns.filter((c) => c.editable);
  const head = document.getElementById("detailHead");
  const body = document.getElementById("detailBody");
  head.innerHTML = "";
  body.innerHTML = "";

  const tr = document.createElement("tr");
  editableCols.forEach((c) => {
    const th = document.createElement("th");
    th.textContent = c.label;
    if (c.hint) th.title = c.hint;
    tr.appendChild(th);
  });
  const thOp = document.createElement("th");
  thOp.className = "da-col-actions";
  thOp.textContent = "操作";
  tr.appendChild(thOp);
  head.appendChild(tr);

  if (state.detailRows.length === 0) {
    const empty = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = editableCols.length + 1;
    td.className = "text-center da-cell-empty";
    td.textContent = "暂无明细（保存后该条目将没有站点）";
    empty.appendChild(td);
    body.appendChild(empty);
    return;
  }

  state.detailRows.forEach((row, idx) => {
    const r = document.createElement("tr");
    editableCols.forEach((c) => {
      const td = document.createElement("td");
      const input = document.createElement("input");
      input.className = "form-control form-control-sm";
      input.type = c.type === "number" ? "number" : "text";
      input.style.minWidth = "90px";
      input.dataset.detailField = c.name;
      input.dataset.detailIndex = idx;
      input.title = c.hint || "";
      input.value = row[c.name] === null || row[c.name] === undefined ? "" : String(row[c.name]);
      input.addEventListener("input", () => {
        state.detailRows[idx][c.name] = input.value;
      });
      td.appendChild(input);
      r.appendChild(td);
    });

    const tdOp = document.createElement("td");
    tdOp.className = "da-col-actions";
    const btn = document.createElement("button");
    btn.className = "btn btn-sm btn-outline-danger";
    btn.textContent = "移除";
    btn.addEventListener("click", () => {
      state.detailRows.splice(idx, 1);
      renderDetailSection();
    });
    tdOp.appendChild(btn);
    r.appendChild(tdOp);
    body.appendChild(r);
  });

  // 重算航向开关（仅路线明细涉及 direction 语义）
  const hasDirection = editableCols.some((c) => c.name === "direction");
  if (hasDirection) {
    const wrap = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = editableCols.length + 1;
    const label = document.createElement("label");
    label.className = "form-check-label da-inline-check";
    label.style.marginTop = "6px";
    const cb = document.createElement("input");
    cb.className = "form-check-input";
    cb.type = "checkbox";
    cb.checked = state.recomputeDirection;
    cb.addEventListener("change", () => {
      state.recomputeDirection = cb.checked;
    });
    label.appendChild(cb);
    const span = document.createElement("span");
    span.textContent = "保存时按规则重算航向（direction=360 取下一点、-360 取上一点；"
      + "不勾选则按填写值原样保存）";
    span.style.fontSize = "12px";
    span.style.color = "#666";
    label.appendChild(span);
    td.appendChild(label);
    wrap.appendChild(td);
    body.appendChild(wrap);
  }
}

function collectValues() {
  const values = {};
  document.querySelectorAll("#formFields [data-field]").forEach((el) => {
    const name = el.dataset.field;
    const col = state.meta.columns.find((c) => c.name === name);
    // 脱敏列留空 = 不修改，不回传（避免把空值或脱敏占位符写进库里）
    if (col && col.masked && el.value === "") return;
    values[name] = el.value;
  });
  return values;
}

function collectDetails() {
  return state.detailRows.map((row) => {
    const out = {};
    Object.keys(row).forEach((k) => {
      // 只保留子表可写列
      const c = state.childMeta.columns.find((x) => x.name === k);
      if (c && c.editable) out[k] = row[k];
    });
    return out;
  });
}

async function saveForm(button) {
  setMsg("");
  const values = collectValues();

  const payload = { values: values };
  if (state.meta.composite) {
    payload.details = collectDetails();
    payload.recomputeDirection = state.recomputeDirection;
  }

  await withBusy(button, "保存中…", async () => {
    try {
      if (state.editingId === null) {
        await callApi(client.post("data-admin/" + state.entityKey, payload), "新增失败");
        cocoMessage.success("新增成功");
      } else {
        await callApi(client.put(
          "data-admin/" + state.entityKey + "/" + state.editingId, payload), "保存失败");
        cocoMessage.success("保存成功");
      }
      editModal.hide();
      await loadData();
    } catch (e) {
      setMsg(e.message, true);
      cocoMessage.error(e.message);
    }
  });
}

// ============================================================

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
