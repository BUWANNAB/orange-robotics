"""Mapping lifecycle coordinated with localization and navigation."""
import asyncio
import os
import time
from collections import deque
from app.services.ros2_service import ros2_service as bridge

events=deque(maxlen=100)
sequence=0
active=False
status='unknown'
received=0.
lock=asyncio.Lock()


def receive(msg):
    global sequence,status,received,active
    sequence+=1;status=msg.data;received=time.monotonic();events.append((sequence,status))
    if status in {'starting','mapping','map_data_ready','saving'}: active=True
    if status in {'idle','rviz_livox_started','mapping_stopped'}: active=False


async def wait_status(since, predicate, timeout):
    deadline=time.monotonic()+timeout
    while time.monotonic()<deadline:
        for seq,message in list(events):
            if seq<=since: continue
            if predicate(message): return message
            if message.endswith('_failed') or message in {'invalid_map_name','no_map_data','not_mapping'}:
                raise RuntimeError('建图节点返回：'+message)
        await asyncio.sleep(.1)
    raise TimeoutError('等待建图节点反馈超时，请核实 ROS 状态后重试')


async def lifecycle(activate):
    from lifecycle_msgs.srv import GetState,ChangeState
    name=os.getenv('ROS_LOCALIZATION_NODE','/lidar_localization').rstrip('/')
    get=bridge.node.create_client(GetState,name+'/get_state')
    change=bridge.node.create_client(ChangeState,name+'/change_state')
    async def call(client,request):
        deadline=time.monotonic()+5
        while not client.service_is_ready() and time.monotonic()<deadline: await asyncio.sleep(.1)
        if not client.service_is_ready(): raise RuntimeError('定位生命周期服务未就绪：'+name)
        future=client.call_async(request)
        while not future.done() and time.monotonic()<deadline: await asyncio.sleep(.05)
        if not future.done(): future.cancel();raise TimeoutError('定位生命周期切换超时')
        return future.result()
    try:
        current=(await call(get,GetState.Request())).current_state.id
        target=3 if activate else 2
        if current==target:return
        if current not in {2,3}:raise RuntimeError('定位节点须先完成 configure，才能切换建图模式')
        request=ChangeState.Request();request.transition.id=3 if activate else 4
        if not (await call(change,request)).success:raise RuntimeError('定位节点拒绝生命周期切换')
    finally:
        bridge.node.destroy_client(get);bridge.node.destroy_client(change)


async def start(job):
    global active
    async with lock,bridge.control_lock:
        bridge.require_stationary()
        if active:raise RuntimeError('建图已启动')
        await bridge.stop_route()
        await lifecycle(False)
        active=True
        bridge.switch={'status':'mapping','message':'建图期间禁止定位导航'}
        since=sequence
        bridge.publish('/buildmap','start')
        await wait_status(since,lambda message:message=='map_data_ready',90)
        return {'status':'mapping','message':'点云已就绪；可使用现场手动控制采集，未自动启动车辆'}


async def finish(job,name=None):
    global active
    async with lock,bridge.control_lock:
        bridge.require_ros()
        await bridge.stop_route()
        if name:
            since=sequence;bridge.publish('/buildmap',name)
            message=await wait_status(since,lambda text:text.startswith('saved:') and text.rstrip('/').split('/')[-1]==name,310)
            await wait_status(since,lambda text:text=='idle',30)
            from app.services.map_assets import asset
            if not asset(name)['pcd']:
                raise RuntimeError('ROS 报告已保存，但服务端未找到 GlobalMap.pcd；请对齐 ROBOT_PCD_DIR')
        since=sequence;bridge.publish('/buildmap','stop')
        await wait_status(since,lambda text:text in {'rviz_livox_started','mapping_stopped'},60)
        active=False
        await lifecycle(True)
        bridge.switch={'status':'needs_localization','message':'建图已结束，请选择地图并重新定位'}
        return {'status':'saved' if name else 'stopped','asset_id':name}


def snapshot():
    return {'active':active,'status':status,'fresh':bool(received and time.monotonic()-received<5),
            'connected':bridge.snapshot()['connected'],'source':bridge.snapshot()['localization']['source']}
