from fastapi import FastAPI, Depends
from .utils import get_db
from ..auth import require_user

app = FastAPI()

@app.get("/items/{item_id}")
def read_item(item_id: int, db = Depends(get_db)):
    return {"item_id": item_id}

@celery.task
def background_job():
    pass
