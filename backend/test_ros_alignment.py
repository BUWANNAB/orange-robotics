"""Contract/failure tests with fake ROS transport, not hardware acceptance."""
import asyncio
import math
import tempfile
import time
import unittest
import json
from pathlib import Path
from types import SimpleNamespace as NS
from unittest.mock import patch, AsyncMock
from app.services.ros2_service import ROS2BridgeService
from app.services.vehicle_state import VehicleState


def pose(stamp=1, frame="map"):
    return NS(header=NS(stamp=NS(sec=stamp, nanosec=0), frame_id=frame),
              pose=NS(position=NS(x=3.,y=4.,z=0.), orientation=NS(x=0.,y=0.,z=math.sqrt(.5),w=math.sqrt(.5))))


class ROSAlignmentTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.state = VehicleState()
        self.patch = patch('app.services.ros2_service.state', self.state)
        self.patch.start()
        self.bridge = ROS2BridgeService()

    def tearDown(self):
        self.patch.stop()

    def ready(self):
        self.state.source = "ros"
        self.bridge.node = NS(get_clock=lambda:NS(now=lambda:NS(to_msg=lambda:None)))
        self.bridge.status_received = self.bridge.odom_received = time.monotonic()
        self.bridge._on_plc_link(NS(data=True))
        self.bridge._on_tf_pose(pose())
        self.bridge._on_quality(NS(data=[1.,.1, .01]))

    async def test_progress_requires_matching_running_route_and_expires(self):
        self.bridge.navigation = {"id":"current", "status":"running", "points":[{}, {}, {}]}
        self.bridge._on_nav_result(NS(data='old\nprogress\n1'))
        self.assertNotIn('target_index', self.bridge.navigation)
        for value in ('invalid', '99', '-2'):
            self.bridge._on_nav_result(NS(data='current\nprogress\n'+value))
            self.assertNotIn('target_index', self.bridge.navigation)
        self.bridge._on_nav_result(NS(data='current\nprogress\n2'))
        self.assertEqual(self.bridge.navigation['target_index'],2)
        self.assertTrue(self.bridge.snapshot()['navigation']['progress_fresh'])
        self.bridge.navigation['progress_received'] = time.monotonic()-3
        self.assertFalse(self.bridge.snapshot()['navigation']['progress_fresh'])
        self.bridge._on_nav_result(NS(data='current\nprogress\n-1'))
        self.assertEqual(self.bridge.navigation['target_index'],-1)
        self.bridge._on_nav_result(NS(data='current\nsuccess'))
        self.bridge._on_nav_result(NS(data='current\nprogress\n1'))
        self.assertEqual(self.bridge.navigation['target_index'],-1)

    async def test_auto_candidate_handoff_keeps_stop_lock(self):
        self.ready()
        async def stopped():self.bridge.inhibited=True
        self.bridge.stop_route=stopped
        self.bridge.switch_map=AsyncMock()
        def publish(topic,value):
            if topic=='/localization/auto_request':
                request=json.loads(value)
                self.bridge._on_auto_result(NS(data=json.dumps({'id':request['id'],'status':'candidate',
                    'x':1.,'y':2.,'yaw':.3,'overlap':.9,'rmse':.05})))
        self.bridge.publish=publish
        await self.bridge.auto_localize({'key':'A','pcd':'/maps/A.pcd','map_id':2,'version':3})
        self.bridge.switch_map.assert_awaited_once_with('/maps/A.pcd',1.,2.,.3)
        self.assertTrue(self.bridge.inhibited)
        self.assertEqual(self.bridge.relocalization['status'],'success')
        self.assertEqual(self.bridge.switch['map_id'],2)

    async def test_auto_cancel_releases_lock_and_ignores_late_candidate(self):
        self.ready();sent=[]
        async def stopped():self.bridge.inhibited=True
        self.bridge.stop_route=stopped
        self.bridge.publish=lambda topic,value:sent.append((topic,value))
        task=asyncio.create_task(self.bridge.auto_localize({'key':'A','pcd':'/maps/A.pcd','map_id':2,'version':3}))
        await asyncio.sleep(.02);request_id=self.bridge.relocalization['id'];task.cancel()
        with self.assertRaises(asyncio.CancelledError):await task
        self.assertFalse(self.bridge.control_lock.locked())
        self.assertTrue(self.bridge.inhibited)
        self.assertIn(('/localization/auto_cancel',request_id),sent)
        self.bridge._on_auto_result(NS(data=json.dumps({'id':request_id,'status':'candidate','x':1.,'y':2.,'yaw':0.,'overlap':.9,'rmse':.1})))
        self.assertEqual(self.bridge.relocalization['status'],'cancelled')

    async def test_auto_rejects_malformed_and_stale_results(self):
        self.bridge.relocalization={'id':'current','status':'searching'}
        for data in ['[]','bad',json.dumps({'id':'old','status':'failed'}),json.dumps({'id':'current','status':'candidate','x':float('nan')})]:
            self.bridge._on_auto_result(NS(data=data))
        self.assertEqual(self.bridge.relocalization['status'],'searching')

    async def test_local_stop_needs_fresh_stationary_feedback(self):
        from app.services.local_robot import execute
        self.ready()
        self.state.run_status=1
        self.state.linear_velocity=0.
        self.state.angular_velocity=0.
        async def stopped():
            self.bridge.inhibited=True
            await asyncio.sleep(.01)
            self.bridge.odom_received=time.monotonic()
            self.bridge.status_received=time.monotonic()
        self.bridge.stop_route=AsyncMock(side_effect=stopped)
        with (patch('app.services.local_robot.bridge',self.bridge),
              patch('app.services.local_robot.state',self.state)):
            result=await execute(None,None,NS(command='emergency-stop'))
            self.assertEqual(result[0],'success')
            self.bridge.stop_route.assert_awaited_once()
            self.bridge.stop_route.side_effect=None
            with patch('app.services.local_robot.time.monotonic',side_effect=[10.,11.,16.]):
                with self.assertRaises(TimeoutError):
                    await execute(None,None,NS(command='emergency-stop'))
        with self.assertRaises(RuntimeError):await self.bridge.route([0.]*18)

    async def test_quaternion_and_no_default_hardware_values(self):
        self.assertIsNone(self.state.plc_connected)
        self.ready()
        data = self.state.to_car_position_dict()
        self.assertEqual(data['position']['LocalX'], 3.)
        self.assertEqual(data['position']['X'], 0.)
        self.assertAlmostEqual(data['position']['Z'], math.sqrt(.5), places=5)
        self.assertAlmostEqual(data['position']['Heading'],90)
        self.assertIsNone(data['status']['battery'])
        self.assertTrue(data['status']['plcConnected'])

    async def test_replayed_transform_does_not_refresh_freshness(self):
        self.ready()
        self.state.pose_received = time.monotonic()-3
        self.bridge._on_tf_pose(pose())
        self.assertFalse(self.state.localization()['fresh'])
        self.bridge._on_tf_pose(pose(2,'odom'))
        self.assertFalse(self.state.localization()['fresh'])
        self.bridge._on_tf_pose(pose(2))
        self.assertTrue(self.state.localization()['valid'])

    async def test_voltage_is_not_soc(self):
        self.bridge._on_voltage(NS(data=48.5))
        self.assertEqual(self.state.voltage,48.5)
        self.assertIsNone(self.state.battery_soc)
        self.bridge._on_battery(NS(percentage=.7))
        self.assertEqual(self.state.battery_soc,70.)

    async def test_offline_and_simulation_refuse_motion(self):
        with self.assertRaises(RuntimeError): await self.bridge.route([0.]*9)
        self.ready();self.bridge.is_simulation=True
        with self.assertRaises(RuntimeError): await self.bridge.route([0.]*9)

    async def test_missing_ros_does_not_start_simulation(self):
        import builtins
        original_import = builtins.__import__
        def importing(name, *args, **kwargs):
            if name == 'rclpy': raise ImportError('test: unavailable')
            return original_import(name, *args, **kwargs)
        with patch('app.services.ros2_service.settings.SIMULATION_MODE',False), patch('builtins.__import__',side_effect=importing):
            with self.assertLogs('app.services.ros2_service',level='ERROR'):
                self.bridge.start()
        self.assertEqual(self.state.source,'disconnected')
        self.assertIsNone(self.bridge._sim_task)

    async def test_route_waits_correlated_receipt_and_starts_once(self):
        self.ready(); sent=[]
        def publish(topic,data):
            sent.append((topic,data))
            if topic=='/vehicle_run_star': self.bridge._on_nav_result(NS(data=self.bridge.navigation['id']+'\nrunning'))
            if topic=='/path_point':
                self.bridge._on_nav_result(NS(data='old\nsuccess'))
                self.assertEqual(self.bridge.navigation['status'],'sending')
                self.bridge._on_nav_result(NS(data=self.bridge.navigation['id']+'\naccepted'))
        self.bridge.publish=publish
        result=await self.bridge.route([0.,0.,0.,1.,.2,0.,0.,0.,0.]*2,start=True)
        self.assertEqual(result['status'],'running')
        self.assertEqual([t for t,_ in sent],['/path_point','/vehicle_run_star'])
        self.bridge._on_nav_result(NS(data=result['id']+'\naccepted'))
        self.assertEqual(self.bridge.navigation['status'],'running')
        self.bridge._on_nav_result(NS(data=result['id']+'\nsuccess'))
        self.assertEqual(self.bridge.navigation['status'],'success')

    async def test_reject_malformed_path_and_stale_localization(self):
        self.ready()
        with self.assertRaises(ValueError): await self.bridge.route([0.]*19)
        with self.assertRaises(ValueError): await self.bridge.route([float('nan')]*9)
        self.state.localization_received=time.monotonic()-3
        with self.assertRaises(RuntimeError): await self.bridge.route([0.]*18)

    async def test_switch_waits_loaded_then_initial_pose_then_convergence(self):
        self.ready();sent=[]
        def publish(topic,data):
            sent.append(topic)
            if topic=='/close_route': self.bridge._event('/close_route_finish',6)
            if topic=='/localization/map_request':
                key=data.split('\n')[0]
                self.bridge._on_map_result(NS(data='old\nready\nwrong'))
                self.assertEqual(self.bridge.switch['status'],'loading')
                self.bridge._on_map_result(NS(data=key+'\nloaded\n/test.pcd'))
        self.bridge.publish=publish
        def initial_message():
            return NS(header=NS(),pose=NS(pose=NS(position=NS(),orientation=NS()),covariance=[0.]*36))
        def initial_publish(msg):
            sent.append('/initialpose')
            self.assertEqual(msg.header.frame_id,'map')
            self.assertAlmostEqual(msg.pose.pose.orientation.z,math.sqrt(.5))
            self.bridge._on_tf_pose(pose(2))
            self.bridge._on_quality(NS(data=[1.,.1,.01]))
            self.bridge._on_map_result(NS(data=self.bridge.switch['id']+'\nready\n/test.pcd'))
        self.bridge.types['/initialpose']=initial_message
        self.bridge.publishers['/initialpose']=NS(get_subscription_count=lambda:1,publish=initial_publish)
        result=await self.bridge.switch_map('/test.pcd',1.,2.,math.pi/2)
        self.assertEqual(result['status'],'ready')
        self.assertTrue(self.bridge.inhibited)
        self.assertEqual(sent,['/vehicle_run_star','/close_route','/localization/map_request','/initialpose'])

    async def test_switch_failure_remains_inhibited(self):
        self.ready()
        def publish(topic,data):
            if topic=='/close_route':self.bridge._event('/close_route_finish',6)
            if topic=='/localization/map_request':self.bridge._on_map_result(NS(data=self.bridge.switch['id']+'\nfailed\ninvalid PCD'))
        self.bridge.publish=publish
        with self.assertRaisesRegex(RuntimeError,'invalid PCD'):
            await self.bridge.switch_map('/bad.pcd',0,0,0)
        self.assertEqual(self.bridge.switch['status'],'failed')
        self.assertTrue(self.bridge.inhibited)

    async def test_map_catalog_rejects_escape(self):
        from app.api.localization import catalog
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)/'maps';root.mkdir();(root/'good.pcd').write_text('pcd')
            registry=Path(temp)/'catalog.json';registry.write_text('[{"key":"bad","pcd":"../outside.pcd"},{"key":"good","pcd":"good.pcd"}]')
            (Path(temp)/'outside.pcd').write_text('pcd')
            with patch('app.api.localization.settings.PCD_DIR',root),patch.dict('os.environ',{'ROS_MAP_CATALOG':str(registry)}):
                self.assertEqual([r['key'] for r in catalog()],['good'])

    async def test_graph_uses_edges_and_refuses_forbidden_route(self):
        from app.services.local_robot import plan
        from app.services.map_editor import MapData
        document=MapData.model_validate({'points':[{'code':'A','x':0,'y':0},{'code':'B','x':2,'y':0},{'code':'C','x':2,'y':2}],
            'paths':[{'start':'A','end':'B','bidirectional':False},{'start':'B','end':'C'}]}).model_dump()
        with patch('app.services.local_robot.state',self.state):
            payload=plan(document,'C')
            self.assertEqual(len(payload),27)
            self.assertEqual(payload[9:11],[2,0])
            self.assertLessEqual(payload[4],.3)
            document['areas']=[{'type':'forbidden','polygon':[(.5,-1),(1.5,-1),(1.5,1),(.5,1)],'speed':.1}]
            with self.assertRaises(ValueError):plan(document,'C')


if __name__=='__main__':unittest.main()
