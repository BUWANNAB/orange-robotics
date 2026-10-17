import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {PCDLoader} from 'three/addons/loaders/PCDLoader.js';

export function createViewer(host,onSelection){
  const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));host.appendChild(renderer.domElement);
  const scene=new THREE.Scene();scene.background=new THREE.Color('#edf2f5');
  const camera=new THREE.OrthographicCamera(-10,10,10,-10,.01,100000);camera.up.set(0,1,0);camera.position.set(0,0,100);
  const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=false;
  const overlays=new THREE.Group();scene.add(overlays);
  let points,crop=null,erase=[],mode=null,anchor=null,pointer=null,previewBox=null,origin=null,previewOrigin=null;
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
  function clearBoxes(){crop=null;erase=[];mode=null;anchor=null;previewBox=null;previewOrigin=null;controls.enabled=true;renderer.domElement.style.cursor='';drawSelections();}
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
  function originMark(value,color='#138678'){
    if(!value)return;const z=center.z+Math.max(span*.003,.03),reach=Math.max(span*.1,.8),dx=Math.cos(value.yaw),dy=Math.sin(value.yaw),cross=Math.max(span*.012,.12);
    line([value.x-cross,value.y,z,value.x+cross,value.y,z,value.x,value.y-cross,z,value.x,value.y+cross,z],color);
    const ex=value.x+dx*reach,ey=value.y+dy*reach,px=-dy,py=dx,head=reach*.16;
    line([value.x,value.y,z,ex,ey,z,ex-dx*head+px*head*.55,ey-dy*head+py*head*.55,z,ex,ey,z,ex-dx*head-px*head*.55,ey-dy*head-py*head*.55,z],color,2);
  }
  function drawSelections(){
    clearOverlay();if(crop)rectangle(crop,'#16866d');erase.forEach(b=>rectangle(b,'#c13b30'));
    if(origin)originMark(origin);if(previewOrigin)originMark(previewOrigin,'#e77b2d');if(previewBox)rectangle(previewBox,mode==='crop'?'#16866d':'#c13b30');
    const detail=[crop?'1 个保留区域':'不限制 XY 范围',`${erase.length} 个删除区域`,origin?'原点与方向已设置':'原点未设置'].join(' · ');
    onSelection(detail);render();
  }
  function bounds(a,b){return {x_min:Math.min(a.x,b.x),x_max:Math.max(a.x,b.x),y_min:Math.min(a.y,b.y),y_max:Math.max(a.y,b.y)};}
  renderer.domElement.addEventListener('pointerdown',e=>{
    if(!mode||e.button!==0)return;e.preventDefault();anchor=xy(e);pointer=e.pointerId;renderer.domElement.setPointerCapture(pointer);
    if(mode==='origin')previewOrigin={x:anchor.x,y:anchor.y,yaw:origin?.yaw||0};
  });
  renderer.domElement.addEventListener('pointermove',e=>{
    if(!anchor||e.pointerId!==pointer)return;const end=xy(e);if(!end)return;
    if(mode==='origin'){const dx=end.x-anchor.x,dy=end.y-anchor.y;previewOrigin={x:anchor.x,y:anchor.y,yaw:Math.hypot(dx,dy)>.01?Math.atan2(dy,dx):(origin?.yaw||0)};drawSelections();}
    else{previewBox=bounds(anchor,end);drawSelections();}
  });
  renderer.domElement.addEventListener('pointerup',e=>{
    if(!anchor||e.pointerId!==pointer)return;const end=xy(e);
    if(end&&mode==='origin'){
      const dx=end.x-anchor.x,dy=end.y-anchor.y;origin={x:anchor.x,y:anchor.y,yaw:Math.hypot(dx,dy)>.01?Math.atan2(dy,dx):(origin?.yaw||0)};previewOrigin=null;
    }else if(end&&mode){const box=bounds(anchor,end);if(box.x_max-box.x_min>.001&&box.y_max-box.y_min>.001){if(mode==='crop')crop=box;else if(erase.length<100)erase.push(box);}}
    const completed=mode==='origin'?origin:null;anchor=null;mode=null;previewBox=null;controls.enabled=true;renderer.domElement.style.cursor='';drawSelections();if(completed)onOrigin?.(completed);
  });
  renderer.domElement.addEventListener('pointercancel',()=>{anchor=null;mode=null;previewBox=null;previewOrigin=null;controls.enabled=true;renderer.domElement.style.cursor='';drawSelections();});
  let onOrigin;
  return {
    resize,clear,fit,load,setZRange,clearBoxes,
    setOrigin(value){if(!value||![value.x,value.y,value.yaw].every(Number.isFinite)){origin=null;drawSelections();return false;}origin={x:value.x,y:value.y,yaw:value.yaw};drawSelections();return true;},
    clearOrigin(){origin=null;previewOrigin=null;drawSelections();},
    drawOrigin(callback){if(!points)return;fit();onOrigin=callback;mode='origin';controls.enabled=false;renderer.domElement.style.cursor='crosshair';},
    drawBox(kind){if(!points)return;fit();mode=kind;controls.enabled=false;renderer.domElement.style.cursor='crosshair';},
    selection(){return {...(crop?{crop}:{}),erase:erase.map(b=>({...b})),...(origin?{origin:{...origin}}:{})};}
  };
}
