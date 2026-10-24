import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {PCDLoader} from 'three/addons/loaders/PCDLoader.js';

export function createViewer(host,onSelection){
  const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));host.appendChild(renderer.domElement);
  const scene=new THREE.Scene();scene.background=new THREE.Color('#edf2f5');
  const camera=new THREE.OrthographicCamera(-10,10,10,-10,.01,100000);camera.up.set(0,1,0);camera.position.set(0,0,100);
  const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=false;
  const overlays=new THREE.Group();scene.add(overlays);
  let points,crop=null,erase=[],eraseStrokes=[],activeStroke=null,brushPointCount=0,brushRadius=.2,brushCursor=null,brushLimitReached=false;
  let mode=null,anchor=null,pointer=null,previewBox=null,origin=null,previewOrigin=null,cursorRing=null;
  let span=20,center=new THREE.Vector3(),height=100,zRange={min:-1e20,max:1e20},zRangeShader=null;
  const render=()=>renderer.render(scene,camera);controls.addEventListener('change',render);

  function attachHeightFilter(material){
    material.onBeforeCompile=shader=>{
      shader.uniforms.uMapZMin={value:zRange.min};shader.uniforms.uMapZMax={value:zRange.max};
      shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying float vMapPointZ;').replace('#include <begin_vertex>','#include <begin_vertex>\nvMapPointZ = position.z;');
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nuniform float uMapZMin;\nuniform float uMapZMax;\nvarying float vMapPointZ;').replace('#include <clipping_planes_fragment>','#include <clipping_planes_fragment>\nif (vMapPointZ < uMapZMin || vMapPointZ > uMapZMax) discard;');
      zRangeShader=shader;
    };
    material.customProgramCacheKey=()=>`map-height-filter-${material.type}`;
  }
  function resize(){
    if(!host.clientWidth||!host.clientHeight)return;
    renderer.setSize(host.clientWidth,host.clientHeight);const aspect=host.clientWidth/host.clientHeight;
    camera.left=-span*aspect/2;camera.right=span*aspect/2;camera.top=span/2;camera.bottom=-span/2;camera.updateProjectionMatrix();render();
  }
  new ResizeObserver(resize).observe(host);
  function clearOverlay(){for(const child of [...overlays.children]){child.geometry.dispose();child.material.dispose();overlays.remove(child);}}
  function clearCursor(){if(cursorRing){scene.remove(cursorRing);cursorRing.geometry.dispose();cursorRing.material.dispose();cursorRing=null;}}
  function updateCursorRing(value){
    clearCursor();if(!value||mode!=='erase-brush')return;
    const vertices=[],segments=32,z=center.z+Math.max(span*.006,.06);
    for(let i=0;i<segments;i++){const angle=2*Math.PI*i/segments;vertices.push(value.x+Math.cos(angle)*brushRadius,value.y+Math.sin(angle)*brushRadius,z);}
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
    cursorRing=new THREE.LineLoop(geometry,new THREE.LineBasicMaterial({color:'#bd382b',depthTest:false}));cursorRing.renderOrder=30;scene.add(cursorRing);render();
  }
  function clearBoxes(){crop=null;erase=[];eraseStrokes=[];activeStroke=null;brushPointCount=0;brushLimitReached=false;mode=null;anchor=null;pointer=null;previewBox=null;previewOrigin=null;brushCursor=null;clearCursor();controls.enabled=true;renderer.domElement.style.cursor='';drawSelections();}
  function clear(){if(points){scene.remove(points);points.geometry.dispose();points.material.dispose();points=null;zRangeShader=null;}origin=null;clearBoxes();render();}
  function fit(){
    if(!points)return;const bound=new THREE.Box3().setFromObject(points);bound.getCenter(center);const size=bound.getSize(new THREE.Vector3());
    span=Math.max(size.y,size.x/Math.max(.1,host.clientWidth/host.clientHeight),1)*1.15;height=Math.max(size.length()*2,100);
    camera.position.set(center.x,center.y,center.z+height);camera.up.set(0,1,0);camera.zoom=1;controls.target.copy(center);camera.lookAt(center);controls.update();resize();
  }
  function load(buffer){
    clear();points=new PCDLoader().parse(buffer,'');if(!points.geometry.getAttribute('position')?.count)throw new Error('PCD 没有有效点');
    points.material.color.set('#d56929');points.material.size=.07;points.material.sizeAttenuation=true;attachHeightFilter(points.material);scene.add(points);fit();return points.geometry.getAttribute('position').count;
  }
  function setZRange(min,max){if(!Number.isFinite(min)||!Number.isFinite(max)||min>=max)return false;zRange={min,max};if(zRangeShader){zRangeShader.uniforms.uMapZMin.value=min;zRangeShader.uniforms.uMapZMax.value=max;}render();return true;}
  function xy(e){
    const rect=renderer.domElement.getBoundingClientRect(),ray=new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1,1-(e.clientY-rect.top)/rect.height*2),camera);
    return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,0,1),-center.z),new THREE.Vector3());
  }
  function line(vertices,color,width=1){
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
    const material=new THREE.LineBasicMaterial({color,depthTest:false,linewidth:width});const object=new THREE.Line(geometry,material);object.renderOrder=20;overlays.add(object);
  }
  function rectangle(b,color){
    const z=center.z+Math.max(span*.002,.02),vertices=[b.x_min,b.y_min,z,b.x_max,b.y_min,z,b.x_max,b.y_max,z,b.x_min,b.y_max,z];
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
    const object=new THREE.LineLoop(geometry,new THREE.LineBasicMaterial({color,depthTest:false}));object.renderOrder=10;overlays.add(object);
  }
  function brushFootprint(stroke,color='#c13b30',opacity=.17){
    const radius=stroke.radius,vertices=[],z=center.z+Math.max(span*.004,.04),segments=16;
    const triangle=(a,b,c)=>vertices.push(a.x,a.y,z,b.x,b.y,z,c.x,c.y,z);
    const disk=point=>{for(let i=0;i<segments;i++){const a=2*Math.PI*i/segments,b=2*Math.PI*(i+1)/segments;triangle(point,{x:point.x+Math.cos(a)*radius,y:point.y+Math.sin(a)*radius},{x:point.x+Math.cos(b)*radius,y:point.y+Math.sin(b)*radius});}};
    stroke.points.forEach(disk);
    for(let i=1;i<stroke.points.length;i++){
      const a=stroke.points[i-1],b=stroke.points[i],dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy);if(length<1e-9)continue;
      const nx=-dy/length*radius,ny=dx/length*radius;
      const al={x:a.x+nx,y:a.y+ny},ar={x:a.x-nx,y:a.y-ny},bl={x:b.x+nx,y:b.y+ny},br={x:b.x-nx,y:b.y-ny};
      triangle(al,ar,bl);triangle(ar,br,bl);
    }
    if(!vertices.length)return;
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.computeBoundingSphere();
    const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color,transparent:true,opacity,depthTest:false,depthWrite:false,side:THREE.DoubleSide}));mesh.renderOrder=15;overlays.add(mesh);
  }
  function brushPreview(stroke){
    if(!stroke?.points?.length)return;
    const z=center.z+Math.max(span*.006,.06),vertices=[];
    stroke.points.forEach(point=>vertices.push(point.x,point.y,z));
    line(vertices,'#e77b2d',2);
  }
  function originMark(value,color='#138678'){
    if(!value)return;const z=center.z+Math.max(span*.003,.03),reach=Math.max(span*.1,.8),dx=Math.cos(value.yaw),dy=Math.sin(value.yaw),cross=Math.max(span*.012,.12);
    line([value.x-cross,value.y,z,value.x+cross,value.y,z,value.x,value.y-cross,z,value.x,value.y+cross,z],color);
    const ex=value.x+dx*reach,ey=value.y+dy*reach,px=-dy,py=dx,head=reach*.16;
    line([value.x,value.y,z,ex,ey,z,ex-dx*head+px*head*.55,ey-dy*head+py*head*.55,z,ex,ey,z,ex-dx*head-px*head*.55,ey-dy*head-py*head*.55,z],color,2);
  }
  function drawSelections(){
    clearOverlay();if(crop)rectangle(crop,'#16866d');erase.forEach(b=>rectangle(b,'#c13b30'));
    eraseStrokes.forEach(stroke=>brushFootprint(stroke));if(activeStroke)brushPreview(activeStroke);
    if(origin)originMark(origin);if(previewOrigin)originMark(previewOrigin,'#e77b2d');if(previewBox)rectangle(previewBox,mode==='crop'?'#16866d':'#c13b30');
    const detail=[crop?'1 个保留区域':'不限制 XY 范围',`${erase.length} 个矩形删除`,`${eraseStrokes.length} 笔橡皮擦`,origin?'原点与方向已设置':'原点未设置',brushLimitReached?'笔画已达上限，剩余部分未记录':''].filter(Boolean).join(' · ');
    onSelection(detail,eraseStrokes.length>0||erase.length>0);render();
  }
  function bounds(a,b){return {x_min:Math.min(a.x,b.x),x_max:Math.max(a.x,b.x),y_min:Math.min(a.y,b.y),y_max:Math.max(a.y,b.y)};}
  function appendBrushPoint(stroke,point){
    if(!point||stroke.points.length>=4096)return false;
    const last=stroke.points.at(-1);if(Math.hypot(point.x-last.x,point.y-last.y)<Math.max(.005,Math.min(.02,stroke.radius*.1)))return false;
    stroke.points.push({x:point.x,y:point.y});return true;
  }
  renderer.domElement.addEventListener('pointerdown',e=>{
    if(!mode||e.button!==0)return;e.preventDefault();const point=xy(e);if(!point)return;
    pointer=e.pointerId;renderer.domElement.setPointerCapture(pointer);
    if(mode==='erase-brush'){
      activeStroke={radius:brushRadius,points:[{x:point.x,y:point.y}]};brushLimitReached=false;brushCursor=point;updateCursorRing(point);drawSelections();return;
    }
    anchor=point;
    if(mode==='origin')previewOrigin={x:anchor.x,y:anchor.y,yaw:origin?.yaw||0};
  });
  renderer.domElement.addEventListener('pointermove',e=>{
    if(mode==='erase-brush'&&!activeStroke){brushCursor=xy(e);updateCursorRing(brushCursor);return;}
    if(e.pointerId!==pointer||(!anchor&&!activeStroke))return;const end=xy(e);if(!end)return;
    if(mode==='erase-brush'&&activeStroke){if(!appendBrushPoint(activeStroke,end))brushLimitReached=activeStroke.points.length>=4096;brushCursor=end;drawSelections();updateCursorRing(end);}
    else if(mode==='origin'){const dx=end.x-anchor.x,dy=end.y-anchor.y;previewOrigin={x:anchor.x,y:anchor.y,yaw:Math.hypot(dx,dy)>.01?Math.atan2(dy,dx):(origin?.yaw||0)};drawSelections();}
    else{previewBox=bounds(anchor,end);drawSelections();}
  });
  renderer.domElement.addEventListener('pointerup',e=>{
    if(mode==='erase-brush'&&activeStroke&&e.pointerId===pointer){
      const end=xy(e);appendBrushPoint(activeStroke,end);
      if(eraseStrokes.length<100&&brushPointCount+activeStroke.points.length<=20000){eraseStrokes.push(activeStroke);brushPointCount+=activeStroke.points.length;}
      else brushLimitReached=true;
      activeStroke=null;pointer=null;brushCursor=end||brushCursor;drawSelections();updateCursorRing(brushCursor);return;
    }
    if(!anchor||e.pointerId!==pointer)return;const end=xy(e);
    if(end&&mode==='origin'){
      const dx=end.x-anchor.x,dy=end.y-anchor.y;origin={x:anchor.x,y:anchor.y,yaw:Math.hypot(dx,dy)>.01?Math.atan2(dy,dx):(origin?.yaw||0)};previewOrigin=null;
    }else if(end&&mode){const box=bounds(anchor,end);if(box.x_max-box.x_min>.001&&box.y_max-box.y_min>.001){if(mode==='crop')crop=box;else if(erase.length<100)erase.push(box);}}
    const completed=mode==='origin'?origin:null;anchor=null;pointer=null;mode=null;previewBox=null;previewOrigin=null;controls.enabled=true;renderer.domElement.style.cursor='';clearCursor();drawSelections();if(completed)onOrigin?.(completed);
  });
  renderer.domElement.addEventListener('pointercancel',()=>{
    if(activeStroke){activeStroke=null;pointer=null;brushCursor=null;drawSelections();updateCursorRing(null);return;}
    anchor=null;pointer=null;mode=null;previewBox=null;previewOrigin=null;brushCursor=null;controls.enabled=true;renderer.domElement.style.cursor='';clearCursor();drawSelections();
  });
  renderer.domElement.addEventListener('pointerleave',()=>{if(mode==='erase-brush'&&!activeStroke){brushCursor=null;updateCursorRing(null);}});
  let onOrigin;
  return {
    resize,clear,fit,load,setZRange,clearBoxes,
    setBrushDiameter(value){if(!Number.isFinite(value)||value<.1||value>2)return false;brushRadius=value/2;if(brushCursor)updateCursorRing(brushCursor);return true;},
    canUndoErase(){return eraseStrokes.length>0||erase.length>0;},
    undoErase(){if(eraseStrokes.length){const stroke=eraseStrokes.pop();brushPointCount-=stroke.points.length;brushLimitReached=false;}else if(erase.length)erase.pop();else return false;drawSelections();return true;},
    cancelMode(){mode=null;anchor=null;pointer=null;activeStroke=null;previewBox=null;previewOrigin=null;brushCursor=null;clearCursor();controls.enabled=true;renderer.domElement.style.cursor='';drawSelections();},
    setOrigin(value){if(!value||![value.x,value.y,value.yaw].every(Number.isFinite)){origin=null;drawSelections();return false;}origin={x:value.x,y:value.y,yaw:value.yaw};drawSelections();return true;},
    clearOrigin(){origin=null;previewOrigin=null;drawSelections();},
    drawOrigin(callback){if(!points)return;clearCursor();activeStroke=null;anchor=null;previewBox=null;previewOrigin=null;brushCursor=null;fit();onOrigin=callback;mode='origin';controls.enabled=false;renderer.domElement.style.cursor='crosshair';},
    drawBox(kind){if(!points)return;clearCursor();activeStroke=null;anchor=null;previewOrigin=null;brushCursor=null;fit();mode=kind;controls.enabled=false;renderer.domElement.style.cursor='crosshair';},
    drawBrush(){if(!points)return;activeStroke=null;anchor=null;previewBox=null;previewOrigin=null;fit();mode='erase-brush';controls.enabled=false;renderer.domElement.style.cursor='crosshair';},
    selection(){return {...(crop?{crop}:{}),erase:erase.map(b=>({...b})),erase_brush:eraseStrokes.map(stroke=>({radius:stroke.radius,points:stroke.points.map(point=>({...point}))})),...(origin?{origin:{...origin}}:{})};}
  };
}
