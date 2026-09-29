"""Real Open3D synthetic registration, not ROS/hardware acceptance."""
import sys
import math
import tempfile
import unittest
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'ros/orange_nav_ws/src/runtime/orange_runtime'))
from orange_runtime.relocalization_engine import choose,planar_pose,search
from orange_runtime.motion_report import derivatives


class RelocalizationTests(unittest.TestCase):
    def test_motion_report_gaps_and_derivatives(self):
        data=derivatives([(0,0,0),(.1,.02,0),(.2,.04,.01),(.8,0,0)])
        self.assertAlmostEqual(data[1][3],.2)
        self.assertAlmostEqual(data[2][5],0)
        self.assertIsNone(data[3][3])
    def test_ambiguity_and_quality_rejection(self):
        a={'pose':(1,2,0),'fitness':.9,'rmse':.05}
        self.assertEqual(choose([a])['pose'],a['pose'])
        with self.assertRaises(ValueError):choose([a,{**a,'pose':(10,2,0),'fitness':.88}])
        with self.assertRaises(ValueError):choose([{**a,'fitness':.3}])
        with self.assertRaises(ValueError):choose([{**a,'rmse':float('nan')}])
        t=np.eye(4);t[2,3]=1
        with self.assertRaises(ValueError):planar_pose(t)

    def test_real_registration_recovers_known_planar_transform(self):
        import open3d as o3d
        o3d.utility.random.seed(27)
        rng=np.random.default_rng(19)
        # Asymmetric collection of surfaces; no precomputed pose is passed to the search.
        clouds=[]
        for center,size in [([0,0,1],[2,1,2]),([3,1,1],[1,2,1]),([-2,3,.7],[1,1,1.4])]:
            points=rng.uniform(-.5,.5,(1500,3));axis=rng.integers(0,3,1500);points[np.arange(1500),axis]=rng.choice([-.5,.5],1500)
            clouds.append(points*np.array(size)+center)
        world=np.vstack(clouds);yaw=.65;x,y=4.,-2.
        rotation=np.array([[math.cos(yaw),-math.sin(yaw),0],[math.sin(yaw),math.cos(yaw),0],[0,0,1]])
        source=(world-[x,y,0])@rotation
        config={'voxel':.18,'max_points':200000,'attempts':3,'iterations':30000,
                'max_tilt':.15,'max_height':.3,'minimum_overlap':.65,'maximum_rmse':.15,'ambiguity_margin':.08}
        cloud=o3d.geometry.PointCloud();cloud.points=o3d.utility.Vector3dVector(world)
        with tempfile.TemporaryDirectory() as temp:
            file=str(Path(temp)/'map.pcd');o3d.io.write_point_cloud(file,cloud)
            result=search(file,[source+rng.normal(0,.002,source.shape) for _ in range(3)],config)
        self.assertLess(math.hypot(result['x']-x,result['y']-y),.12)
        self.assertLess(abs(result['yaw']-yaw),.08)
        self.assertGreater(result['overlap'],.8)


if __name__=='__main__':unittest.main()
