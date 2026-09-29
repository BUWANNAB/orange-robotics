import asyncio
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse
from pydantic import BaseModel,Field,ConfigDict,model_validator
from app.config import settings
from app.common.response import ok
from app.services.operations_common import require
from app.services import map_assets as assets
from app.services import mapping_control as mapping

router=APIRouter(prefix='/api/map-workbench',tags=['Map workbench'])


from app.database import get_db
from app.models.operations import MapDocument, MapVersion
from app.services import map_bindings
from app.services.operations_common import audit
from sqlalchemy import select


class BindingInput(BaseModel):
    model_config=ConfigDict(extra='forbid')
    key:str=Field(min_length=1,max_length=256)
    map_id:int|None=Field(default=None,gt=0)
    version:int|None=Field(default=None,gt=0)
    revision:str
    coordinates_confirmed:bool=False


@router.get('/bindings')
async def bindings(actor=Depends(require('map:view')),db=Depends(get_db)):
    from app.api.localization import catalog
    from app.services.ros2_service import ros2_service as bridge
    rows=(await db.scalars(select(MapDocument).where(MapDocument.deleted==False).order_by(MapDocument.name))).all()
    return ok({'revision':map_bindings.revision(),'entries':catalog(),
               'maps':[{'id':r.id,'name':r.name,'published_version':r.published_version} for r in rows],
               'active':dict(bridge.switch)})


@router.post('/bindings')
async def bind(body:BindingInput,actor=Depends(require('map:edit')),db=Depends(get_db)):
    from app.api.localization import catalog
    async with map_bindings.lock:
        if body.revision!=map_bindings.revision():raise HTTPException(409,'绑定已被其他操作修改，请刷新后重试')
        if not any(r['key']==body.key for r in catalog()):raise HTTPException(404,'定位点云不存在，请刷新地图列表')
        if body.map_id is not None:
            if not body.coordinates_confirmed:raise HTTPException(400,'请核对点云与线路地图使用相同坐标原点、方向和米制单位')
            row=await db.get(MapDocument,body.map_id)
            if not row or row.deleted:raise HTTPException(404,'线路地图不存在')
            if not row.published_version or row.published_version!=body.version:
                raise HTTPException(409,'请选择线路地图当前已发布版本；草稿不能绑定')
            version=await db.scalar(select(MapVersion).where(MapVersion.map_id==row.id,MapVersion.version==body.version))
            if not version:raise HTTPException(409,'发布版本不存在')
        elif body.version is not None:raise HTTPException(400,'解除绑定时不能指定版本')
        map_bindings.save(body.key,{'map_id':body.map_id,'version':body.version})
        audit(db,actor,'map',f'定位地图绑定 {body.key}: map_id={body.map_id}, version={body.version}；下次重定位生效')
        await db.commit()
        return ok({'revision':map_bindings.revision()},message='绑定已保存；下次重定位成功后生效，当前运行地图不变')


class Box(BaseModel):
    model_config=ConfigDict(allow_inf_nan=False,extra='forbid')
    x_min:float
    x_max:float
    y_min:float
    y_max:float
    @model_validator(mode='after')
    def ordered(self):
        if self.x_min>=self.x_max or self.y_min>=self.y_max:raise ValueError('选区最小值必须小于最大值')
        return self


class Process(BaseModel):
    model_config=ConfigDict(allow_inf_nan=False,extra='forbid')
    source:str
    output:str
    z_min:float=0.1
    z_max:float=2.
    resolution:float=Field(default=.05,ge=.01,le=1)
    denoise:bool=True
    radius:float=Field(default=.2,gt=0,le=5)
    neighbors:int=Field(default=3,ge=1,le=128)
    crop:Box|None=None
    erase:list[Box]=Field(default_factory=list,max_length=100)
    @model_validator(mode='after')
    def valid(self):
        assets.identity(self.source);assets.identity(self.output)
        if self.source==self.output:raise ValueError('处理结果必须保存为新地图')
        if self.z_min>=self.z_max:raise ValueError('高度下限必须小于上限')
        return self


@router.get('/assets')
async def listing(actor=Depends(require('map:view'))):
    return ok(await asyncio.to_thread(assets.listing))


@router.get('/file/{kind}/{key:path}')
async def file(kind:str,key:str,actor=Depends(require('map:view'))):
    if kind not in {'pcd','pgm','yaml'}:raise HTTPException(404,'文件类型不存在')
    try:
        path=(assets.path_in(settings.PCD_DIR,key)/'GlobalMap.pcd' if kind=='pcd' else assets.path_in(settings.MAPS_DIR,key)/'setting'/('map.'+kind))
    except ValueError as exc:raise HTTPException(400,str(exc)) from exc
    root=settings.PCD_DIR if kind=='pcd' else settings.MAPS_DIR
    if not path.resolve().is_relative_to(root.resolve()):raise HTTPException(400,'地图路径越界')
    if not path.is_file():raise HTTPException(404,'地图文件不存在')
    return FileResponse(path,filename=path.name)


@router.post('/grid')
async def grid(asset_id:str=Form(...),revision:str|None=Form(None),create_only:bool=Form(False),
               pgm:UploadFile=File(...),metadata:UploadFile=File(...),actor=Depends(require('map:edit'))):
    pgm_data=await pgm.read(80*1024*1024+1);yaml_data=await metadata.read(65537)
    try:
        async with assets.processor_lock:
            if not create_only and assets.asset(asset_id)['grid'] and revision is None:
                raise ValueError('覆盖地图需要加载时的 revision，请重新加载地图')
            result=await asyncio.to_thread(assets.write_grid,asset_id,pgm_data,yaml_data,revision,create_only)
        return ok(result)
    except (ValueError,OSError,TypeError) as exc:raise HTTPException(409,str(exc)) from exc


@router.post('/process')
async def process(body:Process,actor=Depends(require('map:edit'))):
    try:
        assets.processor_command()
        if not assets.asset(body.source)['pcd']:raise ValueError('源点云不存在')
        if assets.path_in(settings.PCD_DIR,body.output).exists() or assets.path_in(settings.MAPS_DIR,body.output).exists():raise ValueError('输出地图名称已存在')
    except ValueError as exc:raise HTTPException(409,str(exc)) from exc
    return ok(assets.submit('process',lambda job:assets.process(job,body.model_dump(exclude_none=True))),message='处理任务已排队')


@router.get('/jobs/{job_id}')
async def job(job_id:str,actor=Depends(require('map:view'))):
    try:return ok(assets.job_status(job_id))
    except (ValueError,FileNotFoundError) as exc:raise HTTPException(404,str(exc)) from exc


@router.get('/mapping')
async def status(actor=Depends(require('map:view'))):return ok(mapping.snapshot())


class SaveMapping(BaseModel):
    name:str=Field(min_length=1,max_length=64,pattern=r'^[a-zA-Z0-9_-]+$')


@router.post('/mapping/start')
async def start(actor=Depends(require('map:edit'))):
    if mapping.lock.locked() or any(j for j in assets.tasks):raise HTTPException(409,'已有地图任务正在处理')
    try:mapping.bridge.require_stationary()
    except RuntimeError as exc:raise HTTPException(409,str(exc)) from exc
    return ok(assets.submit('mapping-start',mapping.start))


@router.post('/mapping/save')
async def save(body:SaveMapping,actor=Depends(require('map:edit'))):
    if mapping.lock.locked() or assets.tasks:raise HTTPException(409,'已有地图任务正在处理')
    if assets.path_in(settings.PCD_DIR,body.name).exists() or assets.path_in(settings.MAPS_DIR,body.name).exists():raise HTTPException(409,'地图名称已存在')
    try:mapping.bridge.require_ros()
    except RuntimeError as exc:raise HTTPException(409,str(exc)) from exc
    return ok(assets.submit('mapping-save',lambda job:mapping.finish(job,body.name)))


@router.post('/mapping/stop')
async def stop(actor=Depends(require('map:edit'))):
    if mapping.lock.locked() or assets.tasks:raise HTTPException(409,'已有地图任务正在处理')
    try:mapping.bridge.require_ros()
    except RuntimeError as exc:raise HTTPException(409,str(exc)) from exc
    return ok(assets.submit('mapping-stop',mapping.finish))
