"""Service-control contract tests; no systemd units or hardware are started."""
import asyncio
import importlib.util
import struct
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch,AsyncMock
import test_operations as fixtures
from app.services import ros_runtime as runtime
from app.services.vehicle_state import vehicle_state


class RuntimeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        fixtures.OperationsTests.setUpClass();cls.client=fixtures.OperationsTests.client;cls.headers=fixtures.OperationsTests.headers
    @classmethod
    def tearDownClass(cls):fixtures.OperationsTests.tearDownClass()

    def test_readonly_windows_snapshot_and_denial(self):
        with patch('app.services.ros_runtime.platform.system',return_value='Windows'):
            response=self.client.get('/api/ros-runtime/status',headers=self.headers)
            self.assertEqual(response.status_code,200)
            self.assertFalse(response.json()['data']['control_enabled'])
            self.assertEqual(len(response.json()['data']['services']),3)
            denied=self.client.post('/api/ros-runtime/services/core/action',headers=self.headers,json={'action':'start','reason':'测试启动'})
            self.assertEqual(denied.status_code,409)

    def test_auth_fixed_units_and_protected_core(self):
        self.assertEqual(self.client.get('/api/ros-runtime/status').status_code,401)
        for key,body in [('ssh',{'action':'stop','reason':'测试操作'}),('core',{'action':'start','reason':'测试操作','command':'rm -rf /'})]:
            response=self.client.post('/api/ros-runtime/services/'+key+'/action',headers=self.headers,json=body)
            self.assertEqual(response.status_code,422,response.text)
        with patch.object(runtime,'availability',return_value=(True,'')):
            for action in ['stop','restart']:
                response=self.client.post('/api/ros-runtime/services/core/action',headers=self.headers,json={'action':action,'reason':'测试保护'})
                self.assertEqual(response.status_code,409)

    def test_plc_start_request_is_interlocked_and_unverified(self):
        path='/api/ros-runtime/plc/start-request'
        body={'confirmation':'PLC','reason':'现场启动检查'}
        self.assertEqual(self.client.post(path,json=body).status_code,401)
        self.assertEqual(self.client.post(path,headers=self.headers,json={**body,'confirmation':'yes'}).status_code,422)
        with patch.object(runtime,'availability',return_value=(False,'无真实 ROS')):
            self.assertEqual(self.client.post(path,headers=self.headers,json=body).status_code,409)
        with patch.object(runtime,'availability',return_value=(True,'')):
            self.assertEqual(self.client.post(path,headers=self.headers,json=body).status_code,409)
        with (patch.object(runtime,'availability',return_value=(True,'')),
              patch.dict('os.environ',{'ROBOT_PLC_PROTOCOL':'legacy_8_register'}),
              patch.object(runtime.mapping_control,'active',False),
              patch.object(runtime.bridge,'require_stationary') as stationary,
              patch.object(runtime.bridge,'stop_route',new=AsyncMock()) as stop,
              patch.object(runtime.bridge,'publish') as publish):
            result=self.client.post(path,headers=self.headers,json=body)
            self.assertEqual(result.status_code,200,result.text)
            self.assertEqual(result.json()['data']['status'],'unverified')
            self.assertEqual(stationary.call_count,2)
            stop.assert_awaited_once()
            publish.assert_called_once_with('/plc_start',1)

    def test_plc_stop_request_confirms_software_lock_without_claiming_hardware_disable(self):
        path='/api/ros-runtime/plc/stop-request'
        body={'confirmation':'STOP','reason':'现场停车检查'}
        self.assertEqual(self.client.post(path,json=body).status_code,401)
        self.assertEqual(self.client.post(path,headers=self.headers,json={**body,'confirmation':'PLC'}).status_code,422)
        previous=runtime.bridge.inhibited
        try:
            with (patch.object(runtime,'availability',return_value=(True,'')),
                  patch.object(runtime.bridge,'stop_route',new=AsyncMock()) as stop,
                  patch.object(runtime.bridge,'require_stationary') as stationary,
                  patch.object(runtime.bridge,'publish') as publish):
                result=self.client.post(path,headers=self.headers,json=body)
                self.assertEqual(result.status_code,200,result.text)
                self.assertEqual(result.json()['data']['status'],'software_locked')
                self.assertEqual(result.json()['data']['hardware'],'unknown')
                self.assertTrue(runtime.bridge.inhibited)
                stop.assert_awaited_once()
                stationary.assert_called_once()
                publish.assert_not_called()
                snapshot=self.client.get('/api/ros-runtime/status',headers=self.headers).json()['data']
                self.assertEqual(snapshot['plc_request']['hardware'],'unknown')
            with (patch.object(runtime,'availability',return_value=(True,'')),
                  patch.object(runtime.bridge,'stop_route',new=AsyncMock(side_effect=TimeoutError('stop ack timeout')))):
                result=self.client.post(path,headers=self.headers,json=body)
                self.assertEqual(result.status_code,409)
                self.assertTrue(runtime.bridge.inhibited)
                self.assertEqual(runtime.plc_request['action'],'stop_unconfirmed')
        finally:
            runtime.bridge.inhibited=previous

    def test_stale_odom_never_proves_live_plc_link(self):
        bridge=runtime.bridge
        now=time.monotonic()
        with (patch.object(bridge,'require_ros'),
              patch.object(runtime.mapping_control,'active',False),
              patch.object(bridge,'status_received',now),
              patch.object(bridge,'odom_received',now),
              patch.object(bridge,'plc_link_received',0),
              patch.object(vehicle_state,'plc_connected',None),
              patch.object(vehicle_state,'run_status',1),
              patch.object(vehicle_state,'linear_velocity',0.0),
              patch.object(vehicle_state,'angular_velocity',0.0)):
            with self.assertRaisesRegex(RuntimeError,'PLC 连接反馈'):
                bridge.require_stationary()
            bridge._on_plc_link(SimpleNamespace(data=True))
            bridge.require_stationary()
            bridge.plc_link_received=time.monotonic()-2
            with self.assertRaisesRegex(RuntimeError,'PLC 连接反馈'):
                bridge.require_stationary()

    def test_mapping_interlock(self):
        async def check():
            with patch.object(runtime,'availability',return_value=(True,'')),patch.object(runtime.mapping_control,'active',True),patch.object(runtime,'command',new=AsyncMock()) as command:
                with self.assertRaisesRegex(RuntimeError,'结束建图'):await runtime.operate('navigation','restart')
                command.assert_not_called()
        asyncio.run(check())

    def test_stop_without_stationary_feedback_never_calls_systemctl(self):
        async def check():
            with patch.object(runtime,'availability',return_value=(True,'')),patch.object(runtime.mapping_control,'active',False),patch.object(runtime.bridge,'switch',{'status':'idle'}),patch.object(runtime.bridge,'require_ros'),patch.object(runtime.bridge,'require_stationary',side_effect=RuntimeError('缺少停车反馈')),patch.object(runtime,'unit_state',new=AsyncMock(return_value={'load':'loaded','state':'active'})),patch.object(runtime,'command',new=AsyncMock()) as command:
                with self.assertRaisesRegex(RuntimeError,'停车反馈'):await runtime.operate('navigation','stop')
                command.assert_not_called()
        asyncio.run(check())

    def test_owned_start_fixed_argv_and_wait_job(self):
        async def check():
            states=[{'load':'loaded','state':'inactive'},{'state':'active'},{'state':'active'}]
            with patch.object(runtime,'availability',return_value=(True,'')),patch.object(runtime.mapping_control,'active',False),patch.object(runtime.bridge,'switch',{'status':'idle'}),patch.object(runtime.bridge,'inhibited',False),patch.object(runtime.bridge,'require_ros'),patch.object(runtime,'graph',return_value=[]),patch.object(runtime,'unit_state',new=AsyncMock(side_effect=states)),patch.object(runtime,'command',new=AsyncMock(side_effect=['','0 /'])) as command:
                result=await runtime.operate('navigation','start')
                self.assertEqual(result['state'],'active');self.assertTrue(runtime.bridge.inhibited)
                self.assertEqual(command.await_args_list[0].args,('systemctl','--user','--no-block','start','orange-ros-navigation.service'))
        asyncio.run(check())

    def test_duplicate_unmanaged_node_blocks_start(self):
        async def check():
            with patch.object(runtime,'availability',return_value=(True,'')),patch.object(runtime.mapping_control,'active',False),patch.object(runtime.bridge,'switch',{'status':'idle'}),patch.object(runtime.bridge,'require_ros'),patch.object(runtime,'unit_state',new=AsyncMock(return_value={'load':'loaded','state':'inactive'})),patch.object(runtime,'graph',return_value=['livox_lidar_publisher']),patch.object(runtime,'command',new=AsyncMock()) as command:
                with self.assertRaisesRegex(RuntimeError,'重复启动'):await runtime.operate('core','start')
                command.assert_not_called()
        asyncio.run(check())

    def test_livox_converter_preserves_coordinates_and_filters_nonfinite(self):
        path=Path(__file__).resolve().parents[1]/'ros/orange_nav_ws/src/runtime/orange_runtime/orange_runtime/converter.py'
        spec=importlib.util.spec_from_file_location('converter_under_test',path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        values=[SimpleNamespace(x=1.25,y=-2.,z=3.,reflectivity=40),SimpleNamespace(x=float('nan'),y=0,z=0,reflectivity=0)]
        self.assertEqual(struct.unpack('<ffff',module.pack_points(values)),(1.25,-2.,3.,40.))

if __name__=='__main__':unittest.main()
