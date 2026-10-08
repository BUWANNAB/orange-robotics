(function () {
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
    constructor(canvas, document, onChange, onSelect) {
      this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.document = structuredClone(document);
      this.onChange = onChange; this.onSelect = onSelect; this.tool = 'select'; this.selected = null; this.shape = null;
      this.history = []; this.future = []; this.area = []; this.areaType = 'forbidden'; this.edgeStart = null; this.drag = null;
      this.scale = 6; this.pan = { x: 35, y: 35 };
      this.abort = new AbortController();
      const options = { signal: this.abort.signal };
      canvas.addEventListener('pointerdown', event => this.down(event), options);
      canvas.addEventListener('pointermove', event => this.move(event), options);
      canvas.addEventListener('pointerup', () => this.up(), options);
      canvas.addEventListener('dblclick', () => this.closeArea(), options);
      canvas.addEventListener('wheel', event => {
        event.preventDefault();
        const before = this.world(event);
        this.scale = Math.max(0.1, Math.min(100, this.scale * (event.deltaY < 0 ? 1.15 : 1 / 1.15)));
        const after = this.screen(before), box = canvas.getBoundingClientRect();
        this.pan.x += event.clientX - box.left - after.x; this.pan.y += event.clientY - box.top - after.y;
        this.draw();
      }, { ...options, passive: false });
      this.resizeObserver = new ResizeObserver(() => this.draw()); this.resizeObserver.observe(canvas);
      this.fit();
    }
    checkpoint() {
      this.history.push(structuredClone(this.document)); if (this.history.length > 60) this.history.shift();
      this.future = [];
    }
    changed() { this.draw(); this.onChange(this.document); }
    undo() {
      if (!this.history.length) return;
      this.future.push(structuredClone(this.document)); this.document = this.history.pop(); this.selected = null; this.shape = null; this.changed(); this.onSelect(null);
    }
    redo() {
      if (!this.future.length) return;
      this.history.push(structuredClone(this.document)); this.document = this.future.pop(); this.selected = null; this.shape = null; this.changed(); this.onSelect(null);
    }
    fit() {
      this.scale = Math.min((this.canvas.clientWidth - 70) / this.document.width, (this.canvas.clientHeight - 70) / this.document.height);
      this.scale = Math.max(0.1, this.scale); this.pan = { x: 35 - this.document.origin_x * this.scale, y: 35 - this.document.origin_y * this.scale };
      this.draw();
    }
    setAreaType(type) { this.areaType = type; }
    screen(point) { return { x: point.x * this.scale + this.pan.x, y: this.canvas.clientHeight - point.y * this.scale - this.pan.y }; }
    world(event) {
      const rect = this.canvas.getBoundingClientRect();
      return { x: Math.round((event.clientX - rect.left - this.pan.x) / this.scale * 10) / 10,
        y: Math.round((rect.height - (event.clientY - rect.top) - this.pan.y) / this.scale * 10) / 10 };
    }
    nearest(point) { return this.document.points.findIndex(p => Math.hypot(p.x - point.x, p.y - point.y) * this.scale < 13); }
    down(event) {
      if (event.button === 1 || this.tool === 'pan') { this.drag = { pan: true, x: event.clientX, y: event.clientY }; this.canvas.setPointerCapture(event.pointerId); return; }
      const point = this.world(event), index = this.nearest(point);
      if (this.tool === 'point') {
        this.checkpoint(); let n = this.document.points.length + 1;
        while (this.document.points.some(p => p.code === `P${n}`)) n++;
        this.document.points.push({ code: `P${n}`, name: '', type: 'station', ...point, theta: 0 });
        this.selected = this.document.points.length - 1; this.changed(); this.onSelect(this.document.points[this.selected]);
      } else if ((this.tool === 'path' || this.tool === 'curve') && index >= 0) {
        const code = this.document.points[index].code;
        if (this.edgeStart && this.edgeStart !== code) {
          const start = this.document.points.find(p => p.code === this.edgeStart), end = this.document.points[index];
          const length = Math.hypot(end.x - start.x, end.y - start.y);
          const path = { start: this.edgeStart, end: code, bidirectional: true, speed: 0.5, width: 1,
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
      } else { Object.assign(this.document.points[this.drag.index], this.world(event)); this.draw(); }
    }
    up() { if (this.drag && !this.drag.pan) this.changed(); this.drag = null; }
    closeArea() {
      if (this.area.length < 3) return;
      const labels = { forbidden: '禁行区', slow: '减速区', work: '作业区', charge: '充电区' };
      const type = this.areaType, count = this.document.areas.filter(area => area.type === type).length + 1;
      const area = { name: `${labels[type] || '区域'} ${count}`, type, polygon: this.area, speed: 0.3 };
      this.checkpoint(); this.document.areas.push(area); this.shape = { kind: 'areas', index: this.document.areas.length - 1 };
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
      for (let index = 0; index < this.document.paths.length; index++) {
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
      for (let index = this.document.areas.length - 1; index >= 0; index--) {
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
      this.canvas.width = width * ratio; this.canvas.height = height * ratio;
      const ctx = this.ctx; ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#fbfcfe'; ctx.fillRect(0, 0, width, height);
      if (this.image) { const corner = this.screen({ x: this.document.origin_x, y: this.document.origin_y + this.document.height }); ctx.drawImage(this.image, corner.x, corner.y, this.document.width * this.scale, this.document.height * this.scale); }
      const step = Math.max(1, Math.pow(10, Math.ceil(Math.log10(25 / this.scale)))) * this.scale;
      ctx.strokeStyle = '#edf0f5'; ctx.lineWidth = 1;
      for (let x = this.pan.x % step; x < width; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); }
      for (let y = (height - this.pan.y) % step; y < height; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
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
        ctx.closePath(); ctx.fillStyle = style.fill; ctx.fill(); ctx.strokeStyle = selected ? '#e87832' : style.stroke; ctx.lineWidth = selected ? 2.5 : 1.5; ctx.stroke();
        const center = polygon.reduce((sum, [x, y]) => [sum[0] + x / polygon.length, sum[1] + y / polygon.length], [0, 0]);
        const label = this.document.areas.find(a => a.polygon === polygon)?.name || style.label, p = this.screen({ x: center[0], y: center[1] });
        ctx.font = '600 12px Microsoft YaHei, sans-serif'; ctx.fillStyle = style.stroke; ctx.fillText(label, p.x, p.y);
      };
      this.document.areas.forEach((area, index) => drawPoly(area.polygon, area.type, this.shape?.kind === 'areas' && this.shape.index === index));
      if (this.area.length) drawPoly(this.area, this.areaType);
      const points = new Map(this.document.points.map(p => [p.code, p]));
      for (const [index, path] of this.document.paths.entries()) {
        const pointA = points.get(path.start), pointB = points.get(path.end); if (!pointA || !pointB) continue;
        const a = this.screen(pointA), b = this.screen(pointB), controls = curveControls(path, pointA, pointB);
        const selected = this.shape?.kind === 'paths' && this.shape.index === index;
        ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = selected ? '#e87832' : '#58748b'; ctx.lineWidth = selected ? 2.8 : 1.7;
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
      this.document.points.forEach((point, index) => {
        const p = this.screen(point); if (p.x < -120 || p.x > width + 120 || p.y < -50 || p.y > height + 50) return;
        const selected = index === this.selected, color = point.type === 'charger' ? '#25835d' : point.type === 'shelf' ? '#8564aa' : point.type === 'waiting' ? '#bc7a27' : point.type === 'elevator' ? '#287fa0' : '#3976ad';
        ctx.save(); ctx.translate(p.x, p.y); ctx.fillStyle = color; ctx.strokeStyle = selected ? '#e87832' : '#fff'; ctx.lineWidth = selected ? 3 : 1.5;
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
          ctx.strokeStyle = selected ? '#e9a16f' : '#d9e2e9'; ctx.lineWidth = 1; ctx.strokeRect(x - 3, y - 12, labelWidth + 7, 18);
          ctx.fillStyle = '#263d52'; ctx.fillText(label, x, y + 1);
        }
      });
      if (this.edgeStart) {
        const p = points.get(this.edgeStart), s = p && this.screen(p);
        if (s) { ctx.fillStyle = '#e87832'; ctx.beginPath(); ctx.arc(s.x, s.y, 12, 0, Math.PI * 2); ctx.strokeStyle = '#e87832'; ctx.lineWidth = 2; ctx.stroke(); }
      }
      const curves = this.document.paths.filter(path => path.curve_mode === 'smooth').length;
      ctx.fillStyle = '#63788b'; ctx.font = '12px Microsoft YaHei, sans-serif';
      ctx.fillText(`世界坐标 / 米 · 0.1m 网格 · ${this.document.points.length} 个站点 · ${this.document.paths.length} 条路线（曲线 ${curves}）`, 15, height - 14);
    }
    destroy() { this.liveController?.destroy(); this.abort.abort(); this.resizeObserver.disconnect(); }
  }
  window.OperationsMapGeometry = { curveControls, samplePath, pathSampleCount };
  window.OperationsMapCanvas = MapCanvas;
})();
