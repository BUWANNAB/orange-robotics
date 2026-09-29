"""Bounded, nonblocking capture of application logs; database I/O happens in the worker."""
import logging
from collections import deque
from app.models.operations import AuditLog
from app.services.operations_common import redact, now
import uuid


class OperationsLogHandler(logging.Handler):
    def __init__(self):
        super().__init__(logging.INFO)
        self.pending = deque(maxlen=2000)
        self.dropped = 0

    def emit(self, record):
        if not record.name.startswith(("orange_agv", "app.")) or record.name.endswith("operations_worker"):
            return
        try:
            if len(self.pending) == self.pending.maxlen: self.dropped += 1
            self.pending.append({"created_at":now(),"level":"WARN" if record.levelname=="WARNING" else record.levelname,
                "module":record.name[-40:],"message":redact(record.getMessage()),"trace_id":uuid.uuid4().hex,"operator":"system"})
        except Exception:
            self.dropped += 1

    def drain(self, db):
        for _ in range(min(200,len(self.pending))):
            db.add(AuditLog(**self.pending.popleft()))


log_handler = OperationsLogHandler()
