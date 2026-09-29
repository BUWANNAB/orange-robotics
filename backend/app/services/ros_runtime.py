"""Fixed systemd user services; no client-supplied commands, units or node names."""
import asyncio
import os
import platform
import shutil
import time
from app.services.ros2_service import ros2_service as bridge
from app.services import mapping_control, map_assets
from app.services.operations_common import redact

SERVICES = {
    'core': {'name':'雷达与底盘','unit':'orange-ros-core.service','nodes':['livox_lidar_publisher','livox_cloud_converter','ros2plc'], 'actions':['start'], 'dependencies':[], 'description':'常驻服务；网页不提供停止或重启，避免中断底盘和雷达。'},
    'navigation': {'name':'定位与导航','unit':'orange-ros-navigation.service','nodes':['lidar_localization','vehicle_navigation_node'], 'actions':['start','stop','restart'], 'dependencies':['core'], 'description':'启动后仍需地图定位就绪，维护操作后保持停止锁定。'},
    'mapping': {'name':'建图控制器','unit':'orange-ros-mapping.service','nodes':['build_map_manager'], 'actions':['start','stop','restart'], 'dependencies':['core'], 'description':'控制器常驻，SLAM 仅在地图工作台开始采集时启动。'},
}
lock=asyncio.Lock()
plc_request={'action':'none','hardware':'unknown','message':'尚未请求 PLC 操作'}


def availability():
    if platform.system()!='Linux':return False,'当前为 Windows 预览；服务控制需要机器人 Linux 环境'
    if not shutil.which('systemctl'):return False,'未找到 systemd 服务管理工具'
    if bridge.is_simulation:return False,'仿真模式不执行 ROS 服务操作'
    if os.getenv('RCS_ROS_CONTROL_ENABLED','false').lower()!='true':return False,'服务控制未启用；请先部署预设服务并配置 RCS_ROS_CONTROL_ENABLED'
    return True,''


def plc_protocol_ready():
    if os.getenv('ROBOT_PLC_PROTOCOL','') != 'legacy_8_register':
        return False,'PLC 寄存器协议未确认；禁止发送旧底盘启动脉冲'
    return True,''


async def command(*args, timeout=5):
    child=await asyncio.create_subprocess_exec(*args,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.PIPE)
    try:
        out,err=await asyncio.wait_for(child.communicate(),timeout)
    except BaseException:
        if child.returncode is None:child.kill()
        await child.wait()
        raise
    if child.returncode:raise RuntimeError(redact(err.decode(errors='replace').strip()) or '服务管理命令失败')
    return out.decode(errors='replace')


async def unit_state(key):
    if platform.system()!='Linux' or not shutil.which('systemctl'):
        return {'load':'unavailable','state':'unknown','detail':'本机不支持 systemd'}
    try:
        output=await command('systemctl','--user','show',SERVICES[key]['unit'],'--property=LoadState,ActiveState,SubState')
        values=dict(line.split('=',1) for line in output.splitlines() if '=' in line)
        return {'load':values.get('LoadState','unknown'),'state':values.get('ActiveState','unknown'),'detail':values.get('SubState','unknown')}
    except (RuntimeError,OSError,asyncio.TimeoutError) as exc:
        return {'load':'unavailable','state':'unknown','detail':str(exc) or '查询服务状态超时'}


def graph():
    if bridge.node is None or bridge.is_simulation:return []
    return sorted(set(bridge.node.get_node_names()))


async def snapshot():
    enabled,reason=availability()
    plc_ready,plc_reason=plc_protocol_ready()
    try:nodes=graph();graph_error=''
    except Exception as exc:nodes=[];graph_error=redact(exc)
    rows=[]
    states=await asyncio.gather(*(unit_state(key) for key in SERVICES))
    for (key,spec),state in zip(SERVICES.items(),states):
        rows.append({'id':key,**spec,**state,'observed_nodes':[name for name in spec['nodes'] if name in nodes]})
    pose=bridge.snapshot()
    fresh_lidar=bool(not bridge.is_simulation and bridge.lidar_received and time.monotonic()-bridge.lidar_received<2)
    checks=[{'name':'ROS 桥接','ready':bool(bridge.node and not bridge.is_simulation),'detail':'真实 ROS 节点连接' if bridge.node and not bridge.is_simulation else '未连接真实 ROS'},
            {'name':'雷达数据','ready':fresh_lidar,'detail':'PointCloud2 最近 2 秒有数据' if fresh_lidar else '尚无新鲜 PointCloud2 数据'},
            {'name':'底盘反馈','ready':bool(not bridge.is_simulation and bridge.odom_received and time.monotonic()-bridge.odom_received<2 and bridge.plc_link_received and time.monotonic()-bridge.plc_link_received<1 and pose['status']['plcConnected'] is True),'detail':'以新鲜里程计及 Modbus 读取反馈共同判断'},
            {'name':'定位质量','ready':pose['localization']['source']=='ros' and pose['localization']['valid'],'detail':'新鲜位姿与匹配质量均通过才就绪'}]
    return {'control_enabled':enabled,'reason':reason,'busy':lock.locked() or bool(map_assets.tasks),
            'services':rows,'nodes':nodes,'graph_error':graph_error,'checks':checks,
            'mapping':mapping_control.snapshot(),'switch':pose['switch'],'inhibited':bridge.inhibited,
            'plc_request':dict(plc_request),'plc_start_ready':plc_ready,'plc_start_reason':plc_reason}


async def operate(key,action):
    async with lock,bridge.control_lock:
        enabled,reason=availability()
        if not enabled:raise RuntimeError(reason)
        spec=SERVICES[key]
        if action not in spec['actions']:raise RuntimeError('常驻核心服务禁止从网页停止或重启')
        if mapping_control.active or mapping_control.lock.locked():raise RuntimeError('请先在地图工作台保存并结束建图')
        if bridge.switch.get('status') in {'pending','loading','loaded','localizing'}:raise RuntimeError('正在切换定位地图，请等待完成')
        bridge.require_ros()
        state=await unit_state(key)
        if state['load']!='loaded':raise RuntimeError('预设服务未安装或用户服务管理器不可用')
        if state['state'] in {'activating','deactivating','reloading','unknown'}:raise RuntimeError('服务状态未稳定，请刷新后重试')
        if action=='start' and state['state']=='active':return {'message':'服务已经运行；业务就绪状态请查看检查项'}
        for dependency in spec['dependencies']:
            if (await unit_state(dependency))['state']!='active':raise RuntimeError('请先启动依赖：'+SERVICES[dependency]['name'])
        if action in {'stop','restart'}:
            bridge.require_stationary()
            await bridge.stop_route()
        elif any(name in graph() for name in spec['nodes']):
            raise RuntimeError('发现同名 ROS 节点由其他启动器运行，请先统一启动归属，避免重复启动')
        bridge.inhibited=True
        if key=='navigation':bridge.switch={'status':'needs_localization','message':'服务维护后请重新定位，再解除停止锁定'}
        await command('systemctl','--user','--no-block',action,spec['unit'])
        target='inactive' if action=='stop' else 'active'
        deadline=time.monotonic()+30
        while time.monotonic()<deadline:
            state=await unit_state(key)
            if state['state']==target:
                # A queued restart may still report the old active process; ask systemd whether its job finished.
                job=await command('systemctl','--user','show',spec['unit'],'--property=Job','--value')
                if not job.strip() or job.strip().split()[0]=='0':return {'service':key,'state':target,'message':'服务操作完成；进程运行不代表传感器或定位已就绪'}
            if state['state']=='failed':raise RuntimeError('服务启动失败，请查看该服务日志')
            await asyncio.sleep(.5)
        raise RuntimeError('等待服务切换超时，实际结果未确认；请刷新状态并查看日志')


async def logs(key):
    if platform.system()!='Linux' or not shutil.which('journalctl'):return '当前环境没有机器人 systemd 日志。'
    return redact(await command('journalctl','--user','--unit',SERVICES[key]['unit'],'--lines=100','--no-pager','--output=short-iso'))
