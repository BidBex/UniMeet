from collections import defaultdict
from typing import Any, Dict, Set

from fastapi import WebSocket


class ChatConnectionManager:
    """Manages active WebSocket connections grouped by conversation ID."""

    def __init__(self) -> None:
        self._rooms: Dict[int, Set[WebSocket]] = defaultdict(set)

    async def connect(self, conversation_id: int, websocket: WebSocket) -> None:
        await websocket.accept()
        self._rooms[conversation_id].add(websocket)

    def disconnect(self, conversation_id: int, websocket: WebSocket) -> None:
        room = self._rooms.get(conversation_id)
        if not room:
            return
        room.discard(websocket)
        if not room:
            self._rooms.pop(conversation_id, None)

    async def broadcast(self, conversation_id: int, payload: Dict[str, Any]) -> None:
        room = list(self._rooms.get(conversation_id, set()))
        stale: list[WebSocket] = []
        for ws in room:
            try:
                await ws.send_json(payload)
            except Exception:
                stale.append(ws)
        for ws in stale:
            self.disconnect(conversation_id, ws)


chat_manager = ChatConnectionManager()
