const test=require('node:test');
const assert=require('node:assert/strict');
const {decode}=require('./pgm.js');
const input=(header,pixels)=>Uint8Array.from([...Buffer.from(header),...pixels]).buffer;
test('P5 comments and whitespace-valued first pixels retain orientation and values',()=>{
  const map=decode(input('P5\n# coordinate preserving map\n2 2\n255\n',[10,32,205,255]));
  assert.equal(map.width,2);assert.equal(map.height,2);
  assert.deepEqual([...map.pixels],[10,32,205,255]);
});
test('P5 CRLF header and lower max values decode correctly',()=>{
  assert.deepEqual([...decode(input('P5\r\n2 1\r\n15\r\n',[0,15])).pixels],[0,255]);
});
test('reject truncated, enormous and unsupported rasters',()=>{
  for(const [header,pixels] of [['P5\n2 2\n255\n',[0]],['P5\n100000 100000\n255\n',[]],['P2\n1 1\n255\n',[0]],['P5\n1 1\n65535\n',[0,0]]])assert.throws(()=>decode(input(header,pixels)));
});
