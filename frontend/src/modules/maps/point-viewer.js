import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {PCDLoader} from 'three/addons/loaders/PCDLoader.js';

export function createViewer(host,onSelection){
  const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));host.appendChild(renderer.domElement);
  const scene=new THREE.Scene();scene.background=new THREE.Color('#edf2f5');
  const camera=new THREE.OrthographicCamera(-10,10,10,-10,.01,100000);camera.up.set(0,1,0);camera.position.set(0,0,100);
  const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=false;
  const boxes=new THREE.Group();scene.add(boxes);let points,crop=null,erase=[],mode=null,anchor=null,pointer=null,span=20,center=new THREE.Vector3(),height=100;
  const render=()=>renderer.render(scene,camera);controls.addEventListener('change',render);
  function resize(){if(!host.clientWidth||!host.clientHeight)return;renderer.setSize(host.clientWidth,host.clientHeight);const aspect=host.clientWidth/host.clientHeight;camera.left=-span*aspect/2;camera.right=span*aspect/2;camera.top=span/2;camera.bottom=-span/2;camera.updateProjectionMatrix();render();}
  new ResizeObserver(resize).observe(host);
  function clearBoxes(){crop=null;erase=[];mode=null;anchor=null;controls.enabled=true;drawSelections();}
  function clear(){if(points){scene.remove(points);points.geometry.dispose();points.material.dispose();points=null;}clearBoxes();render();}
  function fit(){if(!points)return;const bound=new THREE.Box3().setFromObject(points);bound.getCenter(center);const size=bound.getSize(new THREE.Vector3());span=Math.max(size.y,size.x/Math.max(.1,host.clientWidth/host.clientHeight),1)*1.15;height=Math.max(size.length()*2,100);camera.position.set(center.x,center.y,center.z+height);camera.up.set(0,1,0);camera.zoom=1;controls.target.copy(center);camera.lookAt(center);controls.update();resize();}
  function load(buffer){clear();points=new PCDLoader().parse(buffer,'');if(!points.geometry.getAttribute('position')?.count)throw new Error('PCD 没有有效点');points.material.color.set('#d56929');points.material.size=.07;points.material.sizeAttenuation=true;scene.add(points);fit();return points.geometry.getAttribute('position').count;}
  function xy(e){const rect=renderer.domElement.getBoundingClientRect(), ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1,1-(e.clientY-rect.top)/rect.height*2),camera);return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,0,1),0),new THREE.Vector3());}
  function rectangle(b,color){const z=center.z+1;const vertices=[b.x_min,b.y_min,z,b.x_max,b.y_min,z,b.x_max,b.y_max,z,b.x_min,b.y_max,z];const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));const line=new THREE.LineLoop(geometry,new THREE.LineBasicMaterial({color,depthTest:false}));line.renderOrder=10;boxes.add(line);}
  function drawSelections(preview){for(const child of [...boxes.children]){child.geometry.dispose();child.material.dispose();boxes.remove(child);}if(crop)rectangle(crop,'#16866d');erase.forEach(b=>rectangle(b,'#c13b30'));if(preview)rectangle(preview,mode==='crop'?'#16866d':'#c13b30');onSelection(`${crop?'1 个保留区域':'不限制 XY 范围'} · ${erase.length} 个删除区域`);render();}
  function bounds(a,b){return {x_min:Math.min(a.x,b.x),x_max:Math.max(a.x,b.x),y_min:Math.min(a.y,b.y),y_max:Math.max(a.y,b.y)};}
  renderer.domElement.addEventListener('pointerdown',e=>{if(!mode||e.button!==0)return;e.preventDefault();anchor=xy(e);pointer=e.pointerId;renderer.domElement.setPointerCapture(pointer);});
  renderer.domElement.addEventListener('pointermove',e=>{if(anchor&&e.pointerId===pointer){const end=xy(e);if(end)drawSelections(bounds(anchor,end));}});
  renderer.domElement.addEventListener('pointerup',e=>{if(!anchor||e.pointerId!==pointer)return;const end=xy(e);if(end){const box=bounds(anchor,end);if(box.x_max-box.x_min>.001&&box.y_max-box.y_min>.001){if(mode==='crop')crop=box;else if(erase.length<100)erase.push(box);}}anchor=null;mode=null;controls.enabled=true;drawSelections();});
  renderer.domElement.addEventListener('pointercancel',()=>{anchor=null;mode=null;controls.enabled=true;drawSelections();});
  return {resize,clear,fit,load,clearBoxes,drawBox(kind){if(!points)return;fit();mode=kind;controls.enabled=false;},selection(){return {...(crop?{crop}:{}),erase:erase.map(b=>({...b}))};}};
}
