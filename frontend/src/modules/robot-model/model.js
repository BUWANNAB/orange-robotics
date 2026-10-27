import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';

const $=id=>document.getElementById(id),api=window.OpsAPI,form=$('model-form'),viewport=$('model-viewport');
let data,saved,renderer,scene,camera,controls,robot,animation,resizeObserver;
const notice=(message,error=false)=>{$('model-notice').textContent=message;$('model-notice').classList.toggle('error',error);};
function collect(){
  const body={};for(const key of ['length','width','height','center_x','center_y','center_z']){
    const input=form.elements.namedItem(key),value=Number(input.value);
    if(!input.value.trim()||!Number.isFinite(value)||!input.checkValidity())throw new Error('请填写有效的车体尺寸和中心偏移');
    body[key]=value;
  }
  return {base_frame:'base_link',dimensions_confirmed:$('dimensions-confirmed').checked,body};
}
function fill(model){for(const [key,value] of Object.entries(model.body))form.elements.namedItem(key).value=value;$('dimensions-confirmed').checked=model.dimensions_confirmed;}
function dispose(group){group.traverse(object=>{object.geometry?.dispose();const materials=Array.isArray(object.material)?object.material:[object.material];for(const material of materials)material?.dispose();});}
function axes(group,length){
  for(const [direction,color] of [[new THREE.Vector3(1,0,0),0xd44236],[new THREE.Vector3(0,1,0),0x248d4c],[new THREE.Vector3(0,0,1),0x326fdb]]){
    const arrow=new THREE.ArrowHelper(direction,new THREE.Vector3(),length,color,.09,.045);
    arrow.traverse(object=>{if(object.material){object.material.depthTest=false;object.material.depthWrite=false;object.renderOrder=2;}});
    group.add(arrow);
  }
}
function drawModel(){
  if(!data||!scene)return;
  const model=collect(),b=model.body;
  if(robot){scene.remove(robot);dispose(robot);}
  robot=new THREE.Group();scene.add(robot);
  const body=new THREE.Mesh(new THREE.BoxGeometry(b.length,b.width,b.height),new THREE.MeshStandardMaterial({color:0xee792b,transparent:true,opacity:.65,roughness:.65}));
  body.position.set(b.center_x,b.center_y,b.center_z);robot.add(body);
  const edges=new THREE.LineSegments(new THREE.EdgesGeometry(body.geometry),new THREE.LineBasicMaterial({color:0x9d5428}));edges.position.copy(body.position);robot.add(edges);
  const origin=new THREE.Mesh(new THREE.SphereGeometry(.03,16,12),new THREE.MeshBasicMaterial({color:0x263e54}));robot.add(origin);
  axes(robot,Math.max(.65,Math.max(b.length,b.width)*.7));
  if(data.mount){
    const lidar=new THREE.Group();lidar.position.fromArray(data.mount.translation);lidar.quaternion.fromArray(data.mount.quaternion);robot.add(lidar);
    const sensor=new THREE.Mesh(new THREE.CylinderGeometry(.065,.065,.07,24),new THREE.MeshStandardMaterial({color:0x263e54}));
    sensor.rotation.x=Math.PI/2;sensor.position.z=.035;lidar.add(sensor);axes(lidar,.3);
    const line=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),lidar.position.clone()]);
    robot.add(new THREE.Line(line,new THREE.LineDashedMaterial({color:0x6e8292,dashSize:.04,gapSize:.025})));
    robot.children.at(-1).computeLineDistances();
  }
  robot.rotation.z=Number($('preview-yaw').value)*Math.PI/180;
  $('model-status').textContent=model.dimensions_confirmed?'已填写实测尺寸':'未标定 · 示意模型';
  $('model-status').classList.toggle('confirmed',model.dimensions_confirmed);
}
function fit(){
  if(!robot)return;
  const box=new THREE.Box3().setFromObject(robot),center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3()).length();
  controls.target.copy(center);camera.position.copy(center).add(new THREE.Vector3(.85,-1.15,.85).multiplyScalar(Math.max(size,1)));camera.near=.01;camera.far=Math.max(200,size*20);camera.updateProjectionMatrix();controls.update();
}
function mountText(){
  $('mount-status').textContent=data.mount?`X ${data.mount.translation[0].toFixed(3)} m · Y ${data.mount.translation[1].toFixed(3)} m · Z ${data.mount.translation[2].toFixed(3)} m\nRoll / Pitch / Yaw：${data.mount.rpy.map(value=>(value*180/Math.PI).toFixed(1)+'°').join(' / ')}${data.mount_pending?'\n安装配置有待验证的修改。':''}`:'未配置安装外参，暂不绘制雷达位置。';
  $('tf-notes').replaceChildren(...data.tf_notes.map(text=>{const p=document.createElement('p');p.textContent=text;return p;}));
}
function initScene(){
  renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});renderer.setPixelRatio(Math.min(devicePixelRatio,2));viewport.appendChild(renderer.domElement);
  scene=new THREE.Scene();scene.background=new THREE.Color(0xf8fafb);
  camera=new THREE.PerspectiveCamera(42,1,.01,200);camera.up.set(0,0,1);
  controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;
  scene.add(new THREE.HemisphereLight(0xffffff,0x788894,2));const light=new THREE.DirectionalLight(0xffffff,2);light.position.set(2,-3,5);scene.add(light);
  const grid=new THREE.GridHelper(20,40,0xd3dce4,0xe6ecf0);grid.rotation.x=Math.PI/2;grid.position.z=-.012;scene.add(grid);
  resizeObserver=new ResizeObserver(()=>{const width=viewport.clientWidth,height=viewport.clientHeight;renderer.setSize(width,height);camera.aspect=width/height;camera.updateProjectionMatrix();});resizeObserver.observe(viewport);
  function animate(){animation=requestAnimationFrame(animate);controls.update();renderer.render(scene,camera);}animate();
}
async function init(){
  data=await api.get('/api/robot-model');saved=structuredClone(data.model);fill(saved);mountText();
  const actor=await api.get('/api/operations/me');
  const canSave=actor.permissions.includes('*')||actor.permissions.includes('ros:maintain');
  $('save-model').disabled=!canSave;
  if(!canSave)$('save-model').textContent='当前账号仅可预览';
  try{initScene();drawModel();fit();}catch(error){viewport.textContent='三维预览不可用：'+error.message;viewport.classList.add('error-view');}
  if(!data.model.dimensions_confirmed)notice('当前为示意尺寸。测量车体和 base_link 原点后再勾选实测确认。');
}
form.addEventListener('input',event=>{
  if(event.target.name==='confirmation')return;
  form.elements.namedItem('confirmation').value='';
  if(event.target.type==='number')$('dimensions-confirmed').checked=false;
  try{drawModel();notice('预览已更新，尚未保存。');}catch(error){notice(error.message,true);}
});
$('preview-yaw').oninput=()=>{const value=Number($('preview-yaw').value);$('preview-yaw-value').textContent=value+'°';if(robot)robot.rotation.z=value*Math.PI/180;};
$('fit-model').onclick=fit;
$('check-tf').onclick=async()=>{
  const button=$('check-tf');button.disabled=true;
  try{const result=await api.get('/api/robot-model/runtime-check');$('tf-result').textContent=`实际父级：${result.parent_chain.join(' → ')}。雷达安装 TF：${result.mount_matches_tf===null?'缺少可比对数据':result.mount_matches_tf?'与配置一致':'与配置不一致'}；map → odom → base_link 链：${result.standard_chain?'层级正确':'尚未统一'}。${result.runtime_verified?'TF 数值及新鲜度检查通过。':'运行时坐标链未通过完整检查。'}${result.message}`;}catch(error){$('tf-result').textContent=error.message;}finally{button.disabled=false;}
};
$('reset-model').onclick=()=>{if(!saved)return;fill(saved);drawModel();fit();notice('已恢复已保存的模型。');};
form.onsubmit=async event=>{
  event.preventDefault();const button=$('save-model');button.disabled=true;
  try{if(form.elements.namedItem('confirmation').value.trim()!=='保存车体模型')throw new Error('请输入“保存车体模型”确认');data=await api.put('/api/robot-model',{model:collect(),confirmation:'保存车体模型'});saved=structuredClone(data.model);form.elements.namedItem('confirmation').value='';mountText();drawModel();parent.postMessage({type:'robot-model-updated'},location.origin);notice(data.shared_with_ros?'模型已保存。ROS 核心服务重启后读取相同模型；运行时 TF 仍需核对。':'模型已保存到本机。设备部署时需让 Web 与 ROS 共用 RCS_DATA_DIR。');}catch(error){notice(error.message,true);}finally{button.disabled=false;}
};
$('export-urdf').onclick=async()=>{try{const blob=await api.download('/api/robot-model/urdf');const url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download='orange_robot.urdf';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(error){notice(error.message,true);}};
window.addEventListener('pagehide',()=>{cancelAnimationFrame(animation);resizeObserver?.disconnect();controls?.dispose();if(robot)dispose(robot);renderer?.dispose();});
init().catch(error=>notice(error.message,true));
