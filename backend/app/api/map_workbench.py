import asyncio
import hashlib
import io
import re
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel,Field,ConfigDict,model_validator
from app.config import settings
from app.common.response import ok
from app.services.operations_common import require
from app.services import map_assets as assets
from app.services import mapping_control as mapping
import yaml

router=APIRouter(prefix='/api/map-workbench',tags=['Map workbench'])


from app.database import get_db
from app.models.operations import MapDocument, MapVersion
from app.services import map_bindings
from app.services import ros_runtime
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


class CoordinateOrigin(BaseModel):
    model_config=ConfigDict(allow_inf_nan=False,extra='forbid')
    x:float=Field(ge=-1000000,le=1000000)
    y:float=Field(ge=-1000000,le=1000000)
    yaw:float=Field(ge=-3.141592654,le=3.141592654)


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
    origin:CoordinateOrigin|None=None
    @model_validator(mode='after')
    def valid(self):
        assets.identity(self.source);assets.identity(self.output)
        if self.source==self.output:raise ValueError('处理结果必须保存为新地图')
        if self.z_min>=self.z_max:raise ValueError('高度下限必须小于上限')
        return self


@router.get('/assets')
async def listing(actor=Depends(require('map:view'))):
    return ok(await asyncio.to_thread(assets.listing))


class RouteMapInput(BaseModel):
    model_config=ConfigDict(extra='forbid')
    asset_id:str=Field(min_length=1,max_length=180)


@router.post('/route-map')
async def open_or_create_route_map(body:RouteMapInput,actor=Depends(require('map:edit')),db=Depends(get_db)):
    from app.api.map_editor import convert_image, image_directory
    from app.services.map_editor import MapData, acquire_lock, save_draft

    try:
        asset=await asyncio.to_thread(assets.asset,body.asset_id)
        if not asset['grid']:
            raise ValueError('此地图还没有 PGM/YAML 栅格；请先裁剪并生成二维地图')
        directory=assets.path_in(settings.MAPS_DIR,body.asset_id)/'setting'
        pgm_path=assets.checked_file(settings.MAPS_DIR,directory/'map.pgm')
        yaml_path=assets.checked_file(settings.MAPS_DIR,directory/'map.yaml')
        pgm_data,yaml_data=await asyncio.gather(
            asyncio.to_thread(pgm_path.read_bytes),asyncio.to_thread(yaml_path.read_bytes))
        await asyncio.to_thread(assets.validate_grid,pgm_data,yaml_data)
        if await asyncio.to_thread(assets.revision,directory)!=asset['revision']:
            raise ValueError('读取期间地图文件已更新，请刷新后重试')
        metadata=yaml.safe_load(yaml_data)
        origin=[float(value) for value in metadata['origin']]
        if abs(origin[2])>1e-6:
            raise ValueError('路线工作台暂不支持带旋转角的 PGM 原点')
        png,pixel_width,pixel_height=await asyncio.to_thread(convert_image,pgm_data)
        resolution=float(metadata['resolution'])
        if pixel_width*resolution>100000 or pixel_height*resolution>100000:
            raise ValueError('栅格地图实际宽高超过路线编辑器支持范围')
    except (ValueError,TypeError,KeyError,yaml.YAMLError,OSError) as exc:
        raise HTTPException(409,str(exc)) from exc

    digest=hashlib.sha256(png).hexdigest()
    documents=(await db.scalars(
        select(MapDocument).where(MapDocument.deleted==False).order_by(MapDocument.id.desc())
    )).all()
    row=next((item for item in documents
              if isinstance(item.draft,dict) and item.draft.get('asset_id')==body.asset_id),None)
    if row is None:
        legacy=map_bindings.read().get(body.asset_id,{})
        legacy_id=legacy.get('map_id') if isinstance(legacy,dict) else None
        if isinstance(legacy_id,int):
            candidate=await db.get(MapDocument,legacy_id)
            if candidate and not candidate.deleted:
                row=candidate
    if row:
        current=row.draft if isinstance(row.draft,dict) else {}
        if current.get('asset_id') not in (None,'',body.asset_id):
            raise HTTPException(409,'这张路线地图已关联到另一份地图资产')
        expected_geometry=(pixel_width*resolution,pixel_height*resolution,resolution,origin[0],origin[1])
        actual_geometry=(current.get('width'),current.get('height'),current.get('resolution'),current.get('origin_x',0),current.get('origin_y',0))
        if any(value is None or abs(float(value)-expected)>1e-6 for value,expected in zip(actual_geometry,expected_geometry)):
            raise HTTPException(409,'此地图的尺寸、分辨率或坐标原点已改变；请先核对路线，再另存为新地图')
        existing_image=image_directory(row.id)/(str(current.get('image',''))+'.png')
        if current.get('asset_revision')==asset['revision'] and existing_image.is_file():
            return ok(public(row))
        try:
            await acquire_lock(db,row,actor)
            image_path=image_directory(row.id)/(digest+'.png')
            if not image_path.exists():
                await asyncio.to_thread(image_path.write_bytes,png)
            document=MapData.model_validate({**current,'image':digest,'asset_id':body.asset_id,
                                             'asset_revision':asset['revision']}).model_dump()
            await save_draft(db,row,actor,row.revision,document)
            await db.commit();await db.refresh(row)
            return ok(public(row),message='已更新底图，原有站点和路线已保留')
        except HTTPException:
            raise
        except Exception as exc:
            await db.rollback()
            raise HTTPException(409,str(exc)) from exc

    base_name=re.sub(r'[^\w-]+','_',body.asset_id.rsplit('/',1)[-1],flags=re.UNICODE).strip('_')[:100] or '地图'
    name=base_name
    if await db.scalar(select(MapDocument.id).where(MapDocument.name==name)):
        name=f'{base_name[:88]}_{hashlib.sha256(body.asset_id.encode()).hexdigest()[:8]}'
    if await db.scalar(select(MapDocument.id).where(MapDocument.name==name)):
        raise HTTPException(409,'无法为此地图生成唯一路线地图名称，请先在地图列表中检查同名地图')
    row=MapDocument(name=name,draft=MapData.model_validate({
        'width':pixel_width*resolution,'height':pixel_height*resolution,
        'resolution':resolution,'origin_x':origin[0],'origin_y':origin[1],
        'image':digest,'asset_id':body.asset_id,'asset_revision':asset['revision'],
    }).model_dump(),operator=actor)
    db.add(row)
    audit(db,actor,'map',f'从地图资产 {body.asset_id} 创建路线地图 {name}')
    await db.flush()
    image_path=image_directory(row.id)/(digest+'.png')
    if not image_path.exists():
        await asyncio.to_thread(image_path.write_bytes,png)
    await db.commit();await db.refresh(row)
    return ok(public(row),message='路线地图已创建；站点和路线可直接在当前画布设置')


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
async def status(actor=Depends(require('map:view'))):
    snapshot=mapping.snapshot()
    snapshot['localization_state']=(await ros_runtime.unit_state('localization')).get('state','unknown')
    snapshot['navigation_state']=(await ros_runtime.unit_state('navigation')).get('state','unknown')
    try:
        snapshot['localization_nodes_active']=sorted(set(ros_runtime.graph()) & set(ros_runtime.SERVICES['localization']['nodes']))
        snapshot['navigation_nodes_active']=sorted(set(ros_runtime.graph()) & set(ros_runtime.SERVICES['navigation']['nodes']))
        snapshot['localization_graph_readable']=True
        snapshot['navigation_graph_readable']=True
    except Exception:
        snapshot['localization_nodes_active']=[]
        snapshot['navigation_nodes_active']=[]
        snapshot['localization_graph_readable']=False
        snapshot['navigation_graph_readable']=False
    return ok(snapshot)


@router.get('/live-grid')
async def live_grid_status(actor=Depends(require('map:view'))):
    return ok(mapping.bridge.live_grid_snapshot())


@router.get('/live-grid.png')
async def live_grid_image(actor=Depends(require('map:view'))):
    grid, sequence = mapping.bridge.live_grid_message()
    if grid is None:
        raise HTTPException(404, '尚无新鲜的实时二维地图；请确认正在建图并收到雷达点云')

    def encode_png():
        from PIL import Image
        width, height = int(grid.info.width), int(grid.info.height)
        pixels = bytes(
            250 if value < 0 else max(0, 254 - round(min(100, int(value)) * 2.54))
            for value in grid.data
        )
        image = Image.frombytes('L', (width, height), pixels)
        image = image.transpose(Image.FLIP_TOP_BOTTOM)
        output = io.BytesIO()
        image.save(output, format='PNG')
        return output.getvalue()

    try:
        content = await asyncio.to_thread(encode_png)
    except (ValueError, OSError) as exc:
        raise HTTPException(500, '实时二维地图编码失败') from exc
    return Response(
        content=content,
        media_type='image/png',
        headers={
            'Cache-Control': 'no-store, max-age=0',
            'X-Map-Sequence': str(sequence),
        },
    )


class SaveMapping(BaseModel):
    name:str=Field(min_length=1,max_length=64,pattern=r'^[a-zA-Z0-9_-]+$')


class StartMapping(BaseModel):
    model_config=ConfigDict(extra='forbid')
    manual_push_confirmed:bool


@router.post('/mapping/start')
async def start(body:StartMapping,actor=Depends(require('map:edit'))):
    if mapping.lock.locked() or any(j for j in assets.tasks):raise HTTPException(409,'已有地图任务正在处理')
    if not body.manual_push_confirmed:raise HTTPException(409,'请先确认现场底盘处于厂家允许的安全手动/自由轮状态，并可人工推行')
    try:
        await mapping.require_localization_and_motion_stopped()
        mapping.bridge.require_mapping_ready()
    except RuntimeError as exc:raise HTTPException(409,str(exc)) from exc
    return ok(assets.submit('mapping-start',lambda job:mapping.start(job,body.manual_push_confirmed)))


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
