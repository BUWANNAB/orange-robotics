const test=require('node:test');
const assert=require('node:assert/strict');
const {open}=require('../src/modules/operations/draft-recovery.js');

function memoryStorage(){
  const values=new Map();
  return {
    get length(){return values.size;},
    key:index=>Array.from(values.keys())[index],
    getItem:key=>values.get(key)??null,
    setItem:(key,value)=>values.set(key,value),
    removeItem:key=>values.delete(key)
  };
}
const map={id:3,name:'测试地图',created_at:'2026-11-07T10:00:00'};
const draft=code=>({points:[{code}],paths:[],areas:[]});

test('local draft is isolated by account, map and map creation identity',()=>{
  const storage=memoryStorage();
  assert.equal(open(storage,'user',map,'first').write(draft('A'),2),true);
  assert.equal(open(storage,'user',map,'reopen').list()[0].document.points[0].code,'A');
  assert.equal(open(storage,'admin',map,'second').list().length,0);
  assert.equal(open(storage,'user',{...map,id:5},'second').list().length,0);
  assert.equal(open(storage,'user',{...map,created_at:'later'},'second').list().length,0);
});

test('saving in one tab cannot clear a second tab or a newer copy',()=>{
  const storage=memoryStorage(),first=open(storage,'user',map,'first'),second=open(storage,'user',map,'second');
  first.write(draft('A'),2);
  const [old]=second.list();
  first.write(draft('B'),3);
  second.remove(old);
  assert.equal(second.list()[0].revision,3);
  second.write(draft('C'),3);
  first.remove();
  assert.equal(open(storage,'user',map,'third').list()[0].document.points[0].code,'C');
});

test('blocked storage reports that local recovery is unavailable',()=>{
  const storage=memoryStorage();
  storage.setItem=()=>{throw Error('QuotaExceededError');};
  const session=open(storage,'user',map,'first');
  assert.equal(session.write(draft('A'),2),false);
  assert.deepEqual(session.list(),[]);
});
