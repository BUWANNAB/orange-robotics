const test=require('node:test'),assert=require('node:assert/strict');
const {createStore,rows}=require('../src/modules/maps/resource-store.js');
const data=name=>({map:{name},document:{points:[{code:'A',name,type:'station'}],paths:[],areas:[]},plans:[],versions:[],files:[]});
test('resource inventory follows only the selected map and rejects late responses',async()=>{
  const pending=new Map(),store=createStore({get:path=>new Promise((resolve,reject)=>pending.set(path,{resolve,reject}))});
  const first=store.select(1),second=store.select(2);
  pending.get('/api/maps/2/resources').resolve(data('B'));await second;
  pending.get('/api/maps/1/resources').resolve(data('A'));await first;
  assert.equal(store.state.mapId,2);assert.equal(rows(store.state)[0].name,'B');
});
test('switching maps clears stale selections and failed requests do not expose old rows',async()=>{
  const store=createStore({get:async path=>{if(path.includes('/2/'))throw Error('离线');return data('A');}});
  await store.select(1);store.state.selected='A';store.state.keyword='A';store.state.type='station';store.state.page=9;
  await store.select(2);assert.equal(store.state.selected,null);assert.deepEqual(rows(store.state),[]);assert.equal(store.state.error,'离线');assert.equal(store.state.keyword,'');assert.equal(store.state.page,1);
});
test('resource search and type filters apply within the current document',()=>{
  const state={data:data('收货口'),tab:'points',keyword:'收货',type:'station'};
  assert.equal(rows(state).length,1);state.type='waiting';assert.equal(rows(state).length,0);
});

test('a late refresh cannot restore another maps search filters',async()=>{
  let resolveRefresh;
  const store=createStore({get:async path=>path==='/api/maps'?{list:[{id:1},{id:2}],total:2}:path.includes('/1/')?new Promise(resolve=>{resolveRefresh=resolve;}):data('B')});
  store.state.mapId=1;store.state.keyword='old';
  const refresh=store.refresh();await Promise.resolve();await Promise.resolve();await store.select(2);resolveRefresh(data('A'));await refresh;
  assert.equal(store.state.keyword,'');assert.equal(rows(store.state)[0].name,'B');
});
test('initial selection uses the main workspace map and inventory spans API pages',async()=>{
  const calls=[],store=createStore({get:async(path,params)=>{calls.push(path);return path==='/api/maps'?(params.pageNo===1?{list:[{id:1}],total:2}:{list:[{id:2}],total:2}):data('B');}});
  await store.load('2');assert.equal(store.state.mapId,2);assert.equal(store.state.maps.length,2);assert.equal(calls.at(-1),'/api/maps/2/resources');
});
test('old entry redirects to real resources and never boots the mock CRUD page',()=>{
  const fs=require('node:fs'),html=fs.readFileSync('frontend/src/modules/data-admin/data_admin.html','utf8');
  assert.match(html,/map-resources.html/);assert.doesNotMatch(html,/mock-api|js\/index.js/);
  const sidebar=JSON.parse(fs.readFileSync('frontend/src/config/sidebar.json','utf8'));assert.equal(sidebar.sidebar.find(row=>row.id==='dataAdmin').title,'地图资源');
  assert.doesNotMatch(fs.readFileSync('frontend/index.html','utf8'),/ros2\/plcstart/,'viewing maps must not request PLC startup');
});


test('refresh retries a failed map inventory instead of clearing the error into an empty list',async()=>{
  let offline=true;const calls=[];
  const store=createStore({get:async path=>{calls.push(path);if(offline)throw Error('清单离线');return path==='/api/maps'?{list:[{id:7}],total:1}:data('恢复地图');}});
  await store.load();assert.equal(store.state.error,'清单离线');assert.equal(store.state.mapId,null);
  await store.refresh();assert.equal(store.state.error,'清单离线');
  offline=false;await store.refresh();
  assert.equal(calls.filter(path=>path==='/api/maps').length,3);
  assert.equal(store.state.mapId,7);assert.equal(rows(store.state)[0].name,'恢复地图');assert.equal(store.state.error,'');
});

test('refresh updates the map selector and retains filters only for the same surviving map',async()=>{
  let maps=[{id:1}];
  const store=createStore({get:async path=>path==='/api/maps'?{list:maps,total:maps.length}:data('A')});
  await store.load(1);Object.assign(store.state,{keyword:'A',type:'station',page:3,selected:'A'});
  maps=[{id:1},{id:2}];await store.refresh();
  assert.equal(store.state.maps.length,2);assert.equal(store.state.mapId,1);assert.equal(store.state.keyword,'A');assert.equal(store.state.selected,'A');
  maps=[{id:2}];await store.refresh();
  assert.equal(store.state.mapId,2);assert.equal(store.state.keyword,'');assert.equal(store.state.selected,null);
});

test('a late map inventory cannot replace a user-selected map',async()=>{
  let resolve;
  const store=createStore({get:async path=>path==='/api/maps'?new Promise(done=>{resolve=done;}):data('chosen')});
  const load=store.load(1);await store.select(2);resolve({list:[{id:1}],total:1});await load;
  assert.equal(store.state.mapId,2);assert.equal(rows(store.state)[0].name,'chosen');
});
