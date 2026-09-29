(function () {
  class MapCanvas {
    constructor(canvas, document, onChange, onSelect) {
      this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.document = structuredClone(document);
      this.onChange = onChange; this.onSelect = onSelect; this.tool = 'select'; this.selected = null; this.shape = null;
      this.history = []; this.future = []; this.area = []; this.edgeStart = null; this.drag = null;
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
        this.scale = Math.max(0.1, Math.min(100, this.scale * (event.deltaY < 0 ? 1.15 : 1/1.15)));
        const after = this.screen(before);
        const box = canvas.getBoundingClientRect();
        this.pan.x += event.clientX-box.left-after.x; this.pan.y += event.clientY-box.top-after.y;
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
      this.scale = Math.min((this.canvas.clientWidth-70)/this.document.width, (this.canvas.clientHeight-70)/this.document.height);
      this.scale = Math.max(0.1, this.scale); this.pan = { x: 35-this.document.origin_x*this.scale, y: 35-this.document.origin_y*this.scale };
      this.draw();
    }
    screen(point) { return { x: point.x*this.scale+this.pan.x, y: this.canvas.clientHeight-point.y*this.scale-this.pan.y }; }
    world(event) {
      const rect = this.canvas.getBoundingClientRect();
      return { x: Math.round((event.clientX-rect.left-this.pan.x)/this.scale*10)/10,
        y: Math.round((rect.height-(event.clientY-rect.top)-this.pan.y)/this.scale*10)/10 };
    }
    nearest(point) { return this.document.points.findIndex(p => Math.hypot(p.x-point.x,p.y-point.y)*this.scale < 13); }
    down(event) {
      if (event.button === 1 || this.tool === 'pan') { this.drag = { pan: true, x: event.clientX, y: event.clientY }; this.canvas.setPointerCapture(event.pointerId); return; }
      const point = this.world(event), index = this.nearest(point);
      if (this.tool === 'point') {
        this.checkpoint(); let n = this.document.points.length+1;
        while (this.document.points.some(p => p.code === `P${n}`)) n++;
        this.document.points.push({code:`P${n}`, name:'', type:'station', ...point, theta:0});
        this.selected = this.document.points.length-1; this.changed(); this.onSelect(this.document.points[this.selected]);
      } else if (this.tool === 'path' && index >= 0) {
        const code = this.document.points[index].code;
        if (this.edgeStart && this.edgeStart !== code) {
          this.checkpoint(); this.document.paths.push({start:this.edgeStart,end:code,bidirectional:true,speed:0.5,width:1});
          this.edgeStart = null; this.changed();
        } else this.edgeStart = code;
      } else if (this.tool === 'area') {
        const last = this.area[this.area.length-1];
        if (!last || last[0] !== point.x || last[1] !== point.y) this.area.push([point.x,point.y]); this.draw();
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
        this.pan.x += event.clientX-this.drag.x; this.pan.y -= event.clientY-this.drag.y;
        this.drag.x = event.clientX; this.drag.y = event.clientY; this.draw();
      } else { Object.assign(this.document.points[this.drag.index],this.world(event)); this.draw(); }
    }
    up() { if (this.drag && !this.drag.pan) this.changed(); this.drag = null; }
    closeArea() {
      if (this.area.length < 3) return;
      this.checkpoint(); this.document.areas.push({name:`禁行区 ${this.document.areas.length+1}`,type:'forbidden',polygon:this.area,speed:0.3});
      this.area = []; this.changed();
    }
    remove() {
      if (this.shape) {
        this.checkpoint(); this.document[this.shape.kind].splice(this.shape.index,1); this.shape=null; this.changed(); this.onSelect(null); return;
      }
      if (this.selected === null) return;
      this.checkpoint(); const [point] = this.document.points.splice(this.selected,1);
      this.document.paths = this.document.paths.filter(p => p.start !== point.code && p.end !== point.code);
      this.selected = null; this.changed(); this.onSelect(null);
    }
    updatePoint(values) {
      if (this.selected === null) return;
      this.checkpoint(); const old = this.document.points[this.selected].code;
      Object.assign(this.document.points[this.selected], values);
      for (const path of this.document.paths) { if (path.start === old) path.start = values.code; if (path.end === old) path.end = values.code; }
      this.changed();
    }
    selectShape(point) {
      const points = new Map(this.document.points.map(p=>[p.code,p]));
      for(let index=0;index<this.document.paths.length;index++){
        const path=this.document.paths[index],a=points.get(path.start),b=points.get(path.end);if(!a||!b)continue;
        const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/(dx*dx+dy*dy||1)));
        if(Math.hypot(point.x-a.x-t*dx,point.y-a.y-t*dy)*this.scale<8){this.shape={kind:'paths',index};this.onSelect({...path,kind:'paths'});return;}
      }
      for(let index=this.document.areas.length-1;index>=0;index--){
        const area=this.document.areas[index];let inside=false;
        for(let i=0,j=area.polygon.length-1;i<area.polygon.length;j=i++){
          const [x,y]=area.polygon[i],[px,py]=area.polygon[j];
          if((y>point.y)!==(py>point.y)&&point.x<(px-x)*(point.y-y)/(py-y)+x)inside=!inside;
        }
        if(inside){this.shape={kind:'areas',index};this.onSelect({...area,kind:'areas'});return;}
      }
      this.onSelect(null);
    }
    updateShape(values){if(!this.shape)return;this.checkpoint();Object.assign(this.document[this.shape.kind][this.shape.index],values);this.changed();}
    draw() {
      const width = this.canvas.clientWidth, height = this.canvas.clientHeight, ratio = window.devicePixelRatio || 1;
      this.canvas.width = width*ratio; this.canvas.height = height*ratio;
      const ctx = this.ctx; ctx.setTransform(ratio,0,0,ratio,0,0); ctx.clearRect(0,0,width,height);
      ctx.fillStyle='#fbfcfe'; ctx.fillRect(0,0,width,height);
      if(this.image){const corner=this.screen({x:this.document.origin_x,y:this.document.origin_y+this.document.height});ctx.drawImage(this.image,corner.x,corner.y,this.document.width*this.scale,this.document.height*this.scale);}
      const step = Math.max(1, Math.pow(10,Math.ceil(Math.log10(25/this.scale))))*this.scale;
      ctx.strokeStyle='#edf0f5'; ctx.lineWidth=1;
      for(let x=this.pan.x%step;x<width;x+=step){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,height);ctx.stroke();}
      for(let y=(height-this.pan.y)%step;y<height;y+=step){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(width,y);ctx.stroke();}
      const drawPoly = (polygon, color) => {
        ctx.beginPath(); polygon.forEach(([x,y],i)=>{const p=this.screen({x,y}); i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y);});
        ctx.closePath();ctx.fillStyle=color;ctx.fill();ctx.strokeStyle='#d4745e';ctx.stroke();
      };
      for(const area of this.document.areas) drawPoly(area.polygon,area.type==='forbidden'?'#e367672d':'#d9a64335');
      if(this.area.length) drawPoly(this.area,'#e367672d');
      const points = new Map(this.document.points.map(p=>[p.code,p]));
      ctx.strokeStyle='#829ab0';ctx.lineWidth=2;
      for(const [index,path] of this.document.paths.entries()){
        ctx.strokeStyle=this.shape?.kind==='paths'&&this.shape.index===index?'#e87832':'#829ab0';
        if(!points.has(path.start)||!points.has(path.end))continue;
        const a=this.screen(points.get(path.start)),b=this.screen(points.get(path.end));
        ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
        if(!path.bidirectional){const angle=Math.atan2(b.y-a.y,b.x-a.x),x=(a.x+b.x)/2,y=(a.y+b.y)/2;ctx.beginPath();ctx.moveTo(x-8*Math.cos(angle-.5),y-8*Math.sin(angle-.5));ctx.lineTo(x,y);ctx.lineTo(x-8*Math.cos(angle+.5),y-8*Math.sin(angle+.5));ctx.stroke();}
      }
      this.document.points.forEach((point,index)=>{
        const p=this.screen(point);if(p.x<-30||p.x>width+30||p.y<-30||p.y>height+30)return;
        ctx.beginPath();ctx.arc(p.x,p.y,index===this.selected?8:5,0,Math.PI*2);
        ctx.fillStyle=point.type==='charger'?'#34936c':index===this.selected?'#ea7c31':'#497fbd';ctx.fill();
        if(this.scale>1){ctx.fillStyle='#3e5268';ctx.font='11px sans-serif';ctx.fillText(point.code,p.x+9,p.y-8);}
      });
      window.drawLiveMap?.(this);
      ctx.fillStyle='#7d8c9b';ctx.font='12px sans-serif';ctx.fillText(`世界坐标 / 米 · 网格吸附 0.1m · ${this.document.points.length} 点 / ${this.document.paths.length} 路径`,15,height-14);
    }
    destroy(){this.liveController?.destroy();this.abort.abort();this.resizeObserver.disconnect();}
  }
  window.OperationsMapCanvas=MapCanvas;
})();
