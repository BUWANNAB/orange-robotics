"""Initial roles and password lifecycle, using an isolated DB and no ROS transport."""
import asyncio
import unittest
from unittest.mock import AsyncMock, Mock, patch

import test_operations as fixtures  # Selects a temporary SQLite database before imports.
from fastapi.testclient import TestClient
from fastapi import HTTPException, WebSocketDisconnect
from sqlalchemy import delete, select, update
from app.database import AsyncSessionLocal
from app.models.user import User
from app.services.initial_accounts import initialize_accounts
from app.api.user import hash_password, verify_password


class InitialAccountTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.patches = [patch('app.main.ros2_service.start'), patch('app.main.ros2_service.stop')]
        for current in cls.patches:
            current.start()
        cls.client = TestClient(fixtures.app, client=("127.0.0.1", 50001))
        cls.client.__enter__()

    @classmethod
    def tearDownClass(cls):
        cls.client.__exit__(None, None, None)
        for current in reversed(cls.patches):
            current.stop()

    def setUp(self):
        async def restore():
            async with AsyncSessionLocal() as db:
                for account in ('admin', 'user'):
                    await db.execute(update(User).where(User.userAccount == account).values(
                        userPassword=hash_password('123'), isDelete=0))
                await db.commit()
        asyncio.run(restore())

    def login(self, account='user', password='123'):
        result = self.client.post('/user/login', json={'userAccount':account, 'userPassword':password}).json()
        self.assertEqual(result['code'], 0, result)
        return result['data']

    def change(self, token, old='123', new='456', check=None):
        return self.client.post('/user/change-password', headers={'Authorization':token},
            json={'oldPassword':old, 'newPassword':new, 'checkPassword':new if check is None else check})

    def test_01_initial_pair_roles_and_independent_hashes(self):
        async def accounts():
            async with AsyncSessionLocal() as db:
                return (await db.scalars(select(User))).all()
        users = asyncio.run(accounts())
        self.assertEqual({user.userAccount for user in users}, {'admin', 'user'})
        self.assertEqual(len({user.userPassword for user in users}), 2)
        self.assertTrue(all(user.userPassword != '123' and verify_password('123', user.userPassword) for user in users))
        for account, role in (('admin','admin'), ('user','operator')):
            response = self.client.get('/user/current', headers={'Authorization':self.login(account)}).json()['data']
            self.assertEqual(response['roles'], [role])

    def test_02_initialization_is_idempotent_and_preserves_changed_disabled_accounts(self):
        async def check():
            async with AsyncSessionLocal() as db:
                user = await db.scalar(select(User).where(User.userAccount == 'user'))
                user.userPassword = hash_password('custom-password')
                user.isDelete = 1
                original = user.userPassword
                await db.commit()
            results = await asyncio.gather(*(initialize_accounts() for _ in range(3)))
            self.assertEqual(results, [[], [], []])
            async with AsyncSessionLocal() as db:
                rows = (await db.scalars(select(User).where(User.userAccount.in_(['admin','user'])))).all()
                self.assertEqual(len(rows), 2)
                user = next(row for row in rows if row.userAccount == 'user')
                self.assertEqual(user.userPassword, original)
                self.assertEqual(user.isDelete, 1)
        asyncio.run(check())

    def test_03_operator_daily_operations_and_admin_boundaries(self):
        headers = {'Authorization':self.login()}
        permissions = self.client.get('/user/current', headers=headers).json()['data']['permissions']
        for needed in ['map:edit','map:publish','task:edit','robot:control','ros:view']:
            self.assertIn(needed, permissions)
        self.assertNotIn('*', permissions)
        self.assertNotIn('ros:maintain', permissions)
        self.assertEqual(self.client.get('/api/maps', headers=headers).status_code, 200)
        created = self.client.post('/api/maps', headers=headers, json={'name':'operator-map','document':fixtures.MAP})
        self.assertEqual(created.json()['code'], 0, created.text)
        self.assertEqual(self.client.post('/user/register', headers=headers,
            json={'userAccount':'blocked','userPassword':'123'}).status_code, 403)
        self.assertEqual(self.client.post('/api/robots', headers=headers,
            json={'code':'BLOCKED','name':'blocked','model':'AMR'}).status_code, 403)
        self.assertEqual(self.client.post('/api/robots/1/commands/reboot', headers=headers,
            json={'confirmation':'BLOCKED','key':'reboot-test'}).status_code, 403)
        self.assertEqual(self.client.post('/api/robots/batch-command', headers=headers,
            json={'robot_ids':[1],'command':'reboot','confirmation':'确认批量操作','key':'reboot-batch'}).status_code, 403)

    def test_04_password_change_revokes_all_old_sessions_and_survives_initialization(self):
        first, second = self.login(), self.login()
        self.assertNotEqual(first, second)
        self.assertEqual(self.change(first).json()['code'], 0)
        for token in (first, second):
            self.assertEqual(self.client.get('/user/current', headers={'Authorization':token}).status_code, 401)
        self.assertEqual(self.client.post('/user/login', json={'userAccount':'user','userPassword':'123'}).json()['code'], 40100)
        asyncio.run(initialize_accounts())
        self.__class__.client.__exit__(None, None, None)
        self.__class__.client = TestClient(fixtures.app, client=("127.0.0.1", 50001))
        self.__class__.client.__enter__()
        self.assertEqual(self.client.get('/user/current', headers={'Authorization':self.login(password='456')}).status_code, 200)

    def test_05_failed_change_keeps_password_and_login(self):
        token = self.login()
        for old, new, check in [('wrong','456','456'), ('123','456','789'), ('123','123','123'), ('123','   ','   ')]:
            response = self.change(token, old, new, check)
            self.assertNotEqual(response.json()['code'], 0, response.text)
        self.assertEqual(self.change(token, new='12').status_code, 422)
        self.assertEqual(self.client.get('/user/current', headers={'Authorization':token}).status_code, 200)
        self.login()

    def test_06_anonymous_and_cross_account_change_rejected(self):
        body = {'oldPassword':'123','newPassword':'456','checkPassword':'456','userAccount':'admin'}
        self.assertEqual(self.client.post('/user/change-password', json=body).status_code, 401)
        # The target is always authenticated user; injecting a username cannot change admin.
        token = self.login()
        self.assertEqual(self.client.post('/user/change-password', headers={'Authorization':token}, json=body).json()['code'], 0)
        self.login('admin')
        self.login('user', '456')

    def test_07_revoked_logout_and_legacy_tokens_rejected(self):
        token = self.login()
        self.assertEqual(self.client.post('/user/logout', headers={'Authorization':token}).json()['code'], 0)
        self.assertEqual(self.change(token).status_code, 401)
        self.assertEqual(self.client.get('/user/current', headers={'Authorization':'agv_user_1_legacy'}).status_code, 401)

    def test_08_admin_can_create_an_additional_account_without_replacing_initial_pair(self):
        response = self.client.post('/user/register', headers={'Authorization':self.login('admin')},
            json={'userAccount':'extra-viewer','userPassword':'123','checkPassword':'123'})
        self.assertEqual(response.json()['code'], 0, response.text)
        self.login('extra-viewer')
        self.assertEqual(asyncio.run(initialize_accounts()), [])

    def test_09_credential_proof_cannot_be_replaced_even_with_valid_outer_signature(self):
        token = self.login()
        altered = token[:-1] + ('0' if token[-1] != '0' else '1')
        self.assertEqual(self.client.get('/user/current', headers={'Authorization':altered}).status_code, 401)
        self.assertEqual(self.client.get('/user/current', headers={'Authorization':token}).status_code, 200)

    def test_10_concurrent_initializers_fill_missing_user_exactly_once(self):
        async def check():
            async with AsyncSessionLocal() as db:
                await db.execute(delete(User).where(User.userAccount == 'user'))
                await db.commit()
            results = await asyncio.gather(*(initialize_accounts() for _ in range(3)))
            self.assertEqual(sum(result.count('user') for result in results), 1)
            async with AsyncSessionLocal() as db:
                users = (await db.scalars(select(User).where(User.userAccount == 'user'))).all()
                self.assertEqual(len(users), 1)
                self.assertTrue(verify_password('123', users[0].userPassword))
        asyncio.run(check())

    def test_11_noncanonical_initial_username_is_reported_without_creating_a_duplicate(self):
        async def check():
            async with AsyncSessionLocal() as db:
                await db.execute(update(User).where(User.userAccount == 'admin').values(userAccount='Admin'))
                await db.commit()
            try:
                with self.assertRaisesRegex(RuntimeError, '大小写'):
                    await initialize_accounts()
                async with AsyncSessionLocal() as db:
                    users = (await db.scalars(select(User).where(User.userAccount.in_(['admin','Admin'])))).all()
                    self.assertEqual(len(users), 1)
            finally:
                async with AsyncSessionLocal() as db:
                    await db.execute(update(User).where(User.userAccount == 'Admin').values(userAccount='admin'))
                    await db.commit()
        asyncio.run(check())

    def test_12_revoked_localization_socket_handles_a_simultaneous_browser_disconnect(self):
        from app.api.localization import live
        socket = Mock(accept=AsyncMock(), receive_json=AsyncMock(return_value={'token':'revoked'}),
            close=AsyncMock(side_effect=WebSocketDisconnect(1006)))
        with patch('app.services.operations_common.authenticate', new=AsyncMock(side_effect=HTTPException(401))):
            asyncio.run(live(socket))
        socket.close.assert_awaited_once_with(1008)


if __name__ == '__main__':
    unittest.main()
