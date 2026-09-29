/* P5 raster decoder, shared by localization and its format tests. */
(function(root){
  function decode(buffer){
    const bytes=new Uint8Array(buffer);let offset=0;
    const whitespace=v=>v===32||v===9||v===10||v===13;
    function token(){
      while(offset<bytes.length){if(whitespace(bytes[offset])){offset++;continue;}if(bytes[offset]===35){while(offset<bytes.length&&bytes[offset]!==10)offset++;continue;}break;}
      const start=offset;while(offset<bytes.length&&!whitespace(bytes[offset]))offset++;
      return new TextDecoder().decode(bytes.subarray(start,offset));
    }
    const magic=token(),width=Number(token()),height=Number(token()),max=Number(token());
    if(magic!=='P5'||!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>40000000||!Number.isInteger(max)||max<1||max>255)throw Error('栅格需要有效的 8 位 P5 PGM');
    // Consume the header separator only: a first pixel may itself be whitespace.
    if(!whitespace(bytes[offset]))throw Error('PGM 文件头分隔符无效');
    if(bytes[offset]===13&&bytes[offset+1]===10)offset+=2;else offset++;
    if(bytes.length-offset<width*height)throw Error('PGM 像素数据不完整');
    const pixels=new Uint8ClampedArray(width*height);
    for(let i=0;i<pixels.length;i++)pixels[i]=bytes[offset+i]*255/max;
    return {width,height,pixels};
  }
  root.MapRaster={decode};
  if(typeof module!=='undefined')module.exports={decode};
})(typeof window==='undefined'?globalThis:window);
