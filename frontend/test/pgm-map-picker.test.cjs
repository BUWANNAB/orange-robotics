const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('frontend/src/modules/operations/operations.js','utf8');
const functions=source.slice(0,source.indexOf("  $('nav').onclick="))+
  'openMap=async row=>{window.opened=row;};load=async()=>{};window.pgmTest={state,existingPgmForm};})();';
const grid={id:'车间一层',grid:true,resolution:.05,origin:[1,2,0]};

function harness(initial=[]){
  const elements=new Map(),calls=[],window={};
  const element=id=>{
    if(!elements.has(id))elements.set(id,{innerHTML:'',textContent:'',value:'',files:[],disabled:false,open:false});
    return elements.get(id);
  };
  element('dialog').showModal=()=>{element('dialog').open=true;};
  element('dialog').close=()=>{element('dialog').open=false;};
  class FormData{
    constructor(form){this.values=new Map(form?[['asset_key',element('pgm-asset-select').value]]:[]);}
    append(key,value){this.values.set(key,value);}
    get(key){return this.values.get(key);}
  }
  let inventory=initial;
  window.OpsAPI={
    get:async path=>{calls.push({path});if(inventory instanceof Error)throw inventory;return inventory;},
    post:async(path,body)=>{calls.push({path,body});return {id:7,draft:{asset_id:body.asset_id}};},
    form:async(path,body)=>{calls.push({path,body});inventory=[grid];return grid;}
  };
  vm.runInNewContext(functions,{window,document:{getElementById:element},location:{search:'',origin:'http://localhost'},URLSearchParams,FormData,Set,Map,Date,Math});
  return {window,element,calls,setInventory:value=>{inventory=value;}};
}

test('PGM entry selects generated grids and opens the existing route-map workflow',async()=>{
  const h=harness([grid,{id:'仅点云',grid:false}]);
  await h.window.pgmTest.existingPgmForm();
  assert.equal(h.element('dialog-title').textContent,'选择已有 PGM 地图');
  assert.match(h.element('pgm-asset-select').innerHTML,/车间一层/);
  assert.doesNotMatch(h.element('pgm-asset-select').innerHTML,/仅点云|新建空白/);
  assert.equal(h.element('pgm-asset-select').value,grid.id);
  assert.equal(h.element('dialog-submit').disabled,false);
  await h.element('dialog-form').onsubmit({target:h.element('dialog-form'),preventDefault(){}});
  assert.equal(h.calls.at(-1).path,'/api/map-workbench/route-map');
  assert.equal(h.calls.at(-1).body.asset_id,grid.id);
  assert.equal(h.window.opened.id,7);
  assert.equal(h.element('dialog').open,false);
});

test('empty inventories explain the missing maps and can be refreshed without reopening',async()=>{
  const h=harness();
  await h.window.pgmTest.existingPgmForm();
  assert.equal(h.element('dialog-submit').disabled,true);
  assert.match(h.element('pgm-assets-status').textContent,/当前服务没有找到/);
  h.setInventory([grid]);
  await h.element('pgm-assets-refresh').onclick();
  assert.equal(h.element('pgm-asset-select').value,grid.id);
  assert.equal(h.element('dialog-submit').disabled,false);
});

test('list failures remain visible and retry can recover with escaped map names',async()=>{
  const h=harness(new Error('地图读取失败'));
  await h.window.pgmTest.existingPgmForm();
  assert.match(h.element('pgm-assets-status').textContent,/地图读取失败/);
  assert.equal(h.element('pgm-assets-refresh').disabled,false);
  h.setInventory([{...grid,id:'<script>bad</script>'}]);
  await h.element('pgm-assets-refresh').onclick();
  assert.match(h.element('pgm-asset-select').innerHTML,/&lt;script&gt;/);
  assert.doesNotMatch(h.element('pgm-asset-select').innerHTML,/<script>/);
});

test('PGM import requires its YAML, prevents overwrite, and selects the uploaded map',async()=>{
  const h=harness();
  await h.window.pgmTest.existingPgmForm();
  h.element('pgm-import-name').value=grid.id;
  h.element('pgm-import-file').files=[{name:'map.pgm',size:20}];
  await h.element('pgm-import-submit').onclick();
  assert.match(h.element('dialog-error').textContent,/配套 YAML/);
  assert.equal(h.calls.filter(call=>call.path==='/api/map-workbench/grid').length,0);
  h.element('pgm-import-yaml').files=[{name:'map.yaml',size:40}];
  await h.element('pgm-import-submit').onclick();
  const upload=h.calls.find(call=>call.path==='/api/map-workbench/grid');
  assert.equal(upload.body.get('create_only'),'true');
  assert.equal(upload.body.get('asset_id'),grid.id);
  assert.equal(h.element('pgm-asset-select').value,grid.id);
  assert.equal(h.element('dialog-submit').disabled,false);
});

test('a late refresh cannot replace a newer map inventory',async()=>{
  const h=harness([grid]);
  await h.window.pgmTest.existingPgmForm();
  let resolveOld;
  h.window.OpsAPI.get=()=>new Promise(resolve=>{resolveOld=resolve;});
  const older=h.element('pgm-assets-refresh').onclick();
  h.window.OpsAPI.get=async()=>[{...grid,id:'最新地图'}];
  await h.element('pgm-assets-refresh').onclick();
  resolveOld([grid]);await older;
  assert.equal(h.element('pgm-asset-select').value,'最新地图');
  assert.doesNotMatch(h.element('pgm-asset-select').innerHTML,/车间一层/);
});
