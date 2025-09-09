#!/usr/bin/env python3
"""
CareLog Health Management Backend API Tests
Tests all backend endpoints for medication courses, daily schedules, appointments, and analytics
"""

import requests
import json
from datetime import datetime, date, timedelta
import time
import sys

# Backend URL from environment
BACKEND_URL = "https://health-dashboard-22.preview.emergentagent.com/api"

class CareLogAPITester:
    def __init__(self):
        self.base_url = BACKEND_URL
        self.session = requests.Session()
        self.test_results = {
            "passed": 0,
            "failed": 0,
            "errors": []
        }
        self.created_course_id = None
        self.created_appointment_id = None
        self.created_schedule_id = None

    def log_result(self, test_name, success, message=""):
        if success:
            self.test_results["passed"] += 1
            print(f"✅ {test_name}: PASSED")
        else:
            self.test_results["failed"] += 1
            self.test_results["errors"].append(f"{test_name}: {message}")
            print(f"❌ {test_name}: FAILED - {message}")

    def make_request(self, method, endpoint, data=None, params=None):
        """Make HTTP request with error handling"""
        url = f"{self.base_url}{endpoint}"
        try:
            if method.upper() == "GET":
                response = self.session.get(url, params=params, timeout=30)
            elif method.upper() == "POST":
                response = self.session.post(url, json=data, timeout=30)
            elif method.upper() == "PUT":
                response = self.session.put(url, json=data, timeout=30)
            elif method.upper() == "DELETE":
                response = self.session.delete(url, timeout=30)
            
            return response
        except requests.exceptions.RequestException as e:
            print(f"Request failed: {e}")
            return None

    def test_medication_course_management(self):
        """Test Medication Course Management API"""
        print("\n🧪 Testing Medication Course Management API...")
        
        # Test 1: Create a new medication course
        course_data = {
            "course_name": "Blood Pressure Management",
            "pill_name": "Lisinopril 10mg",
            "time_slots": ["Morning", "Night"],
            "start_date": date.today().isoformat(),
            "duration_days": 30
        }
        
        response = self.make_request("POST", "/courses", course_data)
        if response and response.status_code == 200:
            course_result = response.json()
            self.created_course_id = course_result.get("id")
            self.log_result("Create Medication Course", True)
            
            # Verify course structure
            required_fields = ["id", "course_name", "pill_name", "time_slots", "start_date", "duration_days"]
            missing_fields = [field for field in required_fields if field not in course_result]
            if missing_fields:
                self.log_result("Course Structure Validation", False, f"Missing fields: {missing_fields}")
            else:
                self.log_result("Course Structure Validation", True)
        else:
            error_msg = f"Status: {response.status_code if response else 'No response'}"
            if response:
                error_msg += f", Response: {response.text}"
            self.log_result("Create Medication Course", False, error_msg)
            return

        # Test 2: Get all courses
        response = self.make_request("GET", "/courses")
        if response and response.status_code == 200:
            courses = response.json()
            if isinstance(courses, list) and len(courses) > 0:
                self.log_result("Get All Courses", True)
            else:
                self.log_result("Get All Courses", False, "No courses returned or invalid format")
        else:
            error_msg = f"Status: {response.status_code if response else 'No response'}"
            self.log_result("Get All Courses", False, error_msg)

        # Test 3: Get specific course
        if self.created_course_id:
            response = self.make_request("GET", f"/courses/{self.created_course_id}")
            if response and response.status_code == 200:
                course = response.json()
                if course.get("id") == self.created_course_id:
                    self.log_result("Get Specific Course", True)
                else:
                    self.log_result("Get Specific Course", False, "Course ID mismatch")
            else:
                error_msg = f"Status: {response.status_code if response else 'No response'}"
                self.log_result("Get Specific Course", False, error_msg)

    def test_daily_schedule_tracking(self):
        """Test Daily Schedule Tracking API"""
        print("\n🧪 Testing Daily Schedule Tracking API...")
        
        # Wait a moment for schedules to be generated
        time.sleep(2)
        
        # Test 1: Get today's schedules
        response = self.make_request("GET", "/schedules/today")
        if response and response.status_code == 200:
            schedules = response.json()
            if isinstance(schedules, list):
                self.log_result("Get Today's Schedules", True)
                
                # If we have schedules, test updating one
                if schedules and len(schedules) > 0:
                    schedule_item = schedules[0]
                    if "schedule" in schedule_item and "id" in schedule_item["schedule"]:
                        self.created_schedule_id = schedule_item["schedule"]["id"]
                        
                        # Verify schedule structure
                        schedule = schedule_item["schedule"]
                        course = schedule_item["course"]
                        required_schedule_fields = ["id", "course_id", "date", "time_slot", "status"]
                        required_course_fields = ["id", "course_name", "pill_name"]
                        
                        missing_schedule = [f for f in required_schedule_fields if f not in schedule]
                        missing_course = [f for f in required_course_fields if f not in course]
                        
                        if missing_schedule or missing_course:
                            self.log_result("Schedule Structure Validation", False, 
                                          f"Missing schedule fields: {missing_schedule}, course fields: {missing_course}")
                        else:
                            self.log_result("Schedule Structure Validation", True)
                else:
                    self.log_result("Schedule Generation Check", False, "No schedules generated for today")
            else:
                self.log_result("Get Today's Schedules", False, "Invalid response format")
        else:
            error_msg = f"Status: {response.status_code if response else 'No response'}"
            self.log_result("Get Today's Schedules", False, error_msg)

        # Test 2: Get schedules by specific date
        today_str = date.today().isoformat()
        response = self.make_request("GET", f"/schedules/date/{today_str}")
        if response and response.status_code == 200:
            schedules = response.json()
            if isinstance(schedules, list):
                self.log_result("Get Schedules by Date", True)
            else:
                self.log_result("Get Schedules by Date", False, "Invalid response format")
        else:
            error_msg = f"Status: {response.status_code if response else 'No response'}"
            self.log_result("Get Schedules by Date", False, error_msg)

        # Test 3: Update schedule status
        if self.created_schedule_id:
            update_data = {"status": "taken"}
            response = self.make_request("PUT", f"/schedules/{self.created_schedule_id}", update_data)
            if response and response.status_code == 200:
                self.log_result("Update Schedule Status", True)
            else:
                error_msg = f"Status: {response.status_code if response else 'No response'}"
                if response:
                    error_msg += f", Response: {response.text}"
                self.log_result("Update Schedule Status", False, error_msg)

    def test_course_progress_analytics(self):
        """Test Course Progress Analytics API"""
        print("\n🧪 Testing Course Progress Analytics API...")
        
        if not self.created_course_id:
            self.log_result("Course Progress Analytics", False, "No course ID available for testing")
            return

        response = self.make_request("GET", f"/courses/{self.created_course_id}/progress")
        if response and response.status_code == 200:
            progress = response.json()
            
            # Verify progress structure
            required_fields = ["course_id", "total_pills", "taken_pills", "missed_pills", 
                             "pending_pills", "progress_percentage", "adherence_percentage"]
            missing_fields = [field for field in required_fields if field not in progress]
            
            if missing_fields:
                self.log_result("Course Progress Structure", False, f"Missing fields: {missing_fields}")
            else:
                self.log_result("Course Progress Structure", True)
                
                # Verify calculations make sense
                total = progress.get("total_pills", 0)
                taken = progress.get("taken_pills", 0)
                missed = progress.get("missed_pills", 0)
                pending = progress.get("pending_pills", 0)
                
                if taken + missed + pending == total:
                    self.log_result("Progress Calculation Accuracy", True)
                else:
                    self.log_result("Progress Calculation Accuracy", False, 
                                  f"Pills don't add up: {taken}+{missed}+{pending} != {total}")
                
                # Verify percentages are valid
                progress_pct = progress.get("progress_percentage", 0)
                adherence_pct = progress.get("adherence_percentage", 0)
                
                if 0 <= progress_pct <= 100 and 0 <= adherence_pct <= 100:
                    self.log_result("Progress Percentage Validation", True)
                else:
                    self.log_result("Progress Percentage Validation", False, 
                                  f"Invalid percentages: progress={progress_pct}, adherence={adherence_pct}")
        else:
            error_msg = f"Status: {response.status_code if response else 'No response'}"
            if response:
                error_msg += f", Response: {response.text}"
            self.log_result("Course Progress Analytics", False, error_msg)

    def test_appointment_management(self):
        """Test Appointment Management API"""
        print("\n🧪 Testing Appointment Management API...")
        
        # Test 1: Create appointment
        appointment_data = {
            "doctor_name": "Dr. Sarah Johnson",
            "appointment_date": (date.today() + timedelta(days=7)).isoformat(),
            "appointment_time": "14:30:00",
            "purpose": "Regular checkup and blood pressure monitoring",
            "notes": "Bring current medication list and blood pressure log"
        }
        
        response = self.make_request("POST", "/appointments", appointment_data)
        if response and response.status_code == 200:
            appointment = response.json()
            self.created_appointment_id = appointment.get("id")
            self.log_result("Create Appointment", True)
            
            # Verify appointment structure
            required_fields = ["id", "doctor_name", "appointment_date", "appointment_time", 
                             "purpose", "notes", "completed"]
            missing_fields = [field for field in required_fields if field not in appointment]
            if missing_fields:
                self.log_result("Appointment Structure Validation", False, f"Missing fields: {missing_fields}")
            else:
                self.log_result("Appointment Structure Validation", True)
        else:
            error_msg = f"Status: {response.status_code if response else 'No response'}"
            if response:
                error_msg += f", Response: {response.text}"
            self.log_result("Create Appointment", False, error_msg)
            return

        # Test 2: Get all appointments
        response = self.make_request("GET", "/appointments")
        if response and response.status_code == 200:
            appointments = response.json()
            if isinstance(appointments, list) and len(appointments) > 0:
                self.log_result("Get All Appointments", True)
            else:
                self.log_result("Get All Appointments", False, "No appointments returned or invalid format")
        else:
            error_msg = f"Status: {response.status_code if response else 'No response'}"
            self.log_result("Get All Appointments", False, error_msg)

        # Test 3: Get upcoming appointments
        response = self.make_request("GET", "/appointments/upcoming")
        if response and response.status_code == 200:
            upcoming = response.json()
            if isinstance(upcoming, list):
                self.log_result("Get Upcoming Appointments", True)
            else:
                self.log_result("Get Upcoming Appointments", False, "Invalid response format")
        else:
            error_msg = f"Status: {response.status_code if response else 'No response'}"
            self.log_result("Get Upcoming Appointments", False, error_msg)

        # Test 4: Update appointment completion status
        if self.created_appointment_id:
            update_data = {"completed": True}
            response = self.make_request("PUT", f"/appointments/{self.created_appointment_id}", update_data)
            if response and response.status_code == 200:
                self.log_result("Update Appointment Status", True)
            else:
                error_msg = f"Status: {response.status_code if response else 'No response'}"
                if response:
                    error_msg += f", Response: {response.text}"
                self.log_result("Update Appointment Status", False, error_msg)

    def test_analytics_overview(self):
        """Test Analytics Overview API"""
        print("\n🧪 Testing Analytics Overview API...")
        
        response = self.make_request("GET", "/analytics/overview")
        if response and response.status_code == 200:
            analytics = response.json()
            
            # Verify analytics structure
            required_fields = ["weekly_adherence", "monthly_adherence", "active_courses", 
                             "upcoming_appointments", "weekly_stats", "monthly_stats"]
            missing_fields = [field for field in required_fields if field not in analytics]
            
            if missing_fields:
                self.log_result("Analytics Structure Validation", False, f"Missing fields: {missing_fields}")
            else:
                self.log_result("Analytics Structure Validation", True)
                
                # Verify nested stats structure
                weekly_stats = analytics.get("weekly_stats", {})
                monthly_stats = analytics.get("monthly_stats", {})
                
                required_stat_fields = ["taken", "missed", "total"]
                missing_weekly = [f for f in required_stat_fields if f not in weekly_stats]
                missing_monthly = [f for f in required_stat_fields if f not in monthly_stats]
                
                if missing_weekly or missing_monthly:
                    self.log_result("Analytics Stats Structure", False, 
                                  f"Missing weekly: {missing_weekly}, monthly: {missing_monthly}")
                else:
                    self.log_result("Analytics Stats Structure", True)
                
                # Verify adherence percentages are valid
                weekly_adherence = analytics.get("weekly_adherence", 0)
                monthly_adherence = analytics.get("monthly_adherence", 0)
                
                if 0 <= weekly_adherence <= 100 and 0 <= monthly_adherence <= 100:
                    self.log_result("Analytics Percentage Validation", True)
                else:
                    self.log_result("Analytics Percentage Validation", False, 
                                  f"Invalid adherence: weekly={weekly_adherence}, monthly={monthly_adherence}")
        else:
            error_msg = f"Status: {response.status_code if response else 'No response'}"
            if response:
                error_msg += f", Response: {response.text}"
            self.log_result("Analytics Overview API", False, error_msg)

    def test_edge_cases(self):
        """Test edge cases and error handling"""
        print("\n🧪 Testing Edge Cases...")
        
        # Test 1: Get non-existent course
        response = self.make_request("GET", "/courses/non-existent-id")
        if response and response.status_code == 404:
            self.log_result("Non-existent Course Error Handling", True)
        else:
            self.log_result("Non-existent Course Error Handling", False, 
                          f"Expected 404, got {response.status_code if response else 'No response'}")

        # Test 2: Update non-existent schedule
        update_data = {"status": "taken"}
        response = self.make_request("PUT", "/schedules/non-existent-id", update_data)
        if response and response.status_code == 404:
            self.log_result("Non-existent Schedule Error Handling", True)
        else:
            self.log_result("Non-existent Schedule Error Handling", False, 
                          f"Expected 404, got {response.status_code if response else 'No response'}")

        # Test 3: Update non-existent appointment
        update_data = {"completed": True}
        response = self.make_request("PUT", "/appointments/non-existent-id", update_data)
        if response and response.status_code == 404:
            self.log_result("Non-existent Appointment Error Handling", True)
        else:
            self.log_result("Non-existent Appointment Error Handling", False, 
                          f"Expected 404, got {response.status_code if response else 'No response'}")

    def cleanup_test_data(self):
        """Clean up test data"""
        print("\n🧹 Cleaning up test data...")
        
        # Delete created course (this will also delete related schedules)
        if self.created_course_id:
            response = self.make_request("DELETE", f"/courses/{self.created_course_id}")
            if response and response.status_code == 200:
                self.log_result("Cleanup Course", True)
            else:
                self.log_result("Cleanup Course", False, "Failed to delete test course")

        # Delete created appointment
        if self.created_appointment_id:
            response = self.make_request("DELETE", f"/appointments/{self.created_appointment_id}")
            if response and response.status_code == 200:
                self.log_result("Cleanup Appointment", True)
            else:
                self.log_result("Cleanup Appointment", False, "Failed to delete test appointment")

    def run_all_tests(self):
        """Run all backend API tests"""
        print(f"🚀 Starting CareLog Backend API Tests")
        print(f"Backend URL: {self.base_url}")
        print("=" * 60)
        
        # Run all test suites
        self.test_medication_course_management()
        self.test_daily_schedule_tracking()
        self.test_course_progress_analytics()
        self.test_appointment_management()
        self.test_analytics_overview()
        self.test_edge_cases()
        
        # Cleanup
        self.cleanup_test_data()
        
        # Print summary
        print("\n" + "=" * 60)
        print("🏁 TEST SUMMARY")
        print("=" * 60)
        print(f"✅ Passed: {self.test_results['passed']}")
        print(f"❌ Failed: {self.test_results['failed']}")
        
        if self.test_results['errors']:
            print("\n🚨 FAILED TESTS:")
            for error in self.test_results['errors']:
                print(f"   • {error}")
        
        success_rate = (self.test_results['passed'] / 
                       (self.test_results['passed'] + self.test_results['failed']) * 100)
        print(f"\n📊 Success Rate: {success_rate:.1f}%")
        
        return self.test_results['failed'] == 0

if __name__ == "__main__":
    tester = CareLogAPITester()
    success = tester.run_all_tests()
    sys.exit(0 if success else 1)