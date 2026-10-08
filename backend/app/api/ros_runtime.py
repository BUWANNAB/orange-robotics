from typing import Literal
from fastapi import APIRouter,Depends,HTTPException
from pydantic import BaseModel,ConfigDict,Field
from app.common.response import ok
from app.database import get_db
from app.services.operations_common import require,audit
from app.services import ros_runtime as runtime,map_assets

router=APIRouter(prefix='/api/ros-runtime',tags=['ROS maintenance'])

@router.get('/status')
async def status(actor=Depends(require('ros:view'))):return ok(await runtime.snapshot())

class Action(BaseModel):
    model_config=ConfigDict(extra='forbid')
    action:Literal['start','stop','restart']
    reason:str=Field(min_length=3,max_length=200)


class PlcStartRequest(BaseModel):
    model_config=ConfigDict(extra='forbid')
    confirmation:Literal['PLC']
    reason:str=Field(min_length=3,max_length=200)


class PlcStopRequest(BaseModel):
    model_config=ConfigDict(extra='forbid')
    confirmation:Literal['STOP']
    reason:str=Field(min_length=3,max_length=200)


@router.post('/plc/start-request')
async def plc_start_request(body:PlcStartRequest,actor=Depends(require('ros:maintain')),
                            _control=Depends(require('robot:control')),db=Depends(get_db)):
    async with runtime.lock,runtime.bridge.control_lock:
        enabled,reason=runtime.availability()
        if not enabled:raise HTTPException(409,reason)
        protocol_ready,protocol_reason=runtime.plc_protocol_ready()
        if not protocol_ready:raise HTTPException(409,protocol_reason)
        if (await runtime.unit_state('plc'))['state']!='active':
            raise HTTPException(409,'PLC 通信服务尚未启动；请先在 ROS 维护页启动已验证的 PLC 服务')
        if map_assets.tasks or runtime.mapping_control.active:
            raise HTTPException(409,'地图任务或建图正在进行，禁止请求 PLC 启动')
        runtime.bridge.require_stationary()
        audit(db,actor,'ROS maintenance',f'请求 PLC 启动：{body.reason}')
        await db.commit()
        try:
            await runtime.bridge.stop_route()
            runtime.bridge.require_stationary()
            runtime.bridge.publish('/plc_start',1)
        except (RuntimeError,TimeoutError) as exc:
            raise HTTPException(409,str(exc)) from exc
        runtime.plc_request={'action':'start_requested','hardware':'unknown',
                             'message':'启动脉冲已发布，实际使能状态未知；软件停车锁定中'}
        return ok({'status':'unverified','message':'PLC 启动请求已发布；尚无底盘实际使能回执，保持软件停车锁定，请现场核实'})


@router.post('/plc/stop-request')
async def plc_stop_request(body:PlcStopRequest,actor=Depends(require('ros:maintain')),
                           _control=Depends(require('robot:control')),db=Depends(get_db)):
    async with runtime.lock,runtime.bridge.control_lock:
        runtime.bridge.inhibited=True
        enabled,reason=runtime.availability()
        if not enabled:raise HTTPException(409,reason)
        audit(db,actor,'ROS maintenance',f'请求停车并保持软件锁定：{body.reason}')
        await db.commit()
        try:
            await runtime.bridge.stop_route()
            runtime.bridge.require_stationary()
        except (RuntimeError,TimeoutError) as exc:
            runtime.plc_request={'action':'stop_unconfirmed','hardware':'unknown',
                                 'message':'软件锁定已设置，但停车回执未确认；请现场急停并检查'}
            raise HTTPException(409,'软件锁定已设置，但停车回执未确认；请现场急停并检查：'+str(exc)) from exc
        runtime.plc_request={'action':'software_locked','hardware':'unknown',
                             'message':'已确认停车并保持软件锁定；物理使能状态未知'}
        return ok({'status':'software_locked','hardware':'unknown',
                   'message':'停车回执已确认、软件锁定已保持；现有 PLC 协议没有物理停用命令及使能回读，请现场核实'})

@router.post('/services/{key}/action')
async def action(key:Literal['core','plc','navigation','mapping'],body:Action,actor=Depends(require('ros:maintain')),db=Depends(get_db)):
    enabled,reason=runtime.availability()
    if not enabled:raise HTTPException(409,reason)
    if body.action not in runtime.SERVICES[key]['actions']:raise HTTPException(409,'网页不允许停止或重启常驻核心服务')
    if runtime.lock.locked() or map_assets.tasks:raise HTTPException(409,'已有控制或地图任务，请等待完成')
    audit(db,actor,'ROS maintenance',f'{key} {body.action}: {body.reason}')
    await db.commit()
    # Recheck after DB I/O, before reserving the single command slot.
    if runtime.lock.locked() or map_assets.tasks:raise HTTPException(409,'已有控制任务，请稍后重试')
    return ok(map_assets.submit('ros-service',lambda job:runtime.operate(key,body.action)))

@router.get('/jobs/{key}')
async def job(key:str,actor=Depends(require('ros:view'))):
    try:return ok(map_assets.job_status(key))
    except (ValueError,FileNotFoundError) as exc:raise HTTPException(404,str(exc)) from exc

@router.get('/services/{key}/logs')
async def logs(key:Literal['core','plc','navigation','mapping'],actor=Depends(require('ros:maintain'))):
    try:return ok({'text':await runtime.logs(key)})
    except (RuntimeError,OSError,TimeoutError) as exc:raise HTTPException(503,str(exc)) from exc
