(function () {
  const clampScale = value => Math.max(0.1, Math.min(100, value));
  const objectUid = () => window.crypto?.randomUUID?.() || `obj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const defaultTheme = { background: '#fbfcfe', grid: '#edf0f5', route: '#58748b', station: '#3976ad', selected: '#e87832', selectedLabel: '#e9a16f', measure: '#ed6b16', relocalize: '#ec6d1c', relocalizeText: '#c44e0c' };
  const handbookTheme = { ...defaultTheme, background: '#fff', grid: '#f8f9fc', route: '#1476FB', station: '#1476FB', selected: '#015EE7', selectedLabel: '#a8c7ff', measure: '#0a8f9b', relocalize: '#1476FB', relocalizeText: '#015EE7' };
  function pathSampleCount(start, end) {
    return Math.max(8, Math.min(24, Math.ceil(Math.hypot(end.x - start.x, end.y - start.y) / 0.35)));
  }
  function curveControls(path, start, end) {
    if (path.curve_mode !== 'smooth' || Math.abs(Number(path.curve_offset) || 0) < 1e-9) return null;
    const dx = end.x - start.x, dy = end.y - start.y, length = Math.hypot(dx, dy);
    if (length < 1e-9) return null;
    const offset = Number(path.curve_offset) * 4 / 3, nx = -dy / length, ny = dx / length;
    return [
      { x: start.x + dx / 3 + nx * offset, y: start.y + dy / 3 + ny * offset },
      { x: start.x + 2 * dx / 3 + nx * offset, y: start.y + 2 * dy / 3 + ny * offset }
    ];
  }
  function samplePath(path, start, end, count = pathSampleCount(start, end)) {
    const controls = curveControls(path, start, end);
    if (!controls) return [start, end];
    const [c1, c2] = controls, points = [];
    for (let index = 0; index <= count; index++) {
      const t = index / count, u = 1 - t;
      points.push({
        x: u ** 3 * start.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t ** 3 * end.x,
        y: u ** 3 * start.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t ** 3 * end.y
      });
    }
    return points;
  }

  class MapCanvas {
    constructor(canvas, document, onChange, onSelect, onMeasure, onRelocalize) {
      this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.document = structuredClone(document);
      this.onChange = onChange; this.onSelect = onSelect; this.onMeasure = onMeasure; this.onRelocalize = onRelocalize; this.tool = 'select'; this.selected = null; this.shape = null;
      this.history = []; this.future = []; this.area = []; this.areaType = 'forbidden'; this.edgeStart = null; this.drag = null; this.pendingPoint = null;
      this.layers = { background: true, paths: true, stations: true, coordinates: true, areas: true, liveRoute: true, liveTrail: true, liveRobot: true };
      this.scale = 6; this.pan = { x: 35, y: 35 };
      this.abort = new AbortController();
      const options = { signal: this.abort.signal };
      canvas.addEventListener('pointerdown', event => this.down(event), options);
      canvas.addEventListener('pointermove', event => this.move(event), options);
      canvas.addEventListener('pointerup', () => this.up(), options);
      canvas.addEventListener('dblclick', () => this.closeArea(), options);
      canvas.addEventListener('wheel', event => {
        event.preventDefault();
        const box = canvas.getBoundingClientRect();
        this.zoomAt(event.deltaY < 0 ? 1.15 : 1 / 1.15, event.clientX - box.left, event.clientY - box.top);
      }, { ...options, passive: false });
      this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe(canvas);
      this.fit();
    }
    setTool(tool) {
      if (tool !== 'point' && this.pendingPoint) this.cancelPendingPoint();
      this.tool = tool; this.drag = null; this.relocalization = null; if (tool !== 'measure') this.measure = null; this.draw();
    }
    setLayerVisible(name, visible) { if (!(name in this.layers)) return; this.layers[name] = !!visible; this.draw(); }
    selectPoint(code) {
      if (this.pendingPoint) this.cancelPendingPoint();
      const index = this.document.points.findIndex(point => point.code === code);
      if (index < 0) return;
      this.selected = index; this.shape = null; this.draw(); this.onSelect(this.document.points[index]);
    }
    selectObject(kind, index) {
      if (this.pendingPoint) this.cancelPendingPoint();
      if (!this.document[kind]?.[index]) return;
      this.selected = null; this.shape = { kind, index }; this.draw(); this.onSelect({ ...this.document[kind][index], kind });
    }
    checkpoint() {
      this.history.push(structuredClone(this.document)); if (this.history.length > 60) this.history.shift();
      this.future = [];
    }
    changed() { this.draw(); this.onChange(this.document); }
    confirmPendingPoint(values = {}) {
      if (!this.pendingPoint) return false;
      const point = { ...this.pendingPoint, ...values };
      point.code = String(point.code || '').trim();
      point.name = String(point.name || '').trim();
      if (!point.code) throw new Error('请输入站点编号');
      if (this.document.points.some(existing => existing.code === point.code)) throw new Error(`站点编号 ${point.code} 已存在`);
      if (!Number.isFinite(Number(point.theta))) throw new Error('目标朝向必须是有效数字');
      point.theta = Number(point.theta);
      point.uid = objectUid();
      delete point.kind;
      this.checkpoint(); this.document.points.push(point); this.pendingPoint = null;
      this.selected = this.document.points.length - 1; this.shape = null; this.changed(); this.onSelect(this.document.points[this.selected]);
      return true;
    }
    cancelPendingPoint() {
      if (!this.pendingPoint) return false;
      this.pendingPoint = null; this.draw(); this.onSelect(null); return true;
    }
    undo() {
      if (this.pendingPoint) { this.cancelPendingPoint(); return; }
      if (!this.history.length) return;
      this.future.push(structuredClone(this.document)); this.document = this.history.pop(); this.selected = null; this.shape = null; this.changed(); this.onSelect(null);
    }
    redo() {
      if (!this.future.length) return;
      this.history.push(structuredClone(this.document)); this.document = this.future.pop(); this.selected = null; this.shape = null; this.changed(); this.onSelect(null);
    }
    fit() {
      this.fitView = true;
      this.viewport = { width: this.canvas.clientWidth, height: this.canvas.clientHeight };
      this.scale = clampScale(Math.min((this.canvas.clientWidth - 70) / this.document.width, (this.canvas.clientHeight - 70) / this.document.height));
      this.fitScale = this.scale;
      this.pan = {
        x: (this.canvas.clientWidth - this.document.width * this.scale) / 2 - this.document.origin_x * this.scale,
        y: (this.canvas.clientHeight - this.document.height * this.scale) / 2 - this.document.origin_y * this.scale
      };
      this.draw();
    }
    resize() {
      const width = this.canvas.clientWidth, height = this.canvas.clientHeight;
      if (!width || !height) return; // Hidden tabs must not erase the last usable viewport.
      if (this.fitView || !this.viewport) { this.fit(); return; }
      const previous = this.viewport;
      if (width === previous.width && height === previous.height) { this.draw(); return; }
      const center = { x: (previous.width / 2 - this.pan.x) / this.scale,
        y: (previous.height / 2 - this.pan.y) / this.scale };
      const relativeZoom = this.scale / this.fitScale;
      this.fitScale = clampScale(Math.min((width - 70) / this.document.width, (height - 70) / this.document.height));
      this.scale = clampScale(this.fitScale * relativeZoom);
      this.pan = { x: width / 2 - center.x * this.scale, y: height / 2 - center.y * this.scale };
      this.viewport = { width, height };
      this.draw();
    }
    zoomAt(factor, x, y) {
      if (!Number.isFinite(factor) || factor <= 0 || !Number.isFinite(x) || !Number.isFinite(y)) return false;
      const next = clampScale(this.scale * factor);
      if (next === this.scale) return false;
      this.fitView = false;
      const worldX = (x - this.pan.x) / this.scale;
      const worldY = (this.canvas.clientHeight - y - this.pan.y) / this.scale;
      this.scale = next;
      this.pan = { x: x - worldX * next, y: this.canvas.clientHeight - y - worldY * next };
      this.draw();
      return true;
    }
    zoomBy(factor) { return this.zoomAt(factor, this.canvas.clientWidth / 2, this.canvas.clientHeight / 2); }
    zoomPercent() { return Math.round(this.scale / this.fitScale * 1000) / 10; }
    setAreaType(type) { this.areaType = type; }
    screen(point) { return { x: point.x * this.scale + this.pan.x, y: this.canvas.clientHeight - point.y * this.scale - this.pan.y }; }
    world(event, precision = 10) {
      const rect = this.canvas.getBoundingClientRect();
      return { x: Math.round((event.clientX - rect.left - this.pan.x) / this.scale * precision) / precision,
        y: Math.round((rect.height - (event.clientY - rect.top) - this.pan.y) / this.scale * precision) / precision };
    }
    nearest(point) { return this.layers.stations ? this.document.points.findIndex(p => Math.hypot(p.x - point.x, p.y - point.y) * this.scale < 13) : -1; }
    down(event) {
      if (event.button === 1 || this.tool === 'pan') { this.fitView = false; this.drag = { pan: true, x: event.clientX, y: event.clientY }; this.canvas.setPointerCapture(event.pointerId); return; }
      const point = this.world(event, this.tool === 'relocalize' ? 1000 : 10), index = this.nearest(point);
      if (this.tool === 'relocalize') {
        this.relocalization = { start: point, end: point }; this.drag = { relocalize: true };
        this.canvas.setPointerCapture(event.pointerId); this.draw();
      } else if (this.tool === 'measure') {
        this.measure = { start: point, end: point }; this.drag = { measure: true }; this.canvas.setPointerCapture(event.pointerId); this.draw();
      } else if (this.tool === 'point') {
        if (this.pendingPoint) return;
        let n = this.document.points.length + 1;
        while (this.document.points.some(p => p.code === `P${n}`)) n++;
        this.pendingPoint = { code: `P${n}`, name: '', type: 'station', ...point, theta: 0 };
        this.selected = null; this.shape = null; this.draw();
        this.onSelect({ ...this.pendingPoint, kind: 'pending-point' });
      } else if ((this.tool === 'path' || this.tool === 'curve') && index >= 0) {
        const code = this.document.points[index].code;
        if (this.edgeStart && this.edgeStart !== code) {
          const start = this.document.points.find(p => p.code === this.edgeStart), end = this.document.points[index];
          const length = Math.hypot(end.x - start.x, end.y - start.y);
          const path = { uid: objectUid(), start: this.edgeStart, end: code, bidirectional: true, speed: 0.5, width: 1,
            curve_mode: this.tool === 'curve' ? 'smooth' : 'straight', curve_offset: this.tool === 'curve' ? Math.min(5, length * 0.18) : 0 };
          this.checkpoint(); this.selected = null; this.document.paths.push(path); this.shape = { kind: 'paths', index: this.document.paths.length - 1 };
          this.edgeStart = null; this.changed(); this.onSelect({ ...path, kind: 'paths' });
        } else { this.edgeStart = code; this.selected = index; this.draw(); }
      } else if (this.tool === 'area') {
        const last = this.area[this.area.length - 1];
        if (!last || last[0] !== point.x || last[1] !== point.y) this.area.push([point.x, point.y]); this.draw();
      } else if (this.tool === 'select') {
        this.shape = null;
        this.selected = index >= 0 ? index : null;
        if (index >= 0) { this.checkpoint(); this.drag = { index }; this.canvas.setPointerCapture(event.pointerId); this.onSelect(this.document.points[index]); }
        else this.selectShape(point);
        this.draw();
      }
    }
    move(event) {
      if (!this.drag) return;
      if (this.drag.pan) {
        this.pan.x += event.clientX - this.drag.x; this.pan.y -= event.clientY - this.drag.y;
        this.drag.x = event.clientX; this.drag.y = event.clientY; this.draw();
      } else if (this.drag.relocalize) {
        this.relocalization.end = this.world(event, 1000); this.draw();
      } else if (this.drag.measure) {
        this.measure.end = this.world(event); this.draw();
      } else { Object.assign(this.document.points[this.drag.index], this.world(event)); this.draw(); }
    }
    up() {
      if (this.drag?.relocalize) {
        const { start, end } = this.relocalization;
        const pose = { x: start.x, y: start.y, yaw: Math.atan2(end.y - start.y, end.x - start.x),
          directionLength: Math.hypot(end.x - start.x, end.y - start.y) };
        this.drag = null; this.relocalization = null; this.draw(); this.onRelocalize?.(pose); return;
      }
      if (this.drag?.measure) {
        const distance = Math.hypot(this.measure.end.x - this.measure.start.x, this.measure.end.y - this.measure.start.y);
        this.onMeasure?.(distance, this.measure);
      } else if (this.drag && !this.drag.pan) this.changed();
      this.drag = null;
    }
    closeArea() {
      if (this.area.length < 3) return;
      const labels = { forbidden: '禁行区', slow: '减速区', work: '作业区', charge: '充电区' };
      const type = this.areaType, count = this.document.areas.filter(area => area.type === type).length + 1;
      const area = { name: `${labels[type] || '区域'} ${count}`, type, polygon: this.area, speed: 0.3 };
      this.checkpoint(); this.document.areas.push({ ...area, uid: objectUid() }); this.shape = { kind: 'areas', index: this.document.areas.length - 1 };
      this.area = []; this.changed(); this.onSelect({ ...area, kind: 'areas' });
    }
    remove() {
      if (this.shape) {
        this.checkpoint(); this.document[this.shape.kind].splice(this.shape.index, 1); this.shape = null; this.changed(); this.onSelect(null); return;
      }
      if (this.selected === null) return;
      this.checkpoint(); const [point] = this.document.points.splice(this.selected, 1);
      this.document.paths = this.document.paths.filter(p => p.start !== point.code && p.end !== point.code);
      this.selected = null; this.changed(); this.onSelect(null);
    }
    updatePoint(values) {
      if (this.selected === null) return;
      this.checkpoint(); const old = this.document.points[this.selected].code;
      Object.assign(this.document.points[this.selected], values);
      for (const path of this.document.paths) { if (path.start === old) path.start = values.code; if (path.end === old) path.end = values.code; }
      this.changed(); this.onSelect(this.document.points[this.selected]);
    }
    selectShape(point) {
      const points = new Map(this.document.points.map(p => [p.code, p]));
      for (let index = 0; this.layers.paths && index < this.document.paths.length; index++) {
        const path = this.document.paths[index], a = points.get(path.start), b = points.get(path.end); if (!a || !b) continue;
        const sampled = samplePath(path, a, b).map(p => this.screen(p));
        for (let i = 1; i < sampled.length; i++) {
          const from = sampled[i - 1], to = sampled[i], dx = to.x - from.x, dy = to.y - from.y;
          const t = Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / (dx * dx + dy * dy || 1)));
          const click = this.screen(point);
          if (Math.hypot(click.x - from.x - t * dx, click.y - from.y - t * dy) < 9) {
            this.shape = { kind: 'paths', index }; this.onSelect({ ...path, kind: 'paths' }); return;
          }
        }
      }
      for (let index = this.layers.areas ? this.document.areas.length - 1 : -1; index >= 0; index--) {
        const area = this.document.areas[index]; let inside = false;
        for (let i = 0, j = area.polygon.length - 1; i < area.polygon.length; j = i++) {
          const [x, y] = area.polygon[i], [px, py] = area.polygon[j];
          if ((y > point.y) !== (py > point.y) && point.x < (px - x) * (point.y - y) / (py - y) + x) inside = !inside;
        }
        if (inside) { this.shape = { kind: 'areas', index }; this.onSelect({ ...area, kind: 'areas' }); return; }
      }
      this.onSelect(null);
    }
    updateShape(values) { if (!this.shape) return; this.checkpoint(); const kind = this.shape.kind; Object.assign(this.document[kind][this.shape.index], values); this.changed(); this.onSelect({ ...this.document[kind][this.shape.index], kind }); }
    draw() {
      const width = this.canvas.clientWidth, height = this.canvas.clientHeight, ratio = window.devicePixelRatio || 1;
      const theme = this.canvas.closest?.('.rcs-console') ? handbookTheme : defaultTheme;
      this.canvas.width = width * ratio; this.canvas.height = height * ratio;
      const ctx = this.ctx; ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = theme.background; ctx.fillRect(0, 0, width, height);
      if (this.layers.background && this.image) { const corner = this.screen({ x: this.document.origin_x, y: this.document.origin_y + this.document.height }); ctx.drawImage(this.image, corner.x, corner.y, this.document.width * this.scale, this.document.height * this.scale); }
      const step = Math.max(1, Math.pow(10, Math.ceil(Math.log10(25 / this.scale)))) * this.scale;
      if (this.layers.coordinates) {
        ctx.strokeStyle = theme.grid; ctx.lineWidth = 1;
        for (let x = this.pan.x % step; x < width; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); }
        for (let y = (height - this.pan.y) % step; y < height; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
        const zero = this.screen({ x: 0, y: 0 }); ctx.save(); ctx.setLineDash([6, 5]); ctx.strokeStyle = '#f36a14'; ctx.lineWidth = 1.25;
        if (zero.y >= 0 && zero.y <= height) { ctx.beginPath(); ctx.moveTo(0, zero.y); ctx.lineTo(width - 32, zero.y); ctx.stroke(); }
        if (zero.x >= 0 && zero.x <= width) { ctx.beginPath(); ctx.moveTo(zero.x, height); ctx.lineTo(zero.x, 24); ctx.stroke(); }
        ctx.setLineDash([]); ctx.fillStyle = '#f36a14'; ctx.font = '600 12px Segoe UI, Microsoft YaHei, sans-serif';
        if (zero.y >= 0 && zero.y <= height) ctx.fillText('X  →', width - 30, zero.y - 7);
        if (zero.x >= 0 && zero.x <= width) ctx.fillText('Y  ↑', zero.x + 7, 18);
        if (zero.x >= 0 && zero.x <= width && zero.y >= 0 && zero.y <= height) {
          ctx.beginPath(); ctx.arc(zero.x, zero.y, 6, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#f36a14'; ctx.lineWidth = 2; ctx.stroke();
          ctx.fillStyle = '#f36a14'; ctx.fillText('(0, 0)', zero.x + 10, zero.y + 19);
        }
        ctx.restore();
      }
      const areaStyles = {
        forbidden: { fill: 'rgba(220,76,82,.16)', stroke: '#cf4f56', label: '禁行' },
        slow: { fill: 'rgba(230,161,43,.20)', stroke: '#c58926', label: '减速' },
        work: { fill: 'rgba(35,153,144,.18)', stroke: '#278b84', label: '作业' },
        charge: { fill: 'rgba(54,147,108,.18)', stroke: '#348362', label: '充电' }
      };
      const drawPoly = (polygon, type, selected = false) => {
        if (!polygon?.length) return;
        const style = areaStyles[type] || areaStyles.forbidden;
        ctx.beginPath(); polygon.forEach(([x, y], i) => { const p = this.screen({ x, y }); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
        ctx.closePath(); ctx.fillStyle = style.fill; ctx.fill(); ctx.strokeStyle = selected ? theme.selected : style.stroke; ctx.lineWidth = selected ? 2.5 : 1.5; ctx.stroke();
        const center = polygon.reduce((sum, [x, y]) => [sum[0] + x / polygon.length, sum[1] + y / polygon.length], [0, 0]);
        const label = this.document.areas.find(a => a.polygon === polygon)?.name || style.label, p = this.screen({ x: center[0], y: center[1] });
        ctx.font = '600 12px Microsoft YaHei, sans-serif'; ctx.fillStyle = style.stroke; ctx.fillText(label, p.x, p.y);
      };
      if (this.layers.areas) this.document.areas.forEach((area, index) => drawPoly(area.polygon, area.type, this.shape?.kind === 'areas' && this.shape.index === index));
      if (this.layers.areas && this.area.length) drawPoly(this.area, this.areaType);
      const points = new Map(this.document.points.map(p => [p.code, p]));
      for (const [index, path] of (this.layers.paths ? this.document.paths : []).entries()) {
        const pointA = points.get(path.start), pointB = points.get(path.end); if (!pointA || !pointB) continue;
        const a = this.screen(pointA), b = this.screen(pointB), controls = curveControls(path, pointA, pointB);
        const selected = this.shape?.kind === 'paths' && this.shape.index === index;
        ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = selected ? theme.selected : theme.route; ctx.lineWidth = selected ? 2.8 : 1.7;
        ctx.beginPath(); ctx.moveTo(a.x, a.y);
        if (controls) { const c1 = this.screen(controls[0]), c2 = this.screen(controls[1]); ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, b.x, b.y); }
        else ctx.lineTo(b.x, b.y);
        ctx.stroke();
        if (!path.bidirectional) {
          const sampled = samplePath(path, pointA, pointB), middle = Math.floor(sampled.length / 2), from = this.screen(sampled[Math.max(0, middle - 1)]), to = this.screen(sampled[Math.min(sampled.length - 1, middle + 1)]);
          const angle = Math.atan2(to.y - from.y, to.x - from.x), x = (from.x + to.x) / 2, y = (from.y + to.y) / 2;
          ctx.beginPath(); ctx.moveTo(x - 8 * Math.cos(angle - .5), y - 8 * Math.sin(angle - .5)); ctx.lineTo(x, y); ctx.lineTo(x - 8 * Math.cos(angle + .5), y - 8 * Math.sin(angle + .5)); ctx.stroke();
        }
      }
      window.drawLiveMap?.(this);
      if (this.layers.stations) this.document.points.forEach((point, index) => {
        const p = this.screen(point); if (p.x < -120 || p.x > width + 120 || p.y < -50 || p.y > height + 50) return;
        const selected = index === this.selected, color = point.type === 'charger' ? '#25835d' : point.type === 'shelf' ? '#8564aa' : point.type === 'waiting' ? '#bc7a27' : point.type === 'elevator' ? '#287fa0' : theme.station;
        ctx.save(); ctx.translate(p.x, p.y); ctx.fillStyle = color; ctx.strokeStyle = selected ? theme.selected : '#fff'; ctx.lineWidth = selected ? 3 : 1.5;
        if (point.type === 'charger' || point.type === 'shelf' || point.type === 'elevator') {
          const sides = point.type === 'elevator' ? 6 : 4; ctx.beginPath();
          for (let i = 0; i < sides; i++) { const angle = (i / sides) * Math.PI * 2 - Math.PI / 2, radius = selected ? 9 : 7; const x = Math.cos(angle) * radius, y = Math.sin(angle) * radius; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
          ctx.closePath(); ctx.fill(); ctx.stroke();
        } else {
          ctx.beginPath(); ctx.arc(0, 0, selected ? 8 : 6, 0, Math.PI * 2); point.type === 'waiting' ? ctx.stroke() : (ctx.fill(), ctx.stroke());
        }
        ctx.restore();
        if (this.scale > 1.5 || selected) {
          const label = point.name && point.name !== point.code ? `${point.name} · ${point.code}` : point.code;
          ctx.font = `${selected ? '600 ' : ''}12px Microsoft YaHei, sans-serif`;
          const labelWidth = ctx.measureText(label).width, x = p.x + 11, y = p.y - 11;
          ctx.fillStyle = 'rgba(255,255,255,.94)'; ctx.fillRect(x - 3, y - 12, labelWidth + 7, 18);
          ctx.strokeStyle = selected ? theme.selectedLabel : '#d9e2e9'; ctx.lineWidth = 1; ctx.strokeRect(x - 3, y - 12, labelWidth + 7, 18);
          ctx.fillStyle = '#263d52'; ctx.fillText(label, x, y + 1);
        }
      });
      if (this.pendingPoint) {
        const p = this.screen(this.pendingPoint);
        ctx.save(); ctx.setLineDash([5, 4]); ctx.strokeStyle = '#e87832'; ctx.fillStyle = 'rgba(232,120,50,.16)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(p.x, p.y, 11, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
        ctx.font = '600 12px Microsoft YaHei, sans-serif';
        const label = `待确认 ${this.pendingPoint.code}`, labelWidth = ctx.measureText(label).width;
        ctx.fillStyle = 'rgba(255,255,255,.96)'; ctx.fillRect(p.x + 14, p.y - 22, labelWidth + 10, 20);
        ctx.strokeStyle = '#e8a16f'; ctx.strokeRect(p.x + 14, p.y - 22, labelWidth + 10, 20);
        ctx.fillStyle = '#a54d1c'; ctx.fillText(label, p.x + 19, p.y - 8); ctx.restore();
      }
      if (this.measure) {
        const start = this.screen(this.measure.start), end = this.screen(this.measure.end), distance = Math.hypot(this.measure.end.x - this.measure.start.x, this.measure.end.y - this.measure.start.y);
        ctx.save(); ctx.strokeStyle = theme.measure; ctx.lineWidth = 2; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(end.x, end.y); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = theme.measure; ctx.font = '600 12px Segoe UI, Microsoft YaHei, sans-serif'; ctx.fillText(`${distance.toFixed(2)} m`, (start.x + end.x) / 2 + 8, (start.y + end.y) / 2 - 8); ctx.restore();
      }
      if (this.edgeStart) {
        const p = points.get(this.edgeStart), s = p && this.screen(p);
        if (s) { ctx.fillStyle = theme.selected; ctx.beginPath(); ctx.arc(s.x, s.y, 12, 0, Math.PI * 2); ctx.strokeStyle = theme.selected; ctx.lineWidth = 2; ctx.stroke(); }
      }
      if (this.relocalization) {
        const start = this.screen(this.relocalization.start), end = this.screen(this.relocalization.end);
        const angle = Math.atan2(end.y - start.y, end.x - start.x), head = 11;
        ctx.save();ctx.strokeStyle=theme.relocalize;ctx.fillStyle=theme.relocalize;ctx.lineWidth=3;ctx.lineCap='round';
        ctx.beginPath();ctx.moveTo(start.x,start.y);ctx.lineTo(end.x,end.y);ctx.stroke();
        ctx.beginPath();ctx.moveTo(end.x,end.y);ctx.lineTo(end.x-head*Math.cos(angle-.55),end.y-head*Math.sin(angle-.55));
        ctx.lineTo(end.x-head*Math.cos(angle+.55),end.y-head*Math.sin(angle+.55));ctx.closePath();ctx.fill();
        ctx.beginPath();ctx.arc(start.x,start.y,8,0,Math.PI*2);ctx.fillStyle='#fff';ctx.fill();ctx.strokeStyle=theme.relocalize;ctx.lineWidth=3;ctx.stroke();
        ctx.fillStyle=theme.relocalizeText;ctx.font='600 12px Segoe UI, Microsoft YaHei, sans-serif';
        ctx.fillText(`新车位 (${this.relocalization.start.x.toFixed(2)}, ${this.relocalization.start.y.toFixed(2)})`,start.x+12,start.y-12);ctx.restore();
      }
      const curves = this.document.paths.filter(path => path.curve_mode === 'smooth').length;
      ctx.fillStyle = '#63788b'; ctx.font = '12px Microsoft YaHei, sans-serif';
      ctx.fillText(`世界坐标 / 米 · 0.1m 网格 · ${this.document.points.length} 个站点 · ${this.document.paths.length} 条路线（曲线 ${curves}）`, 15, height - 14);
      this.onViewChange?.(this.zoomPercent());
    }
    destroy() { this.liveController?.destroy(); this.abort.abort(); this.resizeObserver.disconnect(); }
  }
  window.OperationsMapGeometry = { curveControls, samplePath, pathSampleCount };
  window.OperationsMapCanvas = MapCanvas;
})();
