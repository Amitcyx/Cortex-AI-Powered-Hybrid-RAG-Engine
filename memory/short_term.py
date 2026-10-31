from db.models import save_message, get_recent_messages
 
 
def add_turn(user_id: str, session_id: str, role: str, content: str):
    save_message(user_id, session_id, role, content)
 
 
def get_history(user_id: str, session_id: str, limit: int = 20) -> list[dict]:
    return get_recent_messages(user_id, session_id, limit=limit)