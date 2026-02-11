# app/core/memory.py
import time, threading
from typing import Dict, List

class MemoryStore:
    def __init__(self, max_turns:int=6, ttl_seconds:int=3600):
        # RLock permite re-entrada del mismo hilo sin deadlock
        self._lock = threading.RLock()
        self._data: Dict[str, Dict[str, object]] = {}
        self.max_turns = max_turns
        self.ttl = ttl_seconds

    def _now(self): 
        return time.time()

    def _get_unlocked(self, sid: str):
        """Versión interna: requiere lock tomado."""
        entry = self._data.get(sid)
        if not entry:
            return None
        if self._now() - entry["ts"] > self.ttl:
            # expirar
            del self._data[sid]
            return None
        return entry

    def get(self, sid: str) -> List[Dict[str, str]]:
        with self._lock:
            entry = self._get_unlocked(sid)
            return [] if not entry else list(entry["messages"])

    def append(self, sid: str, role: str, content: str):
        with self._lock:
            entry = self._get_unlocked(sid)
            msgs = [] if not entry else entry["messages"]
            msgs = msgs + [{"role": role, "content": content}]
            self._data[sid] = {
                "messages": msgs[-(self.max_turns * 2):],
                "ts": self._now(),
            }
