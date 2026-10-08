"""Manual-push mapping lifecycle coordinated with the ROS sensor stack."""
import asyncio
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


async def require_navigation_stopped():
    from app.services.ros_runtime import SERVICES,graph,unit_state
    navigation=await unit_state('navigation')
    if navigation.get('load')!='loaded' or navigation.get('state')!='inactive':
        state=navigation.get('state','unknown')
        raise RuntimeError(f'定位与导航服务必须已安装并确认停止后才能建图（当前：{state}）')
    try:nodes=sorted(set(graph()) & set(SERVICES['navigation']['nodes']))
    except Exception as exc:raise RuntimeError('无法读取 ROS 节点图，不能确认定位与导航已停止') from exc
    if nodes:raise RuntimeError('检测到定位与导航节点仍在运行：'+', '.join(nodes))


async def start(job,manual_push_confirmed=False):
    global active
    async with lock,bridge.control_lock:
        if manual_push_confirmed is not True:
            raise RuntimeError('请先确认现场底盘处于厂家允许的安全手动/自由轮状态，并可人工推行')
        await require_navigation_stopped()
        bridge.require_mapping_ready()
        if active:raise RuntimeError('建图已启动')
        active=True
        bridge.inhibited=True
        bridge.switch={'status':'mapping','message':'建图期间禁止定位导航'}
        since=sequence
        bridge.publish('/buildmap','start')
        await wait_status(since,lambda message:message=='map_data_ready',90)
        return {'status':'mapping','message':'点云已就绪；可在实体确认底盘可手推后人工采集。系统不会发送行驶指令。'}


async def finish(job,name=None):
    global active
    async with lock,bridge.control_lock:
        bridge.require_ros()
        await require_navigation_stopped()
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
        bridge.switch={'status':'needs_localization','message':'建图已结束，请选择地图并重新定位'}
        bridge.inhibited=True
        return {'status':'saved' if name else 'stopped','asset_id':name,
                'message':'建图已结束；导航仍保持停止。请检查地图后，在 ROS 维护页按需启动定位与导航并重新定位。'}


def snapshot():
    publisher=bridge.publishers.get('/buildmap')
    try:controller_ready=bool(publisher and publisher.get_subscription_count()>0)
    except Exception:controller_ready=False
    lidar_ready=bool(bridge.lidar_received and time.monotonic()-bridge.lidar_received<2)
    connected=bool(not bridge.is_simulation and bridge.node and bridge_source_is_ros())
    return {'active':active,'status':status,'fresh':bool(received and time.monotonic()-received<5),
            'connected':connected,'source':'ros' if connected else 'simulation' if bridge.is_simulation else 'disconnected',
            'lidar_ready':lidar_ready,'controller_ready':controller_ready}


def bridge_source_is_ros():
    from app.services.vehicle_state import vehicle_state
    return vehicle_state.source=='ros'
