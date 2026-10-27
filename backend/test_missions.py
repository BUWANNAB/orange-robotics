"""Task-chain journeys with an isolated database and authenticated device receipts."""
import asyncio
from datetime import timedelta
import unittest

import test_operations as fixtures  # Configures a temporary database before app imports.
from app.database import AsyncSessionLocal
from app.models.operations import MissionRun, Robot, TaskRun
from app.services.fleet_service import queue_command
from app.services.operations_common import now
from app.services.operations_worker import tick
from app.services.mission_service import validate_chain
from fastapi import HTTPException


class MissionWorkflowTests(unittest.TestCase):
    call = fixtures.OperationsTests.call

    @classmethod
    def setUpClass(cls):
        fixtures.OperationsTests.setUpClass()
        cls.client, cls.headers = fixtures.OperationsTests.client, fixtures.OperationsTests.headers

    @classmethod
    def tearDownClass(cls):
        fixtures.OperationsTests.tearDownClass()

    def setUp(self):
        self.mode('manual')
        self.robot = None

    def mode(self, mode):
        self.call('POST', '/api/task-mode', {'mode':mode,'confirmation':'切换到'+{'manual':'手动','auto':'自动','schedule':'调度'}[mode]})

    def setup_plan(self, steps=None, repeat_count=1, automatic_robot=False):
        name = self._testMethodName
        row = self.call('POST','/api/maps',{'name':name,'document':fixtures.MAP})
        self.map_id = row['id']
        self.call('POST',f'/api/maps/{self.map_id}/publish',{'revision':0,'confirmation':name})
        self.robot = self.call('POST','/api/robots',{'code':name,'name':name,'model':'AMR','map_id':self.map_id})
        self.client.post(f"/api/devices/{self.robot['id']}/telemetry",headers={'X-Device-Key':self.robot['device_key']},
                         json={'seq':1,'battery':80,'map_version':1,'capabilities':['execute-task','emergency-stop','goto-point','load-map']}).raise_for_status()
        self.plan = self.call('POST','/api/task-plans',{'name':name,'map_id':self.map_id,'start_point':'A',
            'steps':steps or [{'point':'C'},{'point':'A'}], 'repeat_count':repeat_count,
            'robot_id':None if automatic_robot else self.robot['id']})
        return self.plan

    def start(self, mode='auto', **extras):
        self.mode(mode)
        self.run = self.call('POST',f"/api/task-plans/{self.plan['id']}/runs",
            {'confirmation':self.plan['name'],'task_mode':mode,**extras})
        return self.run

    def current(self):
        return next(row for row in self.call('GET','/api/mission-runs',params={'map_id':self.map_id}) if row['id']==self.run['id'])

    def control(self, action, expected=200):
        return self.call('POST',f"/api/mission-runs/{self.run['id']}/{action}",{'confirmation':self.plan['name']},expected)

    def receipt(self, status='success'):
        current = self.current()
        commands = self.client.get(f"/api/devices/{self.robot['id']}/commands",
            headers={'X-Device-Key':self.robot['device_key']}).json()['data']
        command = next(row for row in commands if row['params'].get('task_id')==current['active_task_id'])
        response = self.client.post(f"/api/devices/{self.robot['id']}/commands/{command['id']}/receipt",
            headers={'X-Device-Key':self.robot['device_key']},json={'status':status,'result':'device '+status})
        self.assertEqual(response.status_code,200,response.text)

    def tick(self):
        asyncio.run(tick())

    def expire_wait(self, field='next_at'):
        async def expire():
            async with AsyncSessionLocal() as db:
                run = await db.get(MissionRun,self.run['id'])
                setattr(run,field,now()-timedelta(seconds=1))
                await db.commit()
        asyncio.run(expire())

    def test_auto_repeat_advances_only_after_receipts(self):
        self.setup_plan(repeat_count=2)
        self.start()
        self.tick()
        first=self.current()['active_task_id']
        self.tick()
        self.assertEqual(self.current()['active_task_id'],first)
        for _ in range(4):
            self.receipt(); self.tick()
        self.assertEqual(self.current()['status'],'success')
        self.assertEqual(self.current()['cycles_completed'],2)
        self.assertEqual(self.call('GET','/api/task-history',params={'map_id':self.map_id})['total'],4)
        self.assertEqual(self.call('GET','/api/task-history',params={'map_id':self.map_id,'exclude_missions':True})['total'],0)

    def test_manual_advance_rejects_duplicates_and_failure_stops_chain(self):
        self.setup_plan(); self.start('manual')
        self.tick(); self.assertIsNone(self.current()['active_task_id'])
        self.control('advance'); self.control('advance',409)
        self.tick(); self.receipt('failed'); self.tick()
        self.assertEqual(self.current()['status'],'failed')
        self.assertEqual(self.call('GET','/api/task-history',params={'map_id':self.map_id})['total'],1)

    def test_schedule_pauses_and_resumes_without_starting_early(self):
        self.setup_plan()
        self.start('schedule',scheduled_at=(now()+timedelta(hours=1)).isoformat()+'Z')
        self.control('pause'); self.tick()
        self.assertEqual(self.current()['status'],'paused')
        self.control('resume'); self.tick()
        self.assertEqual(self.current()['status'],'queued')
        self.assertIsNone(self.current()['active_task_id'])
        self.expire_wait('scheduled_at'); self.tick()
        self.assertEqual(self.current()['active_task']['status'],'dispatched')

    def test_pause_finishes_current_segment_then_resumes_next_once(self):
        self.setup_plan(); self.start(); self.tick()
        self.assertEqual(self.control('pause')['status'],'pausing')
        self.receipt(); self.tick()
        self.assertEqual(self.current()['status'],'paused')
        self.assertIsNone(self.current()['active_task_id'])
        self.tick(); self.assertIsNone(self.current()['active_task_id'])
        self.control('resume'); self.tick()
        self.assertEqual(self.current()['active_task']['to_point'],'A')
        self.receipt(); self.tick(); self.assertEqual(self.current()['status'],'success')

    def test_manual_resume_waits_for_operator_and_blocks_publish_while_paused(self):
        self.setup_plan(); self.start('manual')
        self.control('pause')
        row=self.call('GET',f'/api/maps/{self.map_id}')
        self.call('POST',f'/api/maps/{self.map_id}/publish',{'revision':row['revision'],'confirmation':row['name']},409)
        self.assertEqual(self.control('resume')['status'],'waiting_manual')
        self.tick(); self.assertIsNone(self.current()['active_task_id'])

    def test_final_station_dwell_is_observed_in_manual_mode(self):
        self.setup_plan(steps=[{'point':'C','delay_seconds':30}]); self.start('manual')
        self.control('advance'); self.tick(); self.receipt(); self.tick()
        self.assertEqual(self.current()['status'],'finishing')
        self.tick(); self.assertEqual(self.current()['status'],'finishing')
        self.expire_wait(); self.tick(); self.assertEqual(self.current()['status'],'success')

    def test_robot_is_reserved_during_chain_wait_and_released_on_cancel(self):
        self.setup_plan(steps=[{'point':'C','delay_seconds':30},{'point':'A'}],automatic_robot=True)
        self.start(); self.tick(); self.receipt(); self.tick()
        task=self.call('POST','/api/task-history',{'name':'other task','map_id':self.map_id,
            'robot_id':self.robot['id'],'from_point':'C','to_point':'A','priority':9})
        self.tick()
        history=self.call('GET','/api/task-history',params={'map_id':self.map_id})['list']
        self.assertEqual(next(row for row in history if row['id']==task['id'])['status'],'queued')
        blocked=self.call('POST',f"/api/robots/{self.robot['id']}/commands/goto-point",
            {'confirmation':self.robot['code'],'key':'reserved-point','params':{'point':'A'}},409)
        self.assertIn('任务链',blocked.json()['detail'])
        self.control('cancel'); self.tick()
        history=self.call('GET','/api/task-history',params={'map_id':self.map_id})['list']
        self.assertEqual(next(row for row in history if row['id']==task['id'])['status'],'dispatched')

    def test_map_load_remains_possible_before_first_navigation_dispatch(self):
        self.setup_plan()
        self.client.post(f"/api/devices/{self.robot['id']}/telemetry",headers={'X-Device-Key':self.robot['device_key']},
            json={'seq':2,'battery':80,'map_version':0,'capabilities':['execute-task','load-map']}).raise_for_status()
        self.start(); self.tick()
        self.assertIsNone(self.current()['started_at'])
        self.assertEqual(self.current()['active_task']['status'],'queued')
        async def load_map():
            async with AsyncSessionLocal() as db:
                robot = await db.get(Robot,self.robot['id'])
                command = await queue_command(db,robot,'load-map',{'map_id':self.map_id},'admin','load-before-start')
                await db.commit()
                return command.status
        self.assertEqual(asyncio.run(load_map()),'queued')

    def test_blocked_high_priority_queue_cannot_starve_chain_continuation(self):
        self.setup_plan(steps=[{'point':'C','delay_seconds':30},{'point':'A'}])
        self.start(); self.tick(); self.receipt(); self.tick()
        async def fill_queue():
            async with AsyncSessionLocal() as db:
                db.add_all([TaskRun(name=f'blocked {index}',map_id=self.map_id,robot_id=self.robot['id'],
                    from_point='C',to_point='A',priority=9) for index in range(101)])
                await db.commit()
        asyncio.run(fill_queue()); self.expire_wait(); self.tick()
        self.assertEqual(self.current()['active_task']['status'],'dispatched')

    def test_mode_changes_require_fresh_execution_confirmation(self):
        self.setup_plan(); self.mode('auto')
        self.call('POST',f"/api/task-plans/{self.plan['id']}/runs",{'confirmation':self.plan['name'],'task_mode':'manual'},409)
        self.assertEqual(self.call('GET','/api/mission-runs',params={'map_id':self.map_id}),[])

    def test_recent_timeline_is_bounded_for_long_running_loops(self):
        self.setup_plan(); self.start('manual')
        async def seed_events():
            async with AsyncSessionLocal() as db:
                run=await db.get(MissionRun,self.run['id'])
                run.timeline=[{'status':'running','note':str(index)} for index in range(600)]
                await db.commit()
        asyncio.run(seed_events())
        result=self.control('pause')
        self.assertEqual(len(result['timeline']),500)
        self.assertEqual(result['timeline'][-1]['status'],'paused')
        self.assertEqual(result['timeline'][0]['note'],'101')

    def test_navigation_can_target_a_station_via_intermediate_routes(self):
        self.setup_plan()
        row=self.call('POST','/api/maps',{'name':'connected-route','document':{'width':20,'height':20,
            'points':[{'code':'A','x':1,'y':1},{'code':'B','x':3,'y':1},{'code':'C','x':5,'y':1}],
            'paths':[{'start':'A','end':'B','bidirectional':False},{'start':'B','end':'C','bidirectional':False}],'areas':[]}})
        self.call('POST',f"/api/maps/{row['id']}/publish",{'revision':0,'confirmation':row['name']})
        self.call('POST','/api/task-plans',{'name':'via B','map_id':row['id'],'start_point':'A','steps':[{'point':'C'}]})
        self.call('POST','/api/task-history',{'name':'reachable navigation','map_id':row['id'],'from_point':'A','to_point':'C'})
        self.call('POST','/api/task-history',{'name':'wrong direction','map_id':row['id'],'from_point':'C','to_point':'A'},400)
        self.call('POST','/api/task-plans',{'name':'cannot repeat','map_id':row['id'],'start_point':'A','steps':[{'point':'C'}],'repeat_count':2},400)
        with self.assertRaises(HTTPException):
            validate_chain({'points':[{'code':'A'},{'code':'C'}],'paths':[{'start':'A','end':'C','bidirectional':False}]},'C',[{'point':'A'}],1)


if __name__ == '__main__':
    unittest.main()
