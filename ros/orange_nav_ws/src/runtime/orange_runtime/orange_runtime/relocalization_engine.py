"""Bounded planar global registration. Open3D runs in a killable child process."""
import math
import numpy as np


def planar_pose(matrix, max_tilt=0.15, max_height=0.30):
    t=np.asarray(matrix,dtype=float)
    if t.shape!=(4,4) or not np.isfinite(t).all():raise ValueError('配准变换无效')
    if abs(t[2,3])>max_height or math.acos(float(np.clip(t[2,2],-1,1)))>max_tilt:
        raise ValueError('配准高度或倾角超出平面车辆限制')
    return float(t[0,3]),float(t[1,3]),math.atan2(t[1,0],t[0,0])


def separate(a,b,distance=1.,angle=.35):
    return math.hypot(a[0]-b[0],a[1]-b[1])>distance or abs(math.atan2(math.sin(a[2]-b[2]),math.cos(a[2]-b[2])))>angle


def choose(candidates,minimum_overlap=.65,maximum_rmse=.15,ambiguity_margin=.08):
    valid=[c for c in candidates if math.isfinite(c['fitness']) and math.isfinite(c['rmse']) and
           c['fitness']>=minimum_overlap and c['rmse']<=maximum_rmse]
    if not valid:raise ValueError('没有达到重叠率和误差要求的候选位置')
    valid.sort(key=lambda c:(-c['fitness'],c['rmse']))
    best=valid[0]
    if any(separate(best['pose'],c['pose']) and best['fitness']-c['fitness']<ambiguity_margin for c in valid[1:]):
        raise ValueError('存在多个相似候选位置，请人工拖拽重定位')
    return best


def search(path,frames,config):
    import open3d as o3d
    reg=o3d.pipelines.registration
    voxel=config['voxel']
    def prepare(cloud):
        cloud=cloud.voxel_down_sample(voxel)
        if not 100<=len(cloud.points)<=config['max_points']:raise ValueError('点云点数不足或地图过大，请调整分辨率/裁剪地图')
        cloud.estimate_normals(o3d.geometry.KDTreeSearchParamHybrid(radius=voxel*2,max_nn=30))
        return cloud
    target=prepare(o3d.io.read_point_cloud(path,remove_nan_points=True,remove_infinite_points=True))
    sources=[]
    for points in frames:
        cloud=o3d.geometry.PointCloud();cloud.points=o3d.utility.Vector3dVector(points);sources.append(prepare(cloud))
    source=sources[0]
    feature=lambda cloud:reg.compute_fpfh_feature(cloud,o3d.geometry.KDTreeSearchParamHybrid(radius=voxel*5,max_nn=100))
    sf,tf=feature(source),feature(target)
    candidates=[]
    # Independent hypotheses make ambiguity visible; they do not prove uniqueness in repeated scenes.
    for _ in range(config['attempts']):
        result=reg.registration_ransac_based_on_feature_matching(source,target,sf,tf,True,voxel*1.5,
            reg.TransformationEstimationPointToPoint(False),3,
            [reg.CorrespondenceCheckerBasedOnEdgeLength(.9),reg.CorrespondenceCheckerBasedOnDistance(voxel*1.5)],
            reg.RANSACConvergenceCriteria(config['iterations'],.999))
        refined=reg.registration_icp(source,target,voxel,result.transformation,
            reg.TransformationEstimationPointToPlane(),reg.ICPConvergenceCriteria(max_iteration=60))
        try:pose=planar_pose(refined.transformation,config['max_tilt'],config['max_height'])
        except ValueError:continue
        # Only the planar pose can be handed to the existing /initialpose workflow.
        x,y,yaw=pose;t=np.eye(4);t[:2,:2]=[[math.cos(yaw),-math.sin(yaw)],[math.sin(yaw),math.cos(yaw)]];t[:2,3]=[x,y]
        fits=[];errors=[];stable=True
        for scan in sources:
            check=reg.registration_icp(scan,target,voxel,t,reg.TransformationEstimationPointToPlane(),reg.ICPConvergenceCriteria(max_iteration=30))
            try:checked=planar_pose(check.transformation,config['max_tilt'],config['max_height'])
            except ValueError:stable=False;break
            if separate(pose,checked,.15,.08):stable=False;break
            evaluation=reg.evaluate_registration(scan,target,voxel,t)
            fits.append(float(evaluation.fitness));errors.append(float(evaluation.inlier_rmse))
        if stable:candidates.append({'pose':pose,'fitness':min(fits),'rmse':max(errors)})
    best=choose(candidates,config['minimum_overlap'],config['maximum_rmse'],config['ambiguity_margin'])
    return {'x':best['pose'][0],'y':best['pose'][1],'yaw':best['pose'][2],
            'overlap':best['fitness'],'rmse':best['rmse'],'candidates':len(candidates)}


def worker(connection,path,frames,config):
    try:connection.send({'status':'candidate',**search(path,frames,config)})
    except Exception as exc:connection.send({'status':'failed','message':str(exc)[:500]})
    finally:connection.close()
