// ============================================================
// 数据管理页 mock 适配层
//
// 用途：Java 后端未启动时（例如纯静态预览 8080），让界面可以完整联调。
//
// 数据来源：mock/data-admin-mock.json —— 由 DataAdminMockFixtureGenerator
// 从真实库**只读抽样**生成的快照（见该生成器的 excludedEntities，user
// 实体因含明文密码列而被排除，绝不写入快照）。
//
// 行为对齐后端 DataAdminService：
//   - 只允许元数据中 editable=true 的列参与写入
//   - 部分更新：只写请求里出现的列
//   - 复合实体（路线）：明细整体替换，stationIds 由明细顺序派生
//   - 软删除：isDelete 置 1；无 isDelete 列则物理删除
//
// 写入只在浏览器内存中进行，刷新页面即恢复快照原状。
// ============================================================

const MAX_PAGE_SIZE = 200;

export async function createMockApi() {
  const url = new URL("./data-admin-mock.json", import.meta.url);
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error("加载模拟数据失败（HTTP " + resp.status + "）：" + url.pathname);
  }
  const fixture = await resp.json();

  // 深拷贝一份，写入只改内存副本
  const entities = fixture.entities || [];
  const rows = {};
  Object.keys(fixture.rows || {}).forEach((k) => {
    rows[k] = JSON.parse(JSON.stringify(fixture.rows[k] || []));
  });
  let nextId = 1000000;

  function metaOf(key) {
    const m = entities.find((e) => e.key === key);
    if (!m) throw new Error("未知的实体: " + key);
    return m;
  }

  function colOf(meta, name) {
    return (meta.columns || []).find((c) => c.name === name) || null;
  }

  function isWritable(meta, name) {
    const c = colOf(meta, name);
    return !!c && c.editable && !(meta.derivedColumns || []).includes(name);
  }

  /** 与后端同样的部分更新语义：只接受可写列 */
  function sanitize(meta, values, createMode) {
    const out = {};
    Object.keys(values || {}).forEach((k) => {
      const c = colOf(meta, k);
      if (!c) throw new Error("未知的列: " + k);
      if (!isWritable(meta, k)) {
        throw new Error("列不可写: " + k
          + ((meta.derivedColumns || []).includes(k) ? "（该列由明细自动维护）" : ""));
      }
      const v = values[k];
      out[k] = typeof v === "string" ? (v.trim() === "" ? null : v.trim()) : v;
    });
    if (createMode) {
      (meta.columns || []).forEach((c) => {
        if (c.required && !(c.name in out)) {
          throw new Error("缺少必填列: " + c.label + "(" + c.name + ")");
        }
      });
    }
    if (!createMode && Object.keys(out).length === 0) {
      throw new Error("没有需要更新的列");
    }
    return out;
  }

  function buildChildren(meta, parentId) {
    if (!meta.composite || !meta.childEntityKey) return [];
    const childKey = meta.childEntityKey;
    const fk = meta.childForeignKey;
    return (rows[childKey] || []).filter((r) => Number(r[fk]) === Number(parentId) && Number(r.isDelete) !== 1);
  }

  function replaceChildren(meta, parentId, details, recomputeDirection) {
    if (!meta.composite || details == null) return;
    const childKey = meta.childEntityKey;
    const fk = meta.childForeignKey;
    const childMeta = metaOf(childKey);

    if (!rows[childKey]) rows[childKey] = [];
    const list = rows[childKey];

    // 既有子行按 stationId 对齐
    const existing = {};
    list.forEach((r) => {
      if (Number(r[fk]) === Number(parentId) && Number(r.isDelete) !== 1) {
        existing[String(r.stationId)] = r;
      }
    });

    details.forEach((d) => {
      if (d.stationId === undefined || d.stationId === null || d.stationId === "") {
        throw new Error("明细缺少 stationId");
      }
      const key = String(d.stationId);
      const target = existing[key];
      const patch = {};
      Object.keys(d).forEach((k) => {
        if (k === "id" || k === fk) return;
        const c = colOf(childMeta, k);
        if (!c) throw new Error("明细中存在未知列: " + k);
        if (!isWritable(childMeta, k)) throw new Error("明细列不可写: " + k);
        patch[k] = d[k];
      });
      if (recomputeDirection && patch.direction !== undefined) {
        patch.direction = mockDirection(patch.direction);
      }
      if (target) {
        Object.assign(target, patch);
      } else {
        list.push(Object.assign({ id: nextId++, [fk]: parentId, isDelete: 0 }, patch));
      }
      delete existing[key];
    });

    // 未出现的既有子行 → 逻辑删除
    Object.keys(existing).forEach((k) => {
      existing[k].isDelete = 1;
    });
  }

  /** mock 不做真实几何计算，只保留 360/-360 的可辨识语义 */
  function mockDirection(raw) {
    const s = raw === null || raw === undefined ? "" : String(raw);
    if (s === "360" || s === "-360") return "0（模拟：未按坐标计算）";
    return s;
  }

  // ==================== 对外接口（与真实后端同形） ====================

  return {
    isMock: true,
    fixtureInfo: {
      generatedAt: fixture.generatedAt,
      source: fixture.source,
      note: fixture.note
    },

    async entities() {
      return JSON.parse(JSON.stringify(entities));
    },

    async meta(entity) {
      return JSON.parse(JSON.stringify(metaOf(entity)));
    },

    async list(entity, payload) {
      const meta = metaOf(entity);
      const req = payload || {};
      let data = (rows[entity] || []).slice();

      if (meta.softDelete && !req.includeDeleted) {
        data = data.filter((r) => Number(r.isDelete) !== 1);
      }

      // 筛选
      const filters = req.filters || {};
      Object.keys(filters).forEach((col) => {
        const kw = filters[col];
        if (kw === null || kw === undefined || String(kw).trim() === "") return;
        const c = colOf(meta, col);
        if (!c) throw new Error("未知的列: " + col);
        const k = String(kw).trim().toLowerCase();
        const like = c.type === "string" || c.type === "select" || c.type === "json";
        data = data.filter((r) => {
          const v = r[col];
          if (v === null || v === undefined) return false;
          return like
            ? String(v).toLowerCase().includes(k)
            : String(v) === String(kw).trim();
        });
      });

      // 排序
      const sortBy = req.sortBy || meta.columns[0].name;
      const asc = String(req.sortOrder || "").toLowerCase() === "asc";
      data.sort((a, b) => {
        const av = a[sortBy], bv = b[sortBy];
        if (av === null || av === undefined) return 1;
        if (bv === null || bv === undefined) return -1;
        const na = Number(av), nb = Number(bv);
        let cmp;
        if (!isNaN(na) && !isNaN(nb) && String(av).trim() !== "" && String(bv).trim() !== "") {
          cmp = na - nb;
        } else {
          cmp = String(av).localeCompare(String(bv), "zh");
        }
        return asc ? cmp : -cmp;
      });

      const total = data.length;
      const pageSize = Math.min(Math.max(parseInt(req.pageSize, 10) || 20, 1), MAX_PAGE_SIZE);
      const pageNum = Math.max(parseInt(req.pageNum, 10) || 1, 1);
      const start = (pageNum - 1) * pageSize;

      return {
        total,
        pageNum,
        pageSize,
        rows: JSON.parse(JSON.stringify(data.slice(start, start + pageSize)))
      };
    },

    async detail(entity, id) {
      const meta = metaOf(entity);
      const row = (rows[entity] || []).find((r) => Number(r.id) === Number(id));
      return {
        row: row ? JSON.parse(JSON.stringify(row)) : null,
        details: JSON.parse(JSON.stringify(buildChildren(meta, id)))
      };
    },

    async create(entity, payload) {
      const meta = metaOf(entity);
      const values = sanitize(meta, payload.values, true);
      let stationIds = null;
      if (meta.composite && payload.details) {
        stationIds = payload.details.map((d) => Number(d.stationId));
        values.stationIds = JSON.stringify(stationIds);
      }
      const id = nextId++;
      const now = new Date().toISOString().slice(0, 19).replace("T", " ");
      const row = Object.assign({ id, isDelete: 0, createTime: now, updateTime: now }, values);
      if (!rows[entity]) rows[entity] = [];
      rows[entity].unshift(row);
      if (meta.composite) {
        replaceChildren(meta, id, payload.details, !!payload.recomputeDirection);
      }
      return id;
    },

    async update(entity, id, payload) {
      const meta = metaOf(entity);
      const row = (rows[entity] || []).find((r) => Number(r.id) === Number(id));
      if (!row) throw new Error("记录不存在: " + id);

      const values = sanitize(meta, payload.values, false);
      if (meta.composite && payload.details) {
        values.stationIds = JSON.stringify(payload.details.map((d) => Number(d.stationId)));
      }
      Object.assign(row, values);
      row.updateTime = new Date().toISOString().slice(0, 19).replace("T", " ");
      if (meta.composite) {
        replaceChildren(meta, id, payload.details, !!payload.recomputeDirection);
      }
      return 1;
    },

    async remove(entity, id) {
      const meta = metaOf(entity);
      const list = rows[entity] || [];
      const idx = list.findIndex((r) => Number(r.id) === Number(id));
      if (idx < 0) return 0;

      if (meta.composite) {
        const childKey = meta.childEntityKey;
        const fk = meta.childForeignKey;
        (rows[childKey] || []).forEach((r) => {
          if (Number(r[fk]) === Number(id)) r.isDelete = 1;
        });
      }

      if (meta.softDelete) {
        list[idx].isDelete = 1;
      } else {
        list.splice(idx, 1);
      }
      return 1;
    }
  };
}

/**
 * axios 同形适配器：暴露 get/post/put/delete，返回 {data: {code, data, message}}。
 *
 * 这样调用方（data-admin 页面）无需为 mock 模式改动任何一行请求代码——
 * 它拿到的形状与真实后端 BaseResponse 完全一致。
 */
export async function createMockClient() {
  const api = await createMockApi();

  const ok = (data) => Promise.resolve({ data: { code: 0, data: data, message: "ok" } });

  async function route(method, url, body) {
    const path = String(url).replace(/^\/+/, "");
    const parts = path.split("/");
    if (parts[0] !== "data-admin") {
      throw new Error("mock 未实现的接口: " + url);
    }
    const entity = parts[1];
    const tail = parts[2];

    if (entity === "entities" && method === "get") return ok(await api.entities());
    if (tail === "meta" && method === "get") return ok(await api.meta(entity));
    if (tail === "list" && method === "post") return ok(await api.list(entity, body));
    if (tail === undefined && method === "post") return ok(await api.create(entity, body));
    if (tail === undefined) throw new Error("mock 未实现的接口: " + method + " " + url);

    const id = Number(tail);
    if (method === "get") return ok(await api.detail(entity, id));
    if (method === "put") return ok(await api.update(entity, id, body));
    if (method === "delete") return ok(await api.remove(entity, id));
    throw new Error("mock 未实现的接口: " + method + " " + url);
  }

  return {
    isMock: true,
    fixtureInfo: api.fixtureInfo,
    get: (url) => route("get", url),
    post: (url, body) => route("post", url, body),
    put: (url, body) => route("put", url, body),
    delete: (url) => route("delete", url)
  };
}

