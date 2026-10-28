(function(root){
  function createStore(api, changed=()=>{}){
    const state={maps:[],mapId:null,data:null,loading:false,error:'',tab:'points',page:1,keyword:'',type:'',selected:null};
    let request=0;
    async function select(id,sequence=++request){
      if(sequence!==request)return;
      state.mapId=id?Number(id):null;state.data=null;state.selected=null;state.page=1;state.keyword='';state.type='';state.error='';state.loading=!!id;changed(state);
      if(!id)return;
      try{const data=await api.get(`/api/maps/${Number(id)}/resources`);if(sequence!==request)return;state.data=data;}
      catch(error){if(sequence!==request)return;state.error=error.message;}
      finally{if(sequence===request){state.loading=false;changed(state);}}
    }
    async function load(preferred){
      const sequence=++request;
      state.loading=true;state.error='';state.data=null;changed(state);
      try{
        const maps=[];let pageNo=1,total=Infinity;
        while(maps.length<total){const page=await api.get('/api/maps',{pageNo,pageSize:100});if(sequence!==request)return sequence;maps.push(...page.list);total=page.total;if(!page.list.length)break;pageNo++;}
        state.maps=maps;const row=maps.find(row=>String(row.id)===String(preferred))||maps[0];await select(row?.id,sequence);
      }catch(error){if(sequence===request){state.error=error.message;state.loading=false;changed(state);}}
      return sequence;
    }
    async function refresh(){const mapId=state.mapId,keyword=state.keyword,type=state.type,page=state.page,selected=state.selected,sequence=await load(mapId);if(request!==sequence||state.mapId!==mapId)return;state.keyword=keyword;state.type=type;state.page=page;state.selected=selected;changed(state);}
    return {state,select,load,refresh};
  }
  function rows(state){
    const data=state.data;if(!data)return [];
    const all=state.tab==='plans'?data.plans:state.tab==='versions'?data.versions:state.tab==='files'?data.files:data.document[state.tab];
    const keyword=state.keyword.trim().toLowerCase();
    return (all||[]).filter(row=>(!state.type||row.type===state.type||row.resource_status===state.type)&&(!keyword||[row.code,row.name,row.start,row.end,row.start_point,row.operator,row.version].some(value=>String(value??'').toLowerCase().includes(keyword))));
  }
  const exported={createStore,rows};if(typeof module!=='undefined')module.exports=exported;else root.MapResourceStore=exported;
})(typeof window!=='undefined'?window:globalThis);
