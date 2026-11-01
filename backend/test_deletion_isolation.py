"""Deletion journeys use temporary SQLite, real HTTP APIs, and no robot commands."""
from copy import deepcopy
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch

import test_operations as fixtures
from app.services.mission_service import validate_chain
from test_map_editor_safety import DOCUMENT
from app.config import settings
from app.services.map_service import MapService


class DeletionIsolationTests(unittest.TestCase):
    call = fixtures.OperationsTests.call

    @classmethod
    def setUpClass(cls):
        fixtures.OperationsTests.setUpClass()
        cls.client, cls.headers = fixtures.OperationsTests.client, fixtures.OperationsTests.headers

    @classmethod
    def tearDownClass(cls):
        fixtures.OperationsTests.tearDownClass()

    def create(self, suffix='', triangle=False):
        document = deepcopy(DOCUMENT)
        if triangle:
            document['paths'].append({'start': 'A', 'end': 'C'})
        row = self.call('POST', '/api/maps', {'name': self._testMethodName + suffix, 'document': document})
        return row

    def get(self, row):
        return self.call('GET', f"/api/maps/{row['id']}")

    def publish(self, row):
        current = self.get(row)
        self.call('POST', f"/api/maps/{row['id']}/publish", {'revision': current['revision'], 'confirmation': current['name']})
        return self.call('GET', f"/api/maps/{row['id']}/versions")[0]['document']

    def delete(self, row, kind, index=0, expected=200):
        current = self.get(row)
        item = current['draft'][kind][index]
        name = item['code'] if kind == 'points' else f"{item['start']} → {item['end']}"
        url = f"/api/maps/{row['id']}/resources/{kind}/{item['uid']}"
        return self.call('POST', url + '/delete', {'revision': current['revision'],
            'confirmation': name, 'cascade_paths': True}, expected)

    def test_delete_one_edge_keeps_other_edges_publishable_and_tasks_creatable(self):
        row = self.create(triangle=True)
        original = self.publish(row)
        self.delete(row, 'paths')
        current = self.get(row)
        self.assertEqual([p['uid'] for p in current['draft']['paths']], [p['uid'] for p in original['paths'][1:]])
        self.assertEqual(current['draft']['points'], original['points'])
        published = self.publish(row)
        validate_chain(published, 'A', [{'point': 'C'}, {'point': 'B'}], 1)
        self.call('POST', '/api/task-plans', {'name': row['name'], 'map_id': row['id'],
            'start_point': 'A', 'steps': [{'point': 'C'}, {'point': 'B'}]})
        versions = self.call('GET', f"/api/maps/{row['id']}/versions")
        self.assertEqual(versions[-1]['document'], original)
        task = self.call('POST', '/api/task-history', {'name': row['name'] + '-delivery',
                         'map_id': row['id'], 'from_point': 'A', 'to_point': 'B'})
        self.assertEqual(task['status'], 'queued')

    def test_delete_station_cascades_only_its_edges_and_other_map_is_unchanged(self):
        row, other = self.create(triangle=True), self.create('-other', triangle=True)
        other_before = self.get(other)
        self.delete(row, 'points', 1)
        current = self.get(row)
        self.assertEqual([p['code'] for p in current['draft']['points']], ['A', 'C'])
        self.assertEqual([(p['start'], p['end']) for p in current['draft']['paths']], [('A', 'C')])
        self.assertEqual(self.get(other), other_before)
        validate_chain(self.publish(row), 'A', [{'point': 'C'}], 1)
        validate_chain(self.publish(other), 'A', [{'point': 'B'}, {'point': 'C'}], 1)

    def test_required_route_preview_and_mutation_both_block_and_rollback(self):
        row = self.create()
        self.publish(row)
        self.call('POST', '/api/task-plans', {'name': row['name'], 'map_id': row['id'],
            'start_point': 'A', 'steps': [{'point': 'C'}]})
        before = self.get(row)
        uid = before['draft']['paths'][0]['uid']
        impact = self.call('GET', f"/api/maps/{row['id']}/resources/paths/{uid}/impact")
        self.assertTrue(impact['blocked'])
        self.assertEqual(impact['dependencies'][0]['type'], 'task_plan')
        self.delete(row, 'paths', expected=409)
        self.assertEqual(self.get(row), before)
        validate_chain(self.publish(row), 'A', [{'point': 'C'}], 1)

    def test_disconnect_warning_explains_publish_block_without_losing_published_route(self):
        row = self.create()
        original = self.publish(row)
        current = self.get(row)
        uid = current['draft']['paths'][0]['uid']
        impact = self.call('GET', f"/api/maps/{row['id']}/resources/paths/{uid}/impact")
        self.assertFalse(impact['blocked'])
        self.assertIn('重新连接', impact['warnings'][0])
        preview = self.call('POST', f"/api/maps/{row['id']}/delete-preview", {
            'revision': current['revision'], 'document': current['draft'], 'kind': 'paths', 'index': 0})
        self.assertEqual(preview['warnings'], impact['warnings'])
        self.delete(row, 'paths')
        current = self.get(row)
        self.call('POST', f"/api/maps/{row['id']}/publish", {
            'revision': current['revision'], 'confirmation': current['name']}, 422)
        self.assertEqual(self.call('GET', f"/api/maps/{row['id']}/versions")[0]['document'], original)
        validate_chain(original, 'A', [{'point': 'C'}], 1)

    def test_delete_map_preserves_other_map_and_reusing_name_is_independent(self):
        row, other = self.create(), self.create('-retained')
        before = self.get(other)
        self.call('DELETE', f"/api/maps/{row['id']}", params={'confirmation': row['name']})
        self.call('GET', f"/api/maps/{row['id']}", expected=404)
        recreated = self.call('POST', '/api/maps', {'name': row['name'], 'document': DOCUMENT})
        self.assertNotEqual(recreated['id'], row['id'])
        self.assertEqual(self.get(other), before)
        validate_chain(self.publish(other), 'A', [{'point': 'C'}], 1)

    def test_deleting_one_task_plan_keeps_map_and_other_plan_executable(self):
        row = self.create()
        self.publish(row)
        plans = [self.call('POST', '/api/task-plans', {'name': row['name'] + str(i), 'map_id': row['id'],
                 'start_point': 'A', 'steps': [{'point': 'C'}]}) for i in range(2)]
        before = self.get(row)
        self.call('POST', f"/api/task-plans/{plans[0]['id']}/delete", {'confirmation': plans[0]['name']})
        retained = self.call('GET', '/api/task-plans', params={'map_id': row['id']})
        self.assertEqual(retained, [plans[1]])
        self.assertEqual(self.get(row), before)
        validate_chain(before['draft'], retained[0]['start_point'], retained[0]['steps'], retained[0]['repeat_count'])

    def test_legacy_pgm_delete_requires_permission_and_protects_shared_source(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(settings, 'MAPS_DIR', Path(folder)):
            source = make_grid(Path(folder), 'shared')
            self.assertEqual(self.client.post('/pgm/delete/shared').status_code, 401)
            document = {**deepcopy(DOCUMENT), 'asset_id': 'shared'}
            self.call('POST', '/api/maps', {'name': self._testMethodName, 'document': document})
            self.call('POST', '/pgm/delete/shared', expected=409)
            self.assertTrue((source / 'setting/map.pgm').is_file())
            self.assertFalse((Path(folder) / '.deleted-map-assets').exists())


def make_grid(root, name):
    directory = root / name
    (directory / 'setting').mkdir(parents=True)
    (directory / 'setting/map.pgm').write_bytes(b'P5\n1 1\n255\n\xff')
    (directory / 'setting/map.yaml').write_text('resolution: 0.05\norigin: [0, 0, 0]\n')
    return directory


class SourceMapDeletionTests(unittest.TestCase):
    def test_parent_map_with_child_map_cannot_be_deleted(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(settings, 'MAPS_DIR', Path(folder)):
            parent = make_grid(Path(folder), 'parent')
            child = make_grid(Path(folder), 'parent/child')
            with self.assertRaisesRegex(ValueError, '子地图'):
                MapService.delete_map('parent')
            self.assertTrue(parent.is_dir())
            self.assertTrue(child.is_dir())

    def test_ambiguous_leaf_name_refuses_to_select_an_arbitrary_map(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(settings, 'MAPS_DIR', Path(folder)):
            a, b = make_grid(Path(folder), 'group-a/shared'), make_grid(Path(folder), 'group-b/shared')
            with self.assertRaisesRegex(ValueError, '同名'):
                MapService.delete_map('shared')
            self.assertTrue(a.is_dir())
            self.assertTrue(b.is_dir())

    def test_independent_map_is_archived_with_bytes_preserved_and_other_map_untouched(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(settings, 'MAPS_DIR', Path(folder)), \
                patch.object(settings, 'PCD_DIR', Path(folder)), patch.dict('os.environ', {'ROS_MAP_CATALOG': ''}):
            a, b = make_grid(Path(folder), 'removed'), make_grid(Path(folder), 'retained')
            (a / 'GlobalMap.pcd').write_bytes(b'archived cloud')
            (b / 'GlobalMap.pcd').write_bytes(b'retained cloud')
            expected = (a / 'setting/map.pgm').read_bytes()
            self.assertTrue(MapService.delete_map('removed'))
            self.assertFalse(a.exists())
            archived = list((Path(folder) / '.deleted-map-assets').glob('removed-*/setting/map.pgm'))
            self.assertEqual(len(archived), 1)
            self.assertEqual(archived[0].read_bytes(), expected)
            self.assertTrue(b.is_dir())
            self.assertEqual([entry['name'] for entry in MapService.get_map_tree()], ['retained'])
            from app.api.localization import catalog
            self.assertEqual([entry['asset_id'] for entry in catalog()], ['retained'])


if __name__ == '__main__':
    unittest.main()
