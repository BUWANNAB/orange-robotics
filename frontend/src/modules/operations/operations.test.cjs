const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const SHA256 = require('./sha256-worker.js');
const Monitor = require('./monitor.js');

test('incremental SHA256 matches Node across block and chunk boundaries', () => {
  for (const size of [0,1,55,56,63,64,65,1000,3145729]) {
    const data = crypto.randomBytes(size), hash = new SHA256();
    for(let offset=0;offset<size;offset+=113) hash.update(data.subarray(offset,offset+113));
    assert.equal(hash.digest(),crypto.createHash('sha256').update(data).digest('hex'));
  }
});

test('monitor discards old frames and replaces full snapshots', () => {
  const updates=[], monitor=new Monitor({},value=>updates.push(value),()=>{});
  monitor.apply({seq:2,data:{robots:[{id:1}]}});
  monitor.apply({seq:1,data:{robots:[{id:2}]}});
  monitor.apply({seq:3,data:{robots:[]}});
  assert.equal(updates.length,2);assert.deepEqual(updates[1].robots,[]);
});

test('monitor fallback, reconnect and cleanup do not leak timers or sockets', async () => {
  const originals={};const timers=new Map(),listeners=new Map(),sockets=[];let next=0,polls=0;
  for(const name of ['setInterval','clearInterval','setTimeout','clearTimeout','WebSocket','location','localStorage','addEventListener','removeEventListener']) originals[name]=globalThis[name];
  globalThis.setInterval=globalThis.setTimeout=callback=>{timers.set(++next,callback);return next;};
  globalThis.clearInterval=globalThis.clearTimeout=id=>timers.delete(id);
  globalThis.addEventListener=(name,fn)=>listeners.set(name,fn);globalThis.removeEventListener=name=>listeners.delete(name);
  globalThis.location={protocol:'http:',host:'localhost'};globalThis.localStorage={getItem:()=> 'test-token'};
  globalThis.WebSocket=class {
    constructor(){this.readyState=0;sockets.push(this);}
    send(value){this.lastSent=JSON.parse(value);}
    close(){this.readyState=3;this.onclose?.();}
  };
  try {
    const statuses=[],monitor=new Monitor({get:async()=>{polls++;return {seq:polls,data:{robots:[]}};}},()=>{},value=>statuses.push(value));
    monitor.start();await Promise.resolve();await Promise.resolve();
    assert.equal(polls,1);assert.equal(sockets.length,1);
    const socket=sockets[0];socket.readyState=1;socket.onopen();assert.equal(socket.lastSent.token,'test-token');
    socket.onmessage({data:JSON.stringify({seq:10,topic:'robot.status',data:{robots:[]}})});
    assert.equal(statuses.at(-1),'open');
    timers.get(monitor.timer)();assert.equal(polls,1);
    socket.close();await Promise.resolve();await Promise.resolve();assert.equal(polls,2);
    timers.get(monitor.retry)();assert.equal(sockets.length,2);
    monitor.stop();assert.equal(listeners.size,0);assert.equal(sockets[1].readyState,3);
    assert.equal(timers.has(monitor.timer),false);assert.equal(timers.has(monitor.retry),false);
  } finally {for(const [name,value] of Object.entries(originals)){if(value===undefined)delete globalThis[name];else globalThis[name]=value;}}
});
