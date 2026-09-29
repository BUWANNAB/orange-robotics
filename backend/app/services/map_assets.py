"""One map identity for PCD, PGM/YAML and processing jobs."""
import asyncio
import io
import json
import math
import os
import re
import shutil
import time
import uuid
from pathlib import Path
from PIL import Image
import yaml
from app.config import settings

tasks = {}
processor_lock = asyncio.Lock()


def identity(value):
    value = str(value).replace('\\', '/')
    if not value or len(value) > 180 or any(part in {'', '.', '..'} or not re.fullmatch(r'[\w .-]+', part) for part in value.split('/')):
        raise ValueError('地图名称只允许文字、数字、空格、横线和下划线，不允许越级路径')
    if any(part.startswith('.') or part.endswith((' ', '.')) or part.split('.')[0].upper() in {'CON','PRN','AUX','NUL',*[f'COM{i}' for i in range(1,10)],*[f'LPT{i}' for i in range(1,10)]} for part in value.split('/')):
        raise ValueError('地图名称不能使用隐藏目录或系统保留名称')
    return value


def path_in(root, key):
    root = Path(root).resolve()
    path = (root / identity(key)).resolve()
    if not path.is_relative_to(root): raise ValueError('地图路径越界')
    return path


def asset(key):
    key = identity(key)
    pcd = path_in(settings.PCD_DIR, key) / 'GlobalMap.pcd'
    grid = path_in(settings.MAPS_DIR, key) / 'setting'
    checked_file(settings.PCD_DIR, pcd)
    for name in ('map.pgm','map.yaml'): checked_file(settings.MAPS_DIR,grid/name)
    metadata = {}
    if (grid/'map.yaml').is_file():
        metadata = yaml.safe_load((grid/'map.yaml').read_text(encoding='utf-8')) or {}
        if not isinstance(metadata,dict): raise ValueError('地图 YAML 必须是对象')
    return {'id':key, 'name':key, 'pcd':pcd.is_file(), 'grid':(grid/'map.pgm').is_file() and (grid/'map.yaml').is_file(),
            'frame':'map', 'unit':'m', 'angle_unit':'rad', 'resolution':metadata.get('resolution'),
            'origin':metadata.get('origin'), 'revision':revision(grid)}


def checked_file(root, path):
    path = path.resolve()
    if not path.is_relative_to(Path(root).resolve()): raise ValueError('地图文件路径越界')
    return path


def revision(grid):
    import hashlib
    digest = hashlib.sha256()
    for name in ('map.pgm','map.yaml'):
        file = grid/name
        if file.is_file():
            with file.open('rb') as stream:
                for chunk in iter(lambda:stream.read(1024*1024),b''): digest.update(chunk)
    return digest.hexdigest()


def listing():
    keys = set()
    for root, filename in [(settings.PCD_DIR,'GlobalMap.pcd'),(settings.MAPS_DIR,'map.yaml')]:
        if not root.is_dir(): continue
        for file in root.rglob(filename):
            if any(part.startswith('.') for part in file.relative_to(root).parts): continue
            parent = file.parent.parent if filename=='map.yaml' and file.parent.name=='setting' else file.parent
            key = parent.relative_to(root).as_posix()
            if key != '.': keys.add(key)
    result = []
    for key in sorted(keys):
        try: result.append(asset(key))
        except (ValueError, yaml.YAMLError, OSError): continue
    return result


def validate_grid(pgm, metadata):
    if len(pgm)>80*1024*1024 or len(metadata)>65536: raise ValueError('地图文件过大')
    if not pgm.startswith(b'P5'): raise ValueError('地图需要 P5 灰度 PGM')
    with Image.open(io.BytesIO(pgm)) as image:
        if image.width*image.height>40_000_000 or image.mode != 'L': raise ValueError('地图尺寸或像素格式无效')
        image.load()
    try: config = yaml.safe_load(metadata)
    except yaml.YAMLError as exc: raise ValueError('YAML 内容无法解析') from exc
    if not isinstance(config,dict): raise ValueError('YAML 内容无效')
    try: resolution = float(config.get('resolution',0))
    except (TypeError,ValueError) as exc: raise ValueError('分辨率必须是有效数字') from exc
    origin = config.get('origin')
    if not math.isfinite(resolution) or not 0 < resolution <= 10: raise ValueError('分辨率单位为米/像素，且必须大于零')
    if not isinstance(origin,list) or len(origin)!=3 or not all(math.isfinite(float(v)) for v in origin): raise ValueError('origin 必须是 [x米,y米,yaw弧度]')
    config['image']='map.pgm'
    config['resolution']=resolution
    config['origin']=[float(v) for v in origin]
    return yaml.safe_dump(config,allow_unicode=True,sort_keys=False).encode()


def write_grid(key, pgm, metadata, expected=None, create_only=False):
    metadata = validate_grid(pgm,metadata)
    directory = path_in(settings.MAPS_DIR,key)
    target = directory/'setting'
    if not target.resolve().is_relative_to(Path(settings.MAPS_DIR).resolve()): raise ValueError('地图路径越界')
    if create_only and (directory.exists() or path_in(settings.PCD_DIR,key).exists()): raise ValueError('目标地图已存在，请使用新名称')
    if expected is not None and revision(target)!=expected: raise ValueError('地图已被其他操作修改，请重新加载')
    from app.services.ros2_service import ros2_service
    active = ros2_service.switch.get('path')
    if active and Path(active).resolve() == (path_in(settings.PCD_DIR,key)/'GlobalMap.pcd').resolve():
        raise ValueError('此地图正在定位使用，请另存为新地图后再切换')
    directory.mkdir(parents=True,exist_ok=True)
    stage = directory/('.grid-'+uuid.uuid4().hex)
    stage.mkdir()
    (stage/'map.pgm').write_bytes(pgm);(stage/'map.yaml').write_bytes(metadata)
    history = directory/'.history';history.mkdir(exist_ok=True)
    backup = history/uuid.uuid4().hex
    if target.exists(): target.rename(backup)
    try: stage.rename(target)
    except OSError:
        if backup.exists(): backup.rename(target)
        raise
    return asset(key)


def jobs_root():
    root = settings.RCS_DATA_DIR / 'map-jobs'
    root.mkdir(parents=True,exist_ok=True)
    return root


def save_job(job):
    directory=jobs_root()/job['id'];directory.mkdir(exist_ok=True)
    temp=directory/'state.tmp';temp.write_text(json.dumps(job,ensure_ascii=False),encoding='utf-8');temp.replace(directory/'state.json')


def job_status(key):
    if not re.fullmatch(r'[a-f0-9]{32}',key): raise ValueError('任务编号无效')
    file=jobs_root()/key/'state.json'
    if not file.is_file(): raise FileNotFoundError('处理任务不存在')
    job=json.loads(file.read_text(encoding='utf-8'))
    if job['status'] in {'queued','running'} and key not in tasks:
        job.update(status='failed',message='服务重启，处理结果未确认；请检查后重新提交');save_job(job)
    return job


def submit(kind, operation):
    job={'id':uuid.uuid4().hex,'kind':kind,'status':'queued','created_at':time.time(),'message':'等待处理'}
    save_job(job)
    async def run():
        try:
            job.update(status='running',message='处理中');save_job(job)
            job['result']=await operation(job)
            job.update(status='success',message='处理完成')
        except asyncio.CancelledError:
            job.update(status='failed',message='服务停止，处理结果未确认')
            raise
        except Exception as exc:
            job.update(status='failed',message=str(exc)[:1000])
        finally:
            save_job(job);tasks.pop(job['id'],None)
    tasks[job['id']]=asyncio.create_task(run())
    return dict(job)


def processor_command():
    executable=os.getenv('PCD_PROCESSOR_EXECUTABLE')
    if executable:
        if not Path(executable).is_file(): raise ValueError('配置的点云处理程序不存在')
        return [executable]
    if not shutil.which('ros2'): raise ValueError('未找到 ROS 2 点云处理程序；请先编译 pcd2pgm 并 source 工作区')
    return ['ros2','run','pcd2pgm','map_asset_processor']


async def process(job, body):
    async with processor_lock:
        key=identity(body['source']);output=identity(body['output'])
        source=path_in(settings.PCD_DIR,key)/'GlobalMap.pcd'
        source=checked_file(settings.PCD_DIR,source)
        if not source.is_file(): raise ValueError('源点云不存在')
        pcd_target=path_in(settings.PCD_DIR,output);grid_target=path_in(settings.MAPS_DIR,output)
        if pcd_target.exists() or grid_target.exists(): raise ValueError('输出名称已存在，源地图不会被覆盖')
        directory=jobs_root()/job['id'];stage=directory/'output';stage.mkdir()
        spec={**body,'input':str(source),'directory':str(stage)}
        spec_path=directory/'request.json';spec_path.write_text(json.dumps(spec),encoding='utf-8')
        with (directory/'processor.log').open('wb') as log:
            child=await asyncio.create_subprocess_exec(*processor_command(),str(spec_path),stdout=log,stderr=log)
            try:
                code=await asyncio.wait_for(child.wait(),300)
            except BaseException:
                child.kill();await child.wait();raise
        if code: raise ValueError(f'点云处理失败（退出码 {code}），源文件未修改；请检查处理日志')
        if not (stage/'GlobalMap.pcd').is_file(): raise ValueError('处理程序未生成 PCD')
        pgm=(stage/'map.pgm').read_bytes();metadata=(stage/'map.yaml').read_bytes()
        validate_grid(pgm,metadata)
        stats=json.loads((stage/'result.json').read_text(encoding='utf-8'))
        # Stage on each destination filesystem; publish only complete directories.
        pcd_target.parent.mkdir(parents=True,exist_ok=True)
        temporary=pcd_target.parent/('.pcd-'+job['id']);temporary.mkdir()
        shutil.copyfile(stage/'GlobalMap.pcd',temporary/'GlobalMap.pcd')
        (temporary/'asset.json').write_text(json.dumps({'source':key,'parameters':body,'stats':stats}),encoding='utf-8')
        write_grid(output,pgm,metadata,create_only=True)
        try:
            temporary.rename(pcd_target)
        except OSError:
            # This directory was created by this job under the checked map root.
            shutil.rmtree(grid_target)
            raise
        return {'asset':asset(output),'stats':stats}
