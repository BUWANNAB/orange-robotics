"""Map editing contracts against the existing temporary-database fixture only."""
import asyncio
from copy import deepcopy
from datetime import timedelta
import unittest
from unittest.mock import patch

import test_operations as fixtures  # Configures and asserts an isolated SQLite DB before app imports.
from pydantic import ValidationError

from app.database import AsyncSessionLocal
from app.models.operations import MapDocument, TaskRun, MissionRun
from app.services.map_editor import MapData, validate_map
from app.services.operations_common import now


DOCUMENT = {
    "width": 20, "height": 20,
    "points": [{"code": "A", "x": 1, "y": 1}, {"code": "B", "x": 5, "y": 1},
               {"code": "C", "x": 9, "y": 1}],
    "paths": [{"start": "A", "end": "B"}, {"start": "B", "end": "C"}], "areas": [],
}


class ValidationTargetsTests(unittest.TestCase):
    def test_default_speed_accepts_legacy_maps_and_rejects_invalid_values(self):
        self.assertEqual(MapData.model_validate(DOCUMENT).default_speed, .5)
        for speed in (0, -1, 3.01, float('nan'), float('inf')):
            with self.subTest(speed=speed), self.assertRaises(ValidationError):
                MapData.model_validate({**DOCUMENT, "default_speed": speed})

    def test_nearby_points_include_both_targets_and_existing_fields(self):
        document = deepcopy(DOCUMENT)
        document["points"][1].update(x=1.05, y=1)
        issue = next(issue for issue in validate_map(document) if '间距' in issue['message'])
        self.assertEqual(issue['level'], 'error')
        self.assertEqual(issue['element'], 'B')
        self.assertEqual(issue['targets'], {'points': ['A', 'B'], 'paths': [], 'areas': []})

    def test_path_area_and_disconnected_issues_have_exact_targets(self):
        document = deepcopy(DOCUMENT)
        document['areas'] = [{'name': 'block', 'polygon': [[2, 0], [4, 0], [4, 2], [2, 2]]}]
        document['points'].append({'code': 'ISOLATED', 'x': 15, 'y': 15})
        issues = validate_map(document)
        crossing = next(issue for issue in issues if '禁行区' in issue['message'])
        self.assertEqual(crossing['targets'], {'points': ['A', 'B'], 'paths': [0], 'areas': [0]})
        isolated = next(issue for issue in issues if issue['element'] == 'ISOLATED')
        self.assertEqual(isolated['targets']['points'], ['ISOLATED'])
        document['areas'][0]['polygon'] = [[19, 1], [21, 1], [21, 2], [19, 2]]
        bounds = next(issue for issue in validate_map(document) if issue['message'] == '区域顶点越界')
        self.assertEqual(bounds['targets']['areas'], [0])


class MapEditingSafetyTests(unittest.TestCase):
    call = fixtures.OperationsTests.call

    @classmethod
    def setUpClass(cls):
        fixtures.OperationsTests.setUpClass()
        cls.client, cls.headers = fixtures.OperationsTests.client, fixtures.OperationsTests.headers

    @classmethod
    def tearDownClass(cls):
        fixtures.OperationsTests.tearDownClass()

    def map(self, document=None, suffix=''):
        return self.call('POST', '/api/maps', {'name': self._testMethodName + suffix,
                                             'document': document if document is not None else DOCUMENT})

    def preview(self, row, kind='points', index=1, document=None, revision=None, expected=200):
        return self.call('POST', f"/api/maps/{row['id']}/delete-preview", {
            'revision': row['revision'] if revision is None else revision,
            'document': document if document is not None else row['draft'], 'kind': kind, 'index': index,
        }, expected)

    def plan(self, row):
        self.call('POST', f"/api/maps/{row['id']}/publish", {'revision': row['revision'], 'confirmation': row['name']})
        self.call('POST', '/api/task-plans', {'name': self._testMethodName + '-chain', 'map_id': row['id'],
                                             'start_point': 'A', 'steps': [{'point': 'C'}]})
        return self.call('GET', f"/api/maps/{row['id']}")

    def test_default_speed_survives_save_publish_and_read(self):
        row = self.map({**deepcopy(DOCUMENT), 'default_speed': .27})
        self.assertEqual(row['draft']['default_speed'], .27)
        document = deepcopy(row['draft']); document['default_speed'] = .42
        saved = self.call('POST', f"/api/maps/{row['id']}/draft/save", {'revision': 0, 'document': document})
        self.call('POST', f"/api/maps/{row['id']}/publish", {'revision': saved['revision'], 'confirmation': row['name']})
        version = self.call('GET', f"/api/maps/{row['id']}/versions")[0]
        self.assertEqual(version['document']['default_speed'], .42)
        self.assertEqual(self.call('GET', f"/api/maps/{row['id']}")['draft']['default_speed'], .42)

    def test_cascade_preview_is_read_only_and_includes_unsaved_objects(self):
        row = self.map()
        impact = self.preview(row)
        self.assertTrue(impact['allowed'])
        self.assertEqual(impact['point_codes'], ['B'])
        self.assertEqual(impact['path_indices'], [0, 1])
        self.assertIn('2 条', impact['message'])
        after = self.call('GET', f"/api/maps/{row['id']}")
        self.assertEqual(after['draft'], row['draft'])
        self.assertEqual(after['revision'], 0)
        self.assertIsNone(after['lock_owner'])
        document = deepcopy(row['draft'])
        document['points'].append({'uid': 'local-new-point', 'code': 'NEW', 'x': 10, 'y': 10})
        self.assertTrue(self.preview(row, index=3, document=document)['allowed'])
        self.assertEqual(len(self.call('GET', f"/api/maps/{row['id']}")['draft']['points']), 3)

    def test_preview_checks_revision_lock_permissions_and_index(self):
        row = self.map()
        self.preview(row, revision=99, expected=409)
        self.preview(row, index=99, expected=404)
        self.preview(row, index=-1, expected=422)
        self.preview(row, kind='unknown', expected=422)
        with patch.dict('os.environ', {'RCS_PERMISSIONS': '{"admin":["map:view"]}'}):
            self.preview(row, expected=403)
        async def lock_other():
            async with AsyncSessionLocal() as db:
                stored = await db.get(MapDocument, row['id'])
                stored.lock_owner, stored.lock_until = 'other-operator', now() + timedelta(minutes=5)
                await db.commit()
        asyncio.run(lock_other())
        self.preview(row, expected=423)

    def test_task_chain_blocks_referenced_point_and_required_route(self):
        row = self.plan(self.map())
        point = self.preview(row, index=0)
        path = self.preview(row, kind='paths', index=0)
        self.assertFalse(point['allowed'])
        self.assertFalse(path['allowed'])
        self.assertEqual(path['references'][0]['type'], 'task_plan')
        self.assertIn('没有可行驶路线', path['references'][0]['reason'])
        candidate = deepcopy(row['draft']); candidate['paths'].pop(0)
        self.call('POST', f"/api/maps/{row['id']}/draft/save", {'revision': row['revision'], 'document': candidate}, 409)
        self.assertEqual(self.call('GET', f"/api/maps/{row['id']}")['revision'], row['revision'])

    def test_alternative_route_allows_removing_unneeded_edge(self):
        document = deepcopy(DOCUMENT); document['paths'].append({'start': 'A', 'end': 'C'})
        row = self.plan(self.map(document))
        self.assertTrue(self.preview(row, kind='paths', index=0)['allowed'])

    def test_same_code_identity_replacement_cannot_bypass_preflight(self):
        row = self.plan(self.map())
        document = deepcopy(row['draft']); document['points'][0]['uid'] = 'replacement-A'
        impact = self.preview(row, kind='paths', index=1, document=document)
        self.assertFalse(impact['allowed'])
        self.assertIn('身份', impact['references'][0]['reason'])
        other = self.map(suffix='other')
        self.assertTrue(self.preview(other)['allowed'])

    def test_active_tasks_and_missions_block_topology_deletion(self):
        row = self.map()
        async def active_rows():
            async with AsyncSessionLocal() as db:
                db.add(TaskRun(name='active-task', map_id=row['id'], from_point='A', to_point='C',
                               status='running', operator='admin'))
                db.add(MissionRun(name='active-chain', plan_id=999, map_id=row['id'], map_version=1,
                                  start_point='A', steps=[{'point': 'C'}], repeat_count=1,
                                  task_mode='auto', status='paused', operator='admin'))
                await db.commit()
        asyncio.run(active_rows())
        impact = self.preview(row, kind='paths', index=0)
        self.assertFalse(impact['allowed'])
        self.assertEqual({ref['type'] for ref in impact['references']}, {'task', 'mission'})

    def test_reference_names_are_redacted_without_task_view_permission(self):
        row = self.plan(self.map())
        with patch.dict('os.environ', {'RCS_PERMISSIONS': '{"admin":["map:view","map:edit"]}'}):
            impact = self.preview(row, index=0)
        self.assertFalse(impact['allowed'])
        self.assertTrue(all(ref['name'] == '关联任务' and 'id' not in ref for ref in impact['references']))


if __name__ == '__main__':
    unittest.main()
