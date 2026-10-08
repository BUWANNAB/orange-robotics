"""File/API orchestration tests. PCL compilation and ROS hardware are not simulated as acceptance."""
import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, AsyncMock
from types import SimpleNamespace
import test_operations as fixtures  # Sets an isolated DB before any app imports.
from app.services import map_assets as assets, mapping_control as mapping
from app.config import settings

PGM=b'P5\n2 2\n255\n'+bytes([0,205,255,0])
YAML=b'image: map.pgm\nresolution: 0.05\norigin: [1, 2, 0]\n'


class MapWorkbenchTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        fixtures.OperationsTests.setUpClass()
        cls.client=fixtures.OperationsTests.client
        cls.headers=fixtures.OperationsTests.headers

    @classmethod
    def tearDownClass(cls):
        fixtures.OperationsTests.tearDownClass()

    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='map-assets-')
        self.root=Path(self.temp.name)
        self.patches=[patch.object(settings,'MAPS_DIR',self.root/'maps'),patch.object(settings,'PCD_DIR',self.root/'pcd'),
                      patch.object(settings,'RCS_DATA_DIR',self.root/'jobs')]
        for p in self.patches:p.start()

    def tearDown(self):
        for p in reversed(self.patches):p.stop()
        self.temp.cleanup()

    def upload(self,key,pgm=PGM,**data):
        return self.client.post('/api/map-workbench/grid',headers=self.headers,
                                data={'asset_id':key,**data},files={'pgm':('map.pgm',pgm),'metadata':('map.yaml',YAML)})

    def test_binding_publish_validation_persistence_conflict_and_remove(self):
        from app.api.localization import catalog
        from app.services.ros2_service import ros2_service as bridge
        pcd=settings.PCD_DIR/'binding-test'/'GlobalMap.pcd'
        pcd.parent.mkdir(parents=True);pcd.write_bytes(b'test')
        draft=self.client.post('/api/maps',headers=self.headers,json={'name':'binding-test','document':fixtures.MAP}).json()['data']
        response=self.client.get('/api/map-workbench/bindings',headers=self.headers)
        data=response.json()['data'];key=next(e['key'] for e in data['entries'] if e['asset_id']=='binding-test')
        body={'key':key,'map_id':draft['id'],'version':1,'revision':data['revision'],'coordinates_confirmed':True}
        self.assertEqual(self.client.post('/api/map-workbench/bindings',json=body).status_code,401)
        self.assertEqual(self.client.post('/api/map-workbench/bindings',headers=self.headers,json=body).status_code,409)
        published=self.client.post(f"/api/maps/{draft['id']}/publish",headers=self.headers,json={'revision':0,'confirmation':'binding-test'})
        self.assertEqual(published.status_code,200,published.text)
        self.assertEqual(self.client.post('/api/map-workbench/bindings',headers=self.headers,json={**body,'coordinates_confirmed':False}).status_code,400)
        active=dict(bridge.switch)
        response=self.client.post('/api/map-workbench/bindings',headers=self.headers,json=body)
        self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(bridge.switch,active)
        self.assertEqual(next(e for e in catalog() if e['key']==key)['map_id'],draft['id'])
        self.assertTrue((self.root/'jobs/map-bindings.json').is_file())
        self.assertEqual(self.client.post('/api/map-workbench/bindings',headers=self.headers,json=body).status_code,409)
        remove={**body,'map_id':None,'version':None,'revision':response.json()['data']['revision']}
        self.assertEqual(self.client.post('/api/map-workbench/bindings',headers=self.headers,json=remove).status_code,200)
        self.assertIsNone(next(e for e in catalog() if e['key']==key)['map_id'])

    def test_binding_legacy_catalog_overrides_and_new_asset_discovery(self):
        from app.api.localization import catalog
        from app.services import map_bindings
        for name in ['old','new']:
            pcd=settings.PCD_DIR/name/'GlobalMap.pcd';pcd.parent.mkdir(parents=True);pcd.write_bytes(b'test')
        registry=self.root/'legacy.json';registry.write_text(json.dumps([{'key':'custom','pcd':'old/GlobalMap.pcd','map_id':9,'version':1}]))
        with patch.dict('os.environ',{'ROS_MAP_CATALOG':str(registry)}):
            self.assertEqual(len(catalog()),2)
            self.assertEqual(next(e for e in catalog() if e['key']=='custom')['map_id'],9)
            map_bindings.save('custom',{'map_id':None,'version':None})
            self.assertIsNone(next(e for e in catalog() if e['key']=='custom')['map_id'])
            self.assertEqual(json.loads(registry.read_text())[0]['map_id'],9)

    def test_auto_localization_api_auth_and_offline_gates(self):
        from app.api.localization import catalog
        pcd=settings.PCD_DIR/'auto-test'/'GlobalMap.pcd';pcd.parent.mkdir(parents=True);pcd.write_bytes(b'test')
        key=next(e['key'] for e in catalog() if e['asset_id']=='auto-test')
        self.assertEqual(self.client.post('/api/localization/auto',json={'key':key}).status_code,401)
        self.assertEqual(self.client.post('/api/localization/auto',headers=self.headers,json={'key':key}).status_code,409)
        self.assertEqual(self.client.post('/api/localization/auto',headers=self.headers,json={'key':key,'path':'/etc/passwd'}).status_code,422)

    def test_identity_and_nested_asset(self):
        for key in ['../outside','a/../b','/tmp','a//b','a/.hidden','CON','trailing.']:
            with self.assertRaises(ValueError):assets.identity(key)
        self.assertEqual(assets.identity('车间/clean_1'),'车间/clean_1')
        row=assets.write_grid('车间/clean_1',PGM,YAML,create_only=True)
        self.assertEqual([a['id'] for a in assets.listing()],['车间/clean_1'])
        self.assertEqual(row['origin'],[1,2,0])

    def test_edited_save_as_and_revision_conflict(self):
        first=self.upload('original',create_only='true').json()['data']
        edited=PGM[:-1]+b'\xff'
        copied=self.upload('edited',edited,create_only='true')
        self.assertEqual(copied.status_code,200,copied.text)
        self.assertEqual((settings.MAPS_DIR/'edited/setting/map.pgm').read_bytes(),edited)
        self.assertEqual((settings.MAPS_DIR/'original/setting/map.pgm').read_bytes(),PGM)
        self.assertEqual(self.upload('original',edited).status_code,409)
        response=self.upload('original',edited,revision=first['revision'])
        self.assertEqual(response.status_code,200,response.text)
        conflict=self.upload('original',revision=first['revision'])
        self.assertEqual(conflict.status_code,409)
        self.assertIn('revision',response.json()['data'])
        backups=list((settings.MAPS_DIR/'original/.history').glob('*/map.pgm'))
        self.assertEqual(len(backups),1)
        self.assertEqual(backups[0].read_bytes(),PGM)

    def test_input_validation_and_auth(self):
        response=self.client.get('/api/map-workbench/assets')
        self.assertEqual(response.status_code,401)
        self.assertIn('message',response.json())
        for metadata in [b'[]',YAML.replace(b'0.05',b'.nan'),YAML.replace(b'[1, 2, 0]',b'[1, 2]')]:
            with self.assertRaises(ValueError):assets.validate_grid(PGM,metadata)
        response=self.client.post('/api/map-workbench/process',headers=self.headers,json={'source':'a','output':'b','z_min':2,'z_max':1})
        self.assertEqual(response.status_code,422,response.text)
        self.assertEqual(response.json()['code'],422)
        self.assertEqual(self.upload('../outside').status_code,409)

    def test_file_and_missing_processor(self):
        assets.write_grid('nested/map',PGM,YAML)
        response=self.client.get('/api/map-workbench/file/pgm/nested/map',headers=self.headers)
        self.assertEqual(response.content,PGM)
        with patch('app.services.map_assets.processor_command',side_effect=ValueError('未安装处理程序')):
            response=self.client.post('/api/map-workbench/process',headers=self.headers,json={'source':'a','output':'b'})
        self.assertEqual(response.status_code,409)
        self.assertEqual(response.json()['message'],'未安装处理程序')

    def test_processor_failure_preserves_source(self):
        source=settings.PCD_DIR/'source';source.mkdir(parents=True);(source/'GlobalMap.pcd').write_bytes(b'original')
        class Child:
            async def wait(self):return 1
        async def check():
            async def launch(*args,**kwargs):return Child()
            with patch.object(assets,'processor_command',return_value=['test-only-processor']),patch('asyncio.create_subprocess_exec',side_effect=launch):
                job=assets.submit('process',lambda job:assets.process(job,{'source':'source','output':'clean'}))
                await assets.tasks[job['id']]
                self.assertEqual(assets.job_status(job['id'])['status'],'failed')
        asyncio.run(check())
        self.assertEqual((source/'GlobalMap.pcd').read_bytes(),b'original')
        self.assertFalse((settings.MAPS_DIR/'clean').exists())

    def test_job_restart_is_failure_not_success(self):
        job={'id':'a'*32,'status':'running'};assets.save_job(job)
        self.assertEqual(assets.job_status(job['id'])['status'],'failed')

    def test_processor_output_commits_complete_asset(self):
        source=settings.PCD_DIR/'source';source.mkdir(parents=True);(source/'GlobalMap.pcd').write_bytes(b'original')
        class Child:
            async def wait(self):return 0
        async def check():
            async def launch(*args,**kwargs):
                spec=json.loads(Path(args[-1]).read_text());folder=Path(spec['directory'])
                (folder/'GlobalMap.pcd').write_bytes(b'test-only-filtered-pcd')
                (folder/'map.pgm').write_bytes(PGM);(folder/'map.yaml').write_bytes(YAML)
                (folder/'result.json').write_text('{"input_points":4,"output_points":3}')
                return Child()
            with patch.object(assets,'processor_command',return_value=['test-only-processor']),patch('asyncio.create_subprocess_exec',side_effect=launch):
                job=assets.submit('process',lambda job:assets.process(job,{'source':'source','output':'clean'}))
                await assets.tasks[job['id']]
                finished=assets.job_status(job['id'])
                self.assertEqual(finished['status'],'success',finished)
                self.assertTrue(finished['result']['asset']['pcd'])
                self.assertTrue(finished['result']['asset']['grid'])
        asyncio.run(check())
        self.assertEqual((source/'GlobalMap.pcd').read_bytes(),b'original')
        self.assertEqual((settings.MAPS_DIR/'clean/setting/map.pgm').read_bytes(),PGM)

    def test_offline_mapping_rejected(self):
        with patch.object(mapping,'require_navigation_stopped',new=AsyncMock()),patch.object(mapping.bridge,'require_mapping_ready',side_effect=RuntimeError('真实 ROS 未连接')):
            response=self.client.post('/api/map-workbench/mapping/start',headers=self.headers,json={'manual_push_confirmed':True})
        self.assertEqual(response.status_code,409)
        self.assertEqual(response.json()['message'],'真实 ROS 未连接')

    def test_pending_job_blocks_mapping_mutations(self):
        with patch.dict(assets.tasks,{'busy':object()}):
            for action,body in [('start',{'manual_push_confirmed':True}),('save',{'name':'new_map'}),('stop',{})]:
                response=self.client.post('/api/map-workbench/mapping/'+action,headers=self.headers,json=body)
                self.assertEqual(response.status_code,409,response.text)

    def test_mapping_start_requires_manual_confirmation_and_stopped_navigation(self):
        async def check():
            with self.assertRaisesRegex(RuntimeError,'手动/自由轮'):
                await mapping.start({},False)
            with patch('app.services.ros_runtime.unit_state',new=AsyncMock(return_value={'load':'loaded','state':'active'})):
                with self.assertRaisesRegex(RuntimeError,'必须已安装并确认停止'):
                    await mapping.require_navigation_stopped()
            with (patch('app.services.ros_runtime.unit_state',new=AsyncMock(return_value={'load':'loaded','state':'inactive'})),
                  patch('app.services.ros_runtime.graph',return_value=['vehicle_navigation_node'])):
                with self.assertRaisesRegex(RuntimeError,'导航节点仍在运行'):
                    await mapping.require_navigation_stopped()
        asyncio.run(check())

    def test_mapping_start_only_publishes_buildmap_and_waits_for_data_ack(self):
        calls=[]
        async def navigation_stopped():calls.append('navigation-stopped')
        def publish(topic,value):
            calls.append((topic,value));mapping.receive(SimpleNamespace(data='map_data_ready'))
        async def check():
            with patch.object(mapping,'active',False),patch.object(mapping.bridge,'switch',{}),patch.object(mapping.bridge,'require_mapping_ready'),patch.object(mapping,'require_navigation_stopped',side_effect=navigation_stopped),patch.object(mapping.bridge,'stop_route',side_effect=AssertionError('mapping must not send navigation stop commands')),patch.object(mapping.bridge,'publish',side_effect=publish):
                result=await mapping.start({},True)
                self.assertEqual(result['status'],'mapping')
                self.assertTrue(mapping.active)
        asyncio.run(check())
        self.assertEqual(calls,['navigation-stopped',('/buildmap','start')])


if __name__=='__main__':unittest.main()
