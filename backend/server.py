from fastapi import FastAPI, APIRouter, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid
from datetime import datetime, date, time, timedelta, timezone
from enum import Enum

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Create the main app without a prefix
app = FastAPI()

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Enums
class TimeSlot(str, Enum):
    MORNING = "Morning"
    AFTERNOON = "Afternoon"
    NIGHT = "Night"

class PillStatus(str, Enum):
    PENDING = "pending"
    TAKEN = "taken"
    MISSED = "missed"

# Helper functions for date/time serialization
def prepare_for_mongo(data):
    if isinstance(data.get('start_date'), date):
        data['start_date'] = data['start_date'].isoformat()
    if isinstance(data.get('date'), date):
        data['date'] = data['date'].isoformat()
    if isinstance(data.get('time'), time):
        data['time'] = data['time'].strftime('%H:%M:%S')
    if isinstance(data.get('appointment_date'), date):
        data['appointment_date'] = data['appointment_date'].isoformat()
    if isinstance(data.get('appointment_time'), time):
        data['appointment_time'] = data['appointment_time'].strftime('%H:%M:%S')
    return data

def parse_from_mongo(item):
    if isinstance(item.get('start_date'), str):
        item['start_date'] = datetime.fromisoformat(item['start_date']).date()
    if isinstance(item.get('date'), str):
        item['date'] = datetime.fromisoformat(item['date']).date()
    if isinstance(item.get('time'), str):
        item['time'] = datetime.strptime(item['time'], '%H:%M:%S').time()
    if isinstance(item.get('appointment_date'), str):
        item['appointment_date'] = datetime.fromisoformat(item['appointment_date']).date()
    if isinstance(item.get('appointment_time'), str):
        item['appointment_time'] = datetime.strptime(item['appointment_time'], '%H:%M:%S').time()
    return item

# Models
class PillCourse(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    course_name: str
    pill_name: str
    time_slots: List[TimeSlot]
    start_date: date
    duration_days: int
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class PillCourseCreate(BaseModel):
    course_name: str
    pill_name: str
    time_slots: List[TimeSlot]
    start_date: date
    duration_days: int

class DailySchedule(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    course_id: str
    date: date
    time_slot: TimeSlot
    status: PillStatus = PillStatus.PENDING
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class DailyScheduleUpdate(BaseModel):
    status: PillStatus

class Appointment(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    doctor_name: str
    appointment_date: date
    appointment_time: time
    purpose: str
    notes: Optional[str] = ""
    completed: bool = False
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class AppointmentCreate(BaseModel):
    doctor_name: str
    appointment_date: date
    appointment_time: time
    purpose: str
    notes: Optional[str] = ""

class AppointmentUpdate(BaseModel):
    completed: bool

# Pill Course Routes
@api_router.post("/courses", response_model=PillCourse)
async def create_course(course: PillCourseCreate):
    course_dict = course.dict()
    course_obj = PillCourse(**course_dict)
    
    # Prepare for MongoDB storage
    course_data = prepare_for_mongo(course_obj.dict())
    await db.pill_courses.insert_one(course_data)
    
    # Generate daily schedules for this course
    start_date = course.start_date
    for day in range(course.duration_days):
        current_date = start_date + timedelta(days=day)
        for time_slot in course.time_slots:
            schedule = DailySchedule(
                course_id=course_obj.id,
                date=current_date,
                time_slot=time_slot
            )
            schedule_data = prepare_for_mongo(schedule.dict())
            await db.daily_schedules.insert_one(schedule_data)
    
    return course_obj

@api_router.get("/courses", response_model=List[PillCourse])
async def get_courses():
    courses = await db.pill_courses.find().to_list(1000)
    return [PillCourse(**parse_from_mongo(course)) for course in courses]

@api_router.get("/courses/{course_id}", response_model=PillCourse)
async def get_course(course_id: str):
    course = await db.pill_courses.find_one({"id": course_id})
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    return PillCourse(**parse_from_mongo(course))

@api_router.delete("/courses/{course_id}")
async def delete_course(course_id: str):
    # Delete course and all related schedules
    await db.pill_courses.delete_one({"id": course_id})
    await db.daily_schedules.delete_many({"course_id": course_id})
    return {"message": "Course deleted successfully"}

# Daily Schedule Routes
@api_router.get("/schedules/today")
async def get_today_schedules():
    today = date.today()
    schedules = await db.daily_schedules.find({"date": today.isoformat()}).to_list(1000)
    
    # Get course details for each schedule
    result = []
    for schedule in schedules:
        course = await db.pill_courses.find_one({"id": schedule["course_id"]})
        if course:
            schedule_obj = DailySchedule(**parse_from_mongo(schedule))
            course_obj = PillCourse(**parse_from_mongo(course))
            result.append({
                "schedule": schedule_obj,
                "course": course_obj
            })
    
    return result

@api_router.get("/schedules/date/{target_date}")
async def get_schedules_by_date(target_date: str):
    schedules = await db.daily_schedules.find({"date": target_date}).to_list(1000)
    
    result = []
    for schedule in schedules:
        course = await db.pill_courses.find_one({"id": schedule["course_id"]})
        if course:
            schedule_obj = DailySchedule(**parse_from_mongo(schedule))
            course_obj = PillCourse(**parse_from_mongo(course))
            result.append({
                "schedule": schedule_obj,
                "course": course_obj
            })
    
    return result

@api_router.put("/schedules/{schedule_id}")
async def update_schedule_status(schedule_id: str, update: DailyScheduleUpdate):
    result = await db.daily_schedules.update_one(
        {"id": schedule_id},
        {"$set": {"status": update.status, "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Schedule not found")
    return {"message": "Schedule updated successfully"}

@api_router.get("/courses/{course_id}/progress")
async def get_course_progress(course_id: str):
    # Get all schedules for this course
    schedules = await db.daily_schedules.find({"course_id": course_id}).to_list(1000)
    
    total_pills = len(schedules)
    taken_pills = len([s for s in schedules if s["status"] == "taken"])
    missed_pills = len([s for s in schedules if s["status"] == "missed"])
    pending_pills = len([s for s in schedules if s["status"] == "pending"])
    
    progress_percentage = (taken_pills / total_pills * 100) if total_pills > 0 else 0
    adherence_percentage = (taken_pills / (taken_pills + missed_pills) * 100) if (taken_pills + missed_pills) > 0 else 0
    
    return {
        "course_id": course_id,
        "total_pills": total_pills,
        "taken_pills": taken_pills,
        "missed_pills": missed_pills,
        "pending_pills": pending_pills,
        "progress_percentage": round(progress_percentage, 1),
        "adherence_percentage": round(adherence_percentage, 1)
    }

# Appointment Routes
@api_router.post("/appointments", response_model=Appointment)
async def create_appointment(appointment: AppointmentCreate):
    appointment_dict = appointment.dict()
    appointment_obj = Appointment(**appointment_dict)
    
    appointment_data = prepare_for_mongo(appointment_obj.dict())
    await db.appointments.insert_one(appointment_data)
    
    return appointment_obj

@api_router.get("/appointments", response_model=List[Appointment])
async def get_appointments():
    appointments = await db.appointments.find().sort("appointment_date", 1).to_list(1000)
    return [Appointment(**parse_from_mongo(appointment)) for appointment in appointments]

@api_router.get("/appointments/upcoming")
async def get_upcoming_appointments():
    today = date.today()
    appointments = await db.appointments.find({
        "appointment_date": {"$gte": today.isoformat()},
        "completed": False
    }).sort("appointment_date", 1).to_list(100)
    return [Appointment(**parse_from_mongo(appointment)) for appointment in appointments]

@api_router.put("/appointments/{appointment_id}")
async def update_appointment(appointment_id: str, update: AppointmentUpdate):
    result = await db.appointments.update_one(
        {"id": appointment_id},
        {"$set": {"completed": update.completed}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Appointment not found")
    return {"message": "Appointment updated successfully"}

@api_router.delete("/appointments/{appointment_id}")
async def delete_appointment(appointment_id: str):
    result = await db.appointments.delete_one({"id": appointment_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Appointment not found")
    return {"message": "Appointment deleted successfully"}

# Notification and Auto-Update Routes
@api_router.post("/schedules/auto-mark-missed")
async def auto_mark_missed_pills():
    """Mark all pending pills from previous days as missed"""
    today = date.today()
    yesterday = today - timedelta(days=1)
    
    # Find all pending schedules from before today
    result = await db.daily_schedules.update_many(
        {
            "date": {"$lt": today.isoformat()},
            "status": "pending"
        },
        {
            "$set": {
                "status": "missed", 
                "updated_at": datetime.now(timezone.utc).isoformat()
            }
        }
    )
    
    return {
        "message": f"Marked {result.modified_count} pending pills as missed",
        "updated_count": result.modified_count
    }

@api_router.get("/schedules/pending-reminders")
async def get_pending_reminders():
    """Get all pending pills for today that need reminders"""
    today = date.today()
    schedules = await db.daily_schedules.find({
        "date": today.isoformat(),
        "status": "pending"
    }).to_list(1000)
    
    result = []
    for schedule in schedules:
        course = await db.pill_courses.find_one({"id": schedule["course_id"]})
        if course:
            schedule_obj = DailySchedule(**parse_from_mongo(schedule))
            course_obj = PillCourse(**parse_from_mongo(course))
            result.append({
                "schedule": schedule_obj,
                "course": course_obj
            })
    
    return result

# Analytics Routes
@api_router.get("/analytics/overview")
async def get_analytics_overview():
    today = date.today()
    week_ago = today - timedelta(days=7)
    month_ago = today - timedelta(days=30)
    
    # Weekly stats
    weekly_schedules = await db.daily_schedules.find({
        "date": {"$gte": week_ago.isoformat(), "$lte": today.isoformat()}
    }).to_list(1000)
    
    weekly_taken = len([s for s in weekly_schedules if s["status"] == "taken"])
    weekly_missed = len([s for s in weekly_schedules if s["status"] == "missed"])
    weekly_total = weekly_taken + weekly_missed
    weekly_adherence = (weekly_taken / weekly_total * 100) if weekly_total > 0 else 0
    
    # Monthly stats
    monthly_schedules = await db.daily_schedules.find({
        "date": {"$gte": month_ago.isoformat(), "$lte": today.isoformat()}
    }).to_list(1000)
    
    monthly_taken = len([s for s in monthly_schedules if s["status"] == "taken"])
    monthly_missed = len([s for s in monthly_schedules if s["status"] == "missed"])
    monthly_total = monthly_taken + monthly_missed
    monthly_adherence = (monthly_taken / monthly_total * 100) if monthly_total > 0 else 0
    
    # Active courses
    active_courses = await db.pill_courses.count_documents({})
    
    # Upcoming appointments
    upcoming_appointments = await db.appointments.count_documents({
        "appointment_date": {"$gte": today.isoformat()},
        "completed": False
    })
    
    return {
        "weekly_adherence": round(weekly_adherence, 1),
        "monthly_adherence": round(monthly_adherence, 1),
        "active_courses": active_courses,
        "upcoming_appointments": upcoming_appointments,
        "weekly_stats": {
            "taken": weekly_taken,
            "missed": weekly_missed,
            "total": weekly_total
        },
        "monthly_stats": {
            "taken": monthly_taken,
            "missed": monthly_missed,
            "total": monthly_total
        }
    }

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()