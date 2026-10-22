"""Bounded, expiring, token-isolated local workspaces; no user filenames on disk."""
from collections import OrderedDict
from dataclasses import dataclass, field
import secrets
import threading
import time


@dataclass
class Workspace:
    frame: object
    audit: dict
    rejected: object
    metadata: dict
    tasks: list = field(default_factory=list)
    operation_lock: object = field(default_factory=threading.Lock)
    regional_weather: object = None
    results: object = None
    artifact: object = None
    touched: float = field(default_factory=time.monotonic)
    lock: object = field(default_factory=threading.Lock)


class WorkspaceStore:
    def __init__(self, capacity=8, ttl=7200):
        self.capacity, self.ttl = capacity, ttl
        self.items = OrderedDict()
        self.lock = threading.Lock()

    def _expire(self):
        for key, value in list(self.items.items()):
            if time.monotonic() - value.touched > self.ttl:
                del self.items[key]

    def put(self, workspace):
        with self.lock:
            self._expire()
            token = secrets.token_urlsafe(32)
            self.items[token] = workspace
            while len(self.items) > self.capacity:
                self.items.popitem(last=False)
            return token

    def get(self, token):
        with self.lock:
            self._expire()
            item = self.items.get(token)
            if item:
                item.touched = time.monotonic()
                self.items.move_to_end(token)
            return item

    def clear(self):
        with self.lock:
            self.items.clear()
