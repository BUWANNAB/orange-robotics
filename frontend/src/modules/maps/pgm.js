/* P5 raster decoder, shared by localization and its format tests. */
(function(root){
  const occupied=[31,48,64],free=[248,250,252];
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
  function colorizeValue(value,rgba,offset){
    if(value===205){rgba[offset]=rgba[offset+1]=rgba[offset+2]=rgba[offset+3]=0;return;}
    const ratio=value/255;
    for(let channel=0;channel<3;channel++)rgba[offset+channel]=Math.round(occupied[channel]+(free[channel]-occupied[channel])*ratio);
    rgba[offset+3]=255;
  }
  function colorizeInto(pixels,rgba){
    if(rgba.length<pixels.length*4)throw Error('RGBA 缓冲区太小');
    for(let i=0;i<pixels.length;i++)colorizeValue(pixels[i],rgba,i*4);
    return rgba;
  }
  function colorize(pixels){return colorizeInto(pixels,new Uint8ClampedArray(pixels.length*4));}
  function colorizeImageData(imageData){
    const data=imageData.data;
    for(let offset=0;offset<data.length;offset+=4){
      if(data[offset+3]&&data[offset]===data[offset+1]&&data[offset+1]===data[offset+2])colorizeValue(data[offset],data,offset);
    }
    return imageData;
  }
  root.MapRaster={decode,colorize,colorizeInto,colorizeImageData};
  if(typeof module!=='undefined')module.exports={decode,colorize,colorizeInto,colorizeImageData};
})(typeof window==='undefined'?globalThis:window);
