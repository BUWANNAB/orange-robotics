from fastapi import APIRouter
from app.api.route import router as route_router

api_router = APIRouter()
api_router.include_router(route_router, prefix="/route", tags=["Route"])
