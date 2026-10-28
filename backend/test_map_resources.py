"""Real resource API journeys in a temporary database, never a live robot."""
import asyncio
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from contextlib import closing

import test_operations as fixtures
from app.database import AsyncSessionLocal
from app.models.operations import MapDocument, MapVersion, TaskPlan
from app.services.resource_identity import identify, bind_steps, identity_error
from scripts.migrate_map_resources import migrate


class ResourceTests(unittest.TestCase):
    call = fixtures.OperationsTests.call

    @classmethod
    def setUpClass(cls):
        fixtures.OperationsTests.setUpClass()
        cls.client, cls.headers = fixtures.OperationsTests.client, fixtures.OperationsTests.headers

    @classmethod
    def tearDownClass(cls):
        fixtures.OperationsTests.tearDownClass()

    def map(self, suffix=""):
        return self.call('POST','/api/maps',{'name':self._testMethodName+suffix,'document':fixtures.MAP})

    def inventory(self, row):
        return self.call('GET',f"/api/maps/{row['id']}/resources")

    def test_scope_same_codes_do_not_share_objects(self):
        a,b=self.map('A'),self.map('B')
        first,second=self.inventory(a),self.inventory(b)
        uid=first['document']['points'][0]['uid']
        self.assertNotEqual(uid,second['document']['points'][0]['uid'])
        self.call('PUT',f"/api/maps/{b['id']}/resources/points/{uid}",{'revision':0,'item':first['document']['points'][0]},404)
        self.assertEqual(self.inventory(b)['map']['revision'],0)

    def test_delete_recreate_same_code_three_times_preserves_snapshots(self):
        row=self.map()
        self.call('POST',f"/api/maps/{row['id']}/publish",{'revision':0,'confirmation':row['name']})
        snapshot=self.call('GET',f"/api/maps/{row['id']}/versions")[0]['document']
        previous_uid=None
        for _ in range(3):
            data=self.inventory(row);point=next(p for p in data['document']['points'] if p['code']=='A')
            self.assertNotEqual(point['uid'],previous_uid)
            impact=self.call('GET',f"/api/maps/{row['id']}/resources/points/{point['uid']}/impact")
            self.assertEqual(impact['plans'],[])
            self.call('POST',f"/api/maps/{row['id']}/resources/points/{point['uid']}/delete",{'revision':data['map']['revision'],'confirmation':'A','cascade_paths':True})
            data=self.inventory(row)
            self.assertEqual([p['code'] for p in data['document']['points']],['C'])
            self.call('POST',f"/api/maps/{row['id']}/resources/points",{'revision':data['map']['revision'],'item':{'code':'A','name':'收货口','x':1,'y':1}})
            previous_uid=point['uid']
        self.assertEqual(self.call('GET',f"/api/maps/{row['id']}/versions")[0]['document'],snapshot)

    def test_delete_route_keeps_shared_stations_and_checks_revision(self):
        row=self.map();data=self.inventory(row);path=data['document']['paths'][0]
        url=f"/api/maps/{row['id']}/resources/paths/{path['uid']}/delete"
        self.call('POST',url,{'revision':0,'confirmation':'wrong'},400)
        self.call('POST',url,{'revision':99,'confirmation':'A → C'},409)
        self.call('POST',url,{'revision':0,'confirmation':'A → C'})
        data=self.inventory(row);self.assertEqual(len(data['document']['points']),2);self.assertEqual(data['document']['paths'],[])

    def test_references_protect_both_table_and_main_editor(self):
        row=self.map();self.call('POST',f"/api/maps/{row['id']}/publish",{'revision':0,'confirmation':row['name']})
        plan=self.call('POST','/api/task-plans',{'name':'引用测试','map_id':row['id'],'start_point':'A','steps':[{'point':'C'}]})
        data=self.inventory(row);point=data['document']['points'][0]
        self.assertEqual(len(data['references']['A']['plans']),1)
        url=f"/api/maps/{row['id']}/resources/points/{point['uid']}"
        self.assertTrue(self.call('GET',url+'/impact')['blocked'])
        self.call('POST',url+'/delete',{'revision':1,'confirmation':'A','cascade_paths':True},409)
        draft=data['document'];draft['points'][0]['uid']='replacement-identity'
        self.call('POST',f"/api/maps/{row['id']}/draft/save",{'revision':1,'document':draft},409)
        self.assertEqual(self.inventory(row)['map']['revision'],1)

    def test_identity_check_rejects_silent_same_code_rebinding(self):
        row=self.map();self.call('POST',f"/api/maps/{row['id']}/publish",{'revision':0,'confirmation':row['name']})
        plan=self.call('POST','/api/task-plans',{'name':'身份检查','map_id':row['id'],'start_point':'A','steps':[{'point':'C'}]})
        async def corrupt_published_identity():
            from sqlalchemy import select
            async with AsyncSessionLocal() as db:
                version=await db.scalar(select(MapVersion).where(MapVersion.map_id==row['id']))
                document=json.loads(json.dumps(version.document));document['points'][1]['uid']='new-C-identity'
                version.document=document;await db.commit()
        asyncio.run(corrupt_published_identity())
        response=self.call('POST',f"/api/task-plans/{plan['id']}/runs",{'confirmation':plan['name']},409)
        self.assertIn('身份已变化',response.text)

    def test_map_name_reusable_after_repeated_soft_delete(self):
        name=self._testMethodName
        ids=[]
        for _ in range(3):
            row=self.call('POST','/api/maps',{'name':name});ids.append(row['id'])
            self.call('DELETE',f"/api/maps/{row['id']}",params={'confirmation':name})
        self.assertEqual(len(set(ids)),3)

    def test_invalid_duplicate_and_unauthorized_mutations_are_rejected(self):
        row=self.map();data=self.inventory(row);point=data['document']['points'][0]
        self.call('POST',f"/api/maps/{row['id']}/resources/points",{'revision':0,'item':point},409)
        duplicate_document=json.loads(json.dumps(data['document']))
        duplicate_document['points'].append({**point,'uid':'another-uid'})
        self.call('POST',f"/api/maps/{row['id']}/draft/save",{'revision':0,'document':duplicate_document},409)
        self.call('POST','/api/maps',{'name':'invalid-map','document':duplicate_document},409)
        self.call('POST',f"/api/maps/{row['id']}/resources/points",{'revision':0,'item':{'code':'NEW','x':'bad','y':1}},422)
        from unittest.mock import patch
        with patch.dict('os.environ',{'RCS_PERMISSIONS':'{"admin":["map:view"]}'}):
            self.call('POST',f"/api/maps/{row['id']}/resources/points",{'revision':0,'item':{'code':'NEW','x':1,'y':1}},403)
            self.assertEqual(self.inventory(row)['plans'],[])


class MigrationTests(unittest.TestCase):
    def test_backup_idempotence_and_history_preservation(self):
        with tempfile.TemporaryDirectory() as directory:
            source=Path(directory)/'source.db'
            with closing(sqlite3.connect(source)) as db:
                db.execute('CREATE TABLE rds_map(id INTEGER PRIMARY KEY,draft TEXT,revision INTEGER,deleted INTEGER,lock_until TEXT)')
                db.execute('CREATE TABLE rds_map_version(document TEXT)')
                document=json.dumps(fixtures.MAP)
                db.execute('INSERT INTO rds_map VALUES(1,?,0,0,NULL)',(document,))
                db.execute('INSERT INTO rds_map_version VALUES(?)',(document,))
                db.commit()
            self.assertEqual(len(migrate(source)['changed_maps']),1)
            first=migrate(source,Path(directory)/'backups',True)
            with closing(sqlite3.connect(first['backup'])) as backup:
                self.assertNotIn('uid',json.loads(backup.execute('SELECT draft FROM rds_map').fetchone()[0])['points'][0])
            self.assertEqual(migrate(source,Path(directory)/'backups',True)['changed_maps'],[])
            with closing(sqlite3.connect(source)) as db:
                self.assertEqual(db.execute('SELECT revision FROM rds_map').fetchone()[0],1)
                self.assertEqual(db.execute('SELECT document FROM rds_map_version').fetchone()[0],document)

    def test_duplicate_identity_is_rejected(self):
        with self.assertRaises(ValueError):
            identify({'points':[{'code':'A','uid':'same'},{'code':'B','uid':'same'}]})

    def test_active_editor_aborts_and_rolls_back_earlier_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            source=Path(directory)/'busy.db'
            with closing(sqlite3.connect(source)) as db:
                db.execute('CREATE TABLE rds_map(id INTEGER PRIMARY KEY,draft TEXT,revision INTEGER,deleted INTEGER,lock_until TEXT)')
                old=json.dumps(fixtures.MAP)
                db.execute('INSERT INTO rds_map VALUES(1,?,0,0,NULL)',(old,))
                db.execute('INSERT INTO rds_map VALUES(2,?,0,0,?)',(old,'2999-01-01 00:00:00'))
                db.commit()
            with self.assertRaisesRegex(ValueError,'正在编辑'):
                migrate(source,Path(directory)/'backups',True)
            with closing(sqlite3.connect(source)) as db:
                self.assertEqual(db.execute('SELECT sum(revision) FROM rds_map').fetchone()[0],0)
                self.assertEqual(db.execute('SELECT draft FROM rds_map WHERE id=1').fetchone()[0],old)
