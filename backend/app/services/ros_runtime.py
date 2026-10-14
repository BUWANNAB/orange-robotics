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
    'core': {'name':'雷达与点云','unit':'orange-ros-core.service','nodes':['livox_lidar_publisher','livox_cloud_converter'], 'actions':['start'], 'dependencies':[], 'description':'常驻传感器服务，不启动 PLC 或底盘通信；网页不提供停止或重启。'},
    'plc': {'name':'PLC 底盘通信','unit':'orange-ros-plc.service','nodes':['ros2plc'], 'actions':['start'], 'dependencies':[], 'description':'独立服务；仅在 PLC 协议确认后启动，运行时会周期读写寄存器。'},
    'localization': {'name':'雷达定位','unit':'orange-ros-localization.service','nodes':['global_relocalization','lidar_localization','tf_to_pose_node','xslidar_tf','odom_tf'], 'actions':['start','stop','restart'], 'dependencies':['core'], 'description':'只依赖雷达核心；不启动 PLC 通信或底盘使能。自动全局重定位还需要 PLC 提供新鲜里程计和停车反馈。'},
    'navigation': {'name':'运动控制','unit':'orange-ros-navigation.service','nodes':['vehicle_navigation_node','obstacle_pointcloud_filter','collision_monitor','obstacle_command_watchdog','lifecycle_manager_obstacle'], 'actions':['start','stop','restart'], 'dependencies':['core','localization','plc'], 'description':'独立运动控制器；依赖定位服务和已验证的 PLC 通信，但启动服务不会发送底盘使能脉冲或行驶命令。'},
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
    states=await asyncio.gather(*(unit_state(key) for key in SERVICES))
    state_by_key=dict(zip(SERVICES,states))
    rows=[]
    for (key,spec),state in zip(SERVICES.items(),states):
        start_allowed,start_reason=(plc_protocol_ready() if key in {'plc','navigation'} else (True,''))
        if start_allowed:
            missing=[SERVICES[dependency]['name'] for dependency in spec['dependencies']
                     if state_by_key[dependency]['state']!='active']
            if missing:
                start_allowed=False
                start_reason='请先启动依赖：'+', '.join(missing)
        rows.append({'id':key,**spec,**state,'start_allowed':start_allowed,
                     'start_block_reason':start_reason,
                     'observed_nodes':[name for name in spec['nodes'] if name in nodes]})
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
        if key=='plc' and action=='start':
            protocol_ready,protocol_reason=plc_protocol_ready()
            if not protocol_ready:raise RuntimeError(protocol_reason)
        if key=='navigation' and action=='start':
            protocol_ready,protocol_reason=plc_protocol_ready()
            if not protocol_ready:raise RuntimeError(protocol_reason)
        if mapping_control.active or mapping_control.lock.locked():raise RuntimeError('请先在地图工作台保存并结束建图')
        if bridge.switch.get('status') in {'pending','loading','loaded','localizing'}:raise RuntimeError('正在切换定位地图，请等待完成')
        bridge.require_ros()
        state=await unit_state(key)
        if state['load']!='loaded':raise RuntimeError('预设服务未安装或用户服务管理器不可用')
        if state['state'] in {'activating','deactivating','reloading','unknown'}:raise RuntimeError('服务状态未稳定，请刷新后重试')
        if action=='start' and state['state']=='active':return {'message':'服务已经运行；业务就绪状态请查看检查项'}
        for dependency in spec['dependencies']:
            if (await unit_state(dependency))['state']!='active':raise RuntimeError('请先启动依赖：'+SERVICES[dependency]['name'])
        motion_state=await unit_state('navigation') if key=='localization' and action in {'stop','restart'} else None
        motion_nodes=[]
        if key=='localization' and action in {'stop','restart'}:
            try:motion_nodes=sorted(set(graph()) & set(SERVICES['navigation']['nodes']))
            except Exception as exc:raise RuntimeError('无法确认运动控制节点状态，拒绝维护定位服务') from exc
        if key=='plc' and action=='start' and (await unit_state('navigation'))['state']=='active':
            raise RuntimeError('运动控制器正在运行；请先按现场流程停车并停止运动控制，再启动 PLC 通信服务。雷达定位可继续独立运行。')
        if action in {'stop','restart'}:
            needs_stationary_check=key!='localization' or motion_state['state']!='inactive' or bool(motion_nodes)
            if needs_stationary_check:
                bridge.require_stationary()
                await bridge.stop_route()
        elif any(name in graph() for name in spec['nodes']):
            raise RuntimeError('发现同名 ROS 节点由其他启动器运行，请先统一启动归属，避免重复启动')
        bridge.inhibited=True
        if key=='localization':bridge.switch={'status':'needs_localization','message':'定位服务维护后请重新定位，再解除停止锁定'}
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
