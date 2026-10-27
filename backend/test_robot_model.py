"""Coordinate and URDF checks; no ROS daemon, hardware, or production files."""
import copy
import json
import math
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from xml.etree import ElementTree as ET

import test_operations as fixtures
from app.services import robot_model as service
from app.services.vehicle_state import VehicleState, quaternion_to_heading
from app.services.ros2_service import ros2_service as bridge

contract = service.contract
SENSOR = {"robot_mount":{"x":-500,"y":0,"z":1070,"roll":0,"pitch":0,"yaw":-90}}


class TransformTests(unittest.TestCase):
    def assertVector(self, actual, expected):
        for value, wanted in zip(actual, expected):
            self.assertAlmostEqual(value, wanted, places=10)

    def test_sensor_mount_applies_rotation_then_translation_in_parent(self):
        mount=contract.mount_from_sensor(SENSOR)
        self.assertVector(mount['translation'],[-.5,0,1.07])
        self.assertVector(contract.transform_point([1,0,0],mount['translation'],mount['quaternion']),[-.5,-1,1.07])
        self.assertAlmostEqual(math.hypot(*mount['quaternion']),1)

    def test_map_composition_and_inverse_preserve_lever_arm(self):
        mount=contract.mount_from_sensor(SENSOR)
        base=contract.transform_point([1,0,0],mount['translation'],mount['quaternion'])
        q=[0,0,math.sin(math.pi/4),math.cos(math.pi/4)]
        world=contract.transform_point(base,[10,20,0],q)
        self.assertVector(world,[11,19.5,1.07])
        self.assertVector(contract.transform_point([world[0]-10,world[1]-20,world[2]],[0,0,0],[0,0,-q[2],q[3]]),base)

    def test_urdf_keeps_base_origin_and_exact_lidar_joint(self):
        model=copy.deepcopy(contract.DEFAULT_MODEL);model['body']['center_x']=.3
        mount=contract.mount_from_sensor(SENSOR)
        root=ET.fromstring(contract.build_urdf(model,mount))
        self.assertEqual(root.find("joint[@name='livox_mount']/parent").get('link'),'base_link')
        origin=root.find("joint[@name='livox_mount']/origin")
        self.assertVector([float(x) for x in origin.get('xyz').split()],mount['translation'])
        self.assertVector([float(x) for x in origin.get('rpy').split()],mount['rpy'])
        self.assertEqual(root.find("link[@name='base_link']/visual[@name='body_visual']/origin").get('xyz').split()[0],'0.3')
        self.assertEqual(len(root.findall("link[@name='livox_frame']")),1)
        self.assertIsNone(root.find('.//collision'),'unmeasured visuals must never become collision geometry')

    def test_unconfigured_lidar_never_gets_a_fake_identity_mount(self):
        with self.assertRaises(ValueError):contract.mount_from_sensor({})
        root=ET.fromstring(contract.build_urdf(contract.DEFAULT_MODEL))
        self.assertIsNone(root.find("link[@name='livox_frame']"))

    def test_invalid_dimensions_and_quaternions_are_rejected(self):
        for value in (0,-1,float('nan'),float('inf'),True):
            model=copy.deepcopy(contract.DEFAULT_MODEL);model['body']['length']=value
            with self.assertRaises(ValueError):contract.validate_model(model)
        with self.assertRaises(ValueError):contract.transform_point([0,0,0],[0,0,0],[0,0,0,0])

    def test_heading_normalizes_quaternion_and_invalid_pose_does_not_refresh(self):
        self.assertAlmostEqual(quaternion_to_heading(0,0,.8,.8),90)
        state=VehicleState()
        with self.assertRaises(ValueError):state.update_pose(0,0,0,0,0,0,0)
        self.assertEqual(state.pose_received,0)

    def test_roll_pitch_yaw_follow_right_hand_rule(self):
        for key,point,expected in [('roll',[0,1,0],[0,0,1]),('pitch',[1,0,0],[0,0,-1]),('yaw',[1,0,0],[0,1,0])]:
            sensor={'robot_mount':dict.fromkeys(('x','y','z','roll','pitch','yaw'),0)}
            sensor['robot_mount'][key]=90
            mount=contract.mount_from_sensor(sensor)
            self.assertVector(contract.transform_point(point,[0,0,0],mount['quaternion']),expected)


class RobotModelApiTests(unittest.TestCase):
    call=fixtures.OperationsTests.call
    @classmethod
    def setUpClass(cls):
        fixtures.OperationsTests.setUpClass()
        cls.client,cls.headers=fixtures.OperationsTests.client,fixtures.OperationsTests.headers
    @classmethod
    def tearDownClass(cls):fixtures.OperationsTests.tearDownClass()

    def test_authenticated_read_save_and_urdf_use_identical_geometry(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'body.json';sensor=Path(directory)/'lidar.json'
            sensor.write_text(json.dumps(SENSOR),encoding='utf-8')
            with patch.object(service,'configuration_path',return_value=path),patch.object(service,'get_mid360_config_path',return_value=sensor):
                self.assertEqual(self.client.get('/api/robot-model').status_code,401)
                data=self.call('GET','/api/robot-model')
                self.assertFalse(data['model']['dimensions_confirmed'])
                self.assertFalse(data['runtime_verified'])
                model=data['model'];model['body']['width']=.9
                self.call('PUT','/api/robot-model',{'model':model,'confirmation':'wrong'},422)
                saved=self.call('PUT','/api/robot-model',{'model':model,'confirmation':'保存车体模型'})
                self.assertEqual(saved['model'],json.loads(path.read_text(encoding='utf-8')))
                response=self.client.get('/api/robot-model/urdf',headers=self.headers)
                self.assertEqual(response.status_code,200)
                self.assertEqual(response.text,contract.build_urdf(saved['model'],saved['mount']))

    def test_live_tf_check_requires_matching_mount_connected_tree_and_fresh_pose(self):
        data={'mount':contract.mount_from_sensor(SENSOR),'mount_pending':False}
        parents={'livox_frame':'base_link','base_link':'odom','odom':'map'}
        actual={'translation':data['mount']['translation'],'quaternion':data['mount']['quaternion'],'age_seconds':.1}
        with patch.object(service,'snapshot',return_value=data),patch.object(bridge,'require_ros'), \
             patch.object(bridge,'transform_snapshot',return_value=actual),patch.object(bridge,'frame_parents',return_value=parents):
            self.assertEqual(self.client.get('/api/robot-model/runtime-check').status_code,401)
            result=self.call('GET','/api/robot-model/runtime-check')
            self.assertTrue(result['runtime_verified'])
            self.assertEqual(result['parent_chain'],['map','odom','base_link'])
            actual['quaternion']=[-value*1.2 for value in actual['quaternion']]
            self.assertTrue(service.runtime_check()['mount_matches_tf'],'equivalent quaternion sign and scale are valid')
            parents['base_link']='map'
            self.assertFalse(service.runtime_check()['runtime_verified'],'direct map to base must not pass standard tree')
            parents['base_link']='odom'
            actual['age_seconds']=3
            self.assertFalse(service.runtime_check()['runtime_verified'],'stale dynamic TF must fail')
            actual['age_seconds']=.1
            actual['translation']=[0,0,0]
            self.assertFalse(service.runtime_check()['mount_matches_tf'])

    def test_live_tf_check_reports_missing_transform_and_disconnected_ros(self):
        data={'mount':contract.mount_from_sensor(SENSOR),'mount_pending':False}
        with patch.object(service,'snapshot',return_value=data),patch.object(bridge,'require_ros'), \
             patch.object(bridge,'transform_snapshot',side_effect=RuntimeError('TF unavailable')),patch.object(bridge,'frame_parents',return_value={}):
            result=self.call('GET','/api/robot-model/runtime-check')
            self.assertFalse(result['runtime_verified'])
            self.assertIsNone(result['mount_matches_tf'])
        with patch.object(bridge,'require_ros',side_effect=RuntimeError('真实 ROS 未连接')):
            self.call('GET','/api/robot-model/runtime-check',expected=409)


if __name__=='__main__':unittest.main()
