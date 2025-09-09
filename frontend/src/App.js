import React, { useState, useEffect, useCallback } from "react";
import "./App.css";
import axios from "axios";
import { Calendar, Plus, Clock, User, CheckCircle, XCircle, BarChart3, Home, Pill, AlertCircle, Bell, Settings } from "lucide-react";
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, ArcElement, LineElement, PointElement } from 'chart.js';
import { Bar, Pie, Line } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, ArcElement, LineElement, PointElement);

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

// Notification System
class NotificationManager {
  constructor() {
    this.notifications = [];
    this.reminderTimes = JSON.parse(localStorage.getItem('reminderTimes') || '["11:30", "18:00"]');
    this.isEnabled = localStorage.getItem('notificationsEnabled') !== 'false';
    this.intervals = [];
  }

  async requestPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
      const permission = await Notification.requestPermission();
      return permission === 'granted';
    }
    return Notification.permission === 'granted';
  }

  sendNotification(title, body, options = {}) {
    if ('Notification' in window && Notification.permission === 'granted' && this.isEnabled) {
      const notification = new Notification(title, { 
        body, 
        icon: '/favicon.ico',
        badge: '/favicon.ico',
        tag: options.tag || 'carelog',
        requireInteraction: options.requireInteraction || false,
        ...options 
      });
      
      if (options.onClick) {
        notification.onclick = options.onClick;
      }
      
      // Auto close after 10 seconds unless requireInteraction is true
      if (!options.requireInteraction) {
        setTimeout(() => notification.close(), 10000);
      }
      
      return notification;
    }
  }

  scheduleReminders(pendingSchedules) {
    // Clear existing intervals
    this.intervals.forEach(interval => clearInterval(interval));
    this.intervals = [];

    if (!this.isEnabled || !pendingSchedules.length) return;

    // Schedule reminders for each reminder time
    this.reminderTimes.forEach(reminderTime => {
      const [hours, minutes] = reminderTime.split(':').map(Number);
      const now = new Date();
      const reminderDate = new Date();
      reminderDate.setHours(hours, minutes, 0, 0);

      // If the reminder time has passed today, schedule for tomorrow
      if (reminderDate <= now) {
        reminderDate.setDate(reminderDate.getDate() + 1);
      }

      const timeUntilReminder = reminderDate.getTime() - now.getTime();

      if (timeUntilReminder > 0) {
        const timeout = setTimeout(() => {
          this.sendDailyReminders(pendingSchedules);
          
          // Set up recurring daily reminders
          const dailyInterval = setInterval(() => {
            this.sendDailyReminders(pendingSchedules);
          }, 24 * 60 * 60 * 1000); // 24 hours
          
          this.intervals.push(dailyInterval);
        }, timeUntilReminder);

        this.intervals.push(timeout);
      }
    });

    // Schedule midnight auto-mark-missed check
    this.scheduleMidnightCheck();
  }

  sendDailyReminders(pendingSchedules) {
    const todaysPending = pendingSchedules.filter(item => {
      const scheduleDate = new Date(item.schedule.date);
      const today = new Date();
      return scheduleDate.toDateString() === today.toDateString() && 
             item.schedule.status === 'pending';
    });

    if (todaysPending.length > 0) {
      const pillCount = todaysPending.length;
      const pillNames = todaysPending.map(item => item.course.pill_name).join(', ');
      
      this.sendNotification(
        '💊 Medication Reminder',
        `You have ${pillCount} medication${pillCount > 1 ? 's' : ''} to take: ${pillNames}`,
        {
          tag: 'daily-reminder',
          requireInteraction: true,
          onClick: () => {
            window.focus();
            // Could trigger navigation to daily tracker
          }
        }
      );
    }
  }

  scheduleMidnightCheck() {
    const now = new Date();
    const midnight = new Date();
    midnight.setHours(24, 0, 0, 0); // Next midnight
    
    const timeUntilMidnight = midnight.getTime() - now.getTime();

    const midnightTimeout = setTimeout(() => {
      this.autoMarkMissedPills();
      
      // Set up recurring midnight checks
      const dailyMidnightCheck = setInterval(() => {
        this.autoMarkMissedPills();
      }, 24 * 60 * 60 * 1000);
      
      this.intervals.push(dailyMidnightCheck);
    }, timeUntilMidnight);

    this.intervals.push(midnightTimeout);
  }

  async autoMarkMissedPills() {
    try {
      const response = await axios.post(`${API}/schedules/auto-mark-missed`);
      if (response.data.updated_count > 0) {
        this.sendNotification(
          '⏰ Daily Update',
          `${response.data.updated_count} missed medication${response.data.updated_count > 1 ? 's' : ''} from previous days have been marked as missed.`,
          { tag: 'auto-missed' }
        );
      }
    } catch (error) {
      console.error('Error auto-marking missed pills:', error);
    }
  }

  updateSettings(enabled, reminderTimes) {
    this.isEnabled = enabled;
    this.reminderTimes = reminderTimes;
    localStorage.setItem('notificationsEnabled', enabled);
    localStorage.setItem('reminderTimes', JSON.stringify(reminderTimes));
  }

  cleanup() {
    this.intervals.forEach(interval => {
      if (typeof interval === 'number') {
        clearInterval(interval);
        clearTimeout(interval);
      }
    });
    this.intervals = [];
  }
}

// Initialize notification manager
const notificationManager = new NotificationManager();

// Request notification permission on load
const requestNotificationPermission = async () => {
  return await notificationManager.requestPermission();
};

const sendNotification = (title, body, options = {}) => {
  return notificationManager.sendNotification(title, body, options);
};

const NotificationSettings = ({ onClose }) => {
  const [enabled, setEnabled] = useState(notificationManager.isEnabled);
  const [reminderTimes, setReminderTimes] = useState(notificationManager.reminderTimes);
  const [newReminderTime, setNewReminderTime] = useState('');

  const handleSave = () => {
    notificationManager.updateSettings(enabled, reminderTimes);
    onClose();
    
    if (enabled) {
      // Re-request permission if needed and reschedule
      requestNotificationPermission().then(() => {
        // Fetch current pending schedules and reschedule
        fetchPendingReminders();
      });
    }
    
    sendNotification('⚙️ Settings Updated', 'Your notification preferences have been saved!');
  };

  const fetchPendingReminders = async () => {
    try {
      const response = await axios.get(`${API}/schedules/pending-reminders`);
      notificationManager.scheduleReminders(response.data);
    } catch (error) {
      console.error('Error fetching pending reminders:', error);
    }
  };

  const addReminderTime = () => {
    if (newReminderTime && !reminderTimes.includes(newReminderTime)) {
      setReminderTimes([...reminderTimes, newReminderTime].sort());
      setNewReminderTime('');
    }
  };

  const removeReminderTime = (time) => {
    setReminderTimes(reminderTimes.filter(t => t !== time));
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white p-6 rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-semibold text-gray-900">Notification Settings</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <XCircle className="h-6 w-6" />
          </button>
        </div>

        <div className="space-y-6">
          {/* Enable/Disable Notifications */}
          <div className="flex items-center justify-between">
            <div>
              <h4 className="font-medium text-gray-900">Enable Notifications</h4>
              <p className="text-sm text-gray-500">Receive medication reminders and updates</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>

          {/* Reminder Times */}
          <div>
            <h4 className="font-medium text-gray-900 mb-3">Daily Reminder Times</h4>
            <div className="space-y-2">
              {reminderTimes.map((time, index) => (
                <div key={index} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                  <span className="font-mono">{time}</span>
                  <button
                    onClick={() => removeReminderTime(time)}
                    className="text-red-500 hover:text-red-700"
                  >
                    <XCircle className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>

            {/* Add New Reminder Time */}
            <div className="flex gap-2 mt-3">
              <input
                type="time"
                value={newReminderTime}
                onChange={(e) => setNewReminderTime(e.target.value)}
                className="flex-1 border border-gray-300 rounded px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <button
                onClick={addReminderTime}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
              >
                Add
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Reminders will be sent at these times daily for any pending medications
            </p>
          </div>

          {/* Auto-Mark Info */}
          <div className="p-3 bg-yellow-50 rounded-lg border border-yellow-200">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-5 w-5 text-yellow-600 mt-0.5" />
              <div>
                <h5 className="font-medium text-yellow-800">Automatic Missed Marking</h5>
                <p className="text-sm text-yellow-700">
                  Any pending medications from previous days will automatically be marked as "missed" at midnight.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-600 border border-gray-300 rounded hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
          >
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
};

const Dashboard = ({ courses, analytics, todaySchedules }) => {
  const [showNotificationSettings, setShowNotificationSettings] = useState(false);

  const weeklyChartData = {
    labels: ['Taken', 'Missed'],
    datasets: [{
      data: [analytics.weekly_stats?.taken || 0, analytics.weekly_stats?.missed || 0],
      backgroundColor: ['#10b981', '#ef4444'],
      borderWidth: 0,
    }]
  };

  const monthlyChartData = {
    labels: ['Taken', 'Missed'],
    datasets: [{
      data: [analytics.monthly_stats?.taken || 0, analytics.monthly_stats?.missed || 0],
      backgroundColor: ['#10b981', '#ef4444'],
      borderWidth: 0,
    }]
  };

  return (
    <div className="space-y-6">
      <div className="text-center py-8">
        <div className="flex items-center justify-center gap-4 mb-2">
          <h1 className="text-4xl font-bold text-gray-900">CareLog</h1>
          <button
            onClick={() => setShowNotificationSettings(true)}
            className="flex items-center gap-1 px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
            title="Notification Settings"
          >
            <Bell className="h-4 w-4" />
            <Settings className="h-3 w-3" />
          </button>
        </div>
        <p className="text-gray-600">Your Personal Health Management Hub</p>
      </div>

      {showNotificationSettings && (
        <NotificationSettings onClose={() => setShowNotificationSettings(false)} />
      )}

      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-blue-50 p-6 rounded-lg border border-blue-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-blue-600 text-sm font-medium">Active Courses</p>
              <p className="text-2xl font-bold text-blue-900">{analytics.active_courses || 0}</p>
            </div>
            <Pill className="h-8 w-8 text-blue-600" />
          </div>
        </div>
        
        <div className="bg-green-50 p-6 rounded-lg border border-green-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-green-600 text-sm font-medium">Weekly Adherence</p>
              <p className="text-2xl font-bold text-green-900">{analytics.weekly_adherence || 0}%</p>
            </div>
            <CheckCircle className="h-8 w-8 text-green-600" />
          </div>
        </div>
        
        <div className="bg-purple-50 p-6 rounded-lg border border-purple-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-purple-600 text-sm font-medium">Monthly Adherence</p>
              <p className="text-2xl font-bold text-purple-900">{analytics.monthly_adherence || 0}%</p>
            </div>
            <BarChart3 className="h-8 w-8 text-purple-600" />
          </div>
        </div>
        
        <div className="bg-orange-50 p-6 rounded-lg border border-orange-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-orange-600 text-sm font-medium">Upcoming Appointments</p>
              <p className="text-2xl font-bold text-orange-900">{analytics.upcoming_appointments || 0}</p>
            </div>
            <Calendar className="h-8 w-8 text-orange-600" />
          </div>
        </div>
      </div>

      {/* Today's Pills */}
      <div className="bg-white p-6 rounded-lg shadow-sm border">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Today's Medications</h2>
        {todaySchedules && todaySchedules.length > 0 ? (
          <div className="space-y-3">
            {todaySchedules.map((item, index) => (
              <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div>
                  <p className="font-medium text-gray-900">{item.course.pill_name}</p>
                  <p className="text-sm text-gray-600">{item.course.course_name} • {item.schedule.time_slot}</p>
                </div>
                <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                  item.schedule.status === 'taken' ? 'bg-green-100 text-green-800' :
                  item.schedule.status === 'missed' ? 'bg-red-100 text-red-800' :
                  'bg-yellow-100 text-yellow-800'
                }`}>
                  {item.schedule.status.charAt(0).toUpperCase() + item.schedule.status.slice(1)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-500 text-center py-8">No medications scheduled for today</p>
        )}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-lg shadow-sm border">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Weekly Adherence</h3>
          <div className="h-64">
            <Pie data={weeklyChartData} options={{ maintainAspectRatio: false }} />
          </div>
        </div>
        
        <div className="bg-white p-6 rounded-lg shadow-sm border">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Monthly Adherence</h3>
          <div className="h-64">
            <Pie data={monthlyChartData} options={{ maintainAspectRatio: false }} />
          </div>
        </div>
      </div>
    </div>
  );
};

const CoursesManager = ({ courses, setCourses, onCourseCreated }) => {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newCourse, setNewCourse] = useState({
    course_name: '',
    pill_name: '',
    time_slots: [],
    start_date: '',
    duration_days: 30
  });
  const [courseProgress, setCourseProgress] = useState({});

  useEffect(() => {
    fetchCourseProgress();
  }, [courses]);

  const fetchCourseProgress = async () => {
    const progressData = {};
    for (const course of courses) {
      try {
        const response = await axios.get(`${API}/courses/${course.id}/progress`);
        progressData[course.id] = response.data;
      } catch (error) {
        console.error(`Error fetching progress for course ${course.id}:`, error);
      }
    }
    setCourseProgress(progressData);
  };

  const handleTimeSlotChange = (timeSlot) => {
    setNewCourse(prev => ({
      ...prev,
      time_slots: prev.time_slots.includes(timeSlot)
        ? prev.time_slots.filter(slot => slot !== timeSlot)
        : [...prev.time_slots, timeSlot]
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const response = await axios.post(`${API}/courses`, newCourse);
      setCourses(prev => [...prev, response.data]);
      setNewCourse({
        course_name: '',
        pill_name: '',
        time_slots: [],
        start_date: '',
        duration_days: 30
      });
      setShowCreateForm(false);
      onCourseCreated();
      sendNotification('Course Created', `New medication course "${newCourse.course_name}" has been created successfully!`);
    } catch (error) {
      console.error('Error creating course:', error);
    }
  };

  const handleDeleteCourse = async (courseId) => {
    if (window.confirm('Are you sure you want to delete this course? This will also delete all related schedules.')) {
      try {
        await axios.delete(`${API}/courses/${courseId}`);
        setCourses(prev => prev.filter(course => course.id !== courseId));
        onCourseCreated();
      } catch (error) {
        console.error('Error deleting course:', error);
      }
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900">Medication Courses</h2>
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="h-4 w-4" />
          New Course
        </button>
      </div>

      {showCreateForm && (
        <div className="bg-white p-6 rounded-lg shadow-sm border">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Create New Medication Course</h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Course Name</label>
                <input
                  type="text"
                  value={newCourse.course_name}
                  onChange={(e) => setNewCourse(prev => ({ ...prev, course_name: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="e.g., Blood Pressure Treatment"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Pill Name</label>
                <input
                  type="text"
                  value={newCourse.pill_name}
                  onChange={(e) => setNewCourse(prev => ({ ...prev, pill_name: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="e.g., Lisinopril 10mg"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Time Slots</label>
              <div className="flex gap-4">
                {['Morning', 'Afternoon', 'Night'].map((timeSlot) => (
                  <label key={timeSlot} className="flex items-center">
                    <input
                      type="checkbox"
                      checked={newCourse.time_slots.includes(timeSlot)}
                      onChange={() => handleTimeSlotChange(timeSlot)}
                      className="mr-2"
                    />
                    {timeSlot}
                  </label>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Start Date</label>
                <input
                  type="date"
                  value={newCourse.start_date}
                  onChange={(e) => setNewCourse(prev => ({ ...prev, start_date: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Duration (Days)</label>
                <input
                  type="number"
                  value={newCourse.duration_days}
                  onChange={(e) => setNewCourse(prev => ({ ...prev, duration_days: parseInt(e.target.value) }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  min="1"
                  required
                />
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCreateForm(false)}
                className="px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Create Course
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Courses List */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {courses.map((course) => {
          const progress = courseProgress[course.id] || {};
          return (
            <div key={course.id} className="bg-white p-6 rounded-lg shadow-sm border">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">{course.course_name}</h3>
                  <p className="text-gray-600">{course.pill_name}</p>
                  <p className="text-sm text-gray-500">
                    {course.time_slots.join(', ')} • {course.duration_days} days
                  </p>
                </div>
                <button
                  onClick={() => handleDeleteCourse(course.id)}
                  className="text-red-500 hover:text-red-700 transition-colors"
                >
                  <XCircle className="h-5 w-5" />
                </button>
              </div>

              {/* Progress Bar */}
              <div className="mb-4">
                <div className="flex justify-between text-sm text-gray-600 mb-1">
                  <span>Progress</span>
                  <span>{progress.progress_percentage || 0}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${progress.progress_percentage || 0}%` }}
                  ></div>
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <p className="text-2xl font-bold text-green-600">{progress.taken_pills || 0}</p>
                  <p className="text-xs text-gray-500">Taken</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-red-600">{progress.missed_pills || 0}</p>
                  <p className="text-xs text-gray-500">Missed</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-yellow-600">{progress.pending_pills || 0}</p>
                  <p className="text-xs text-gray-500">Pending</p>
                </div>
              </div>

              {progress.adherence_percentage !== undefined && (
                <div className="mt-4 p-3 bg-gray-50 rounded-lg">
                  <p className="text-center text-sm">
                    <span className="font-medium">Adherence Rate: </span>
                    <span className={`font-bold ${progress.adherence_percentage >= 80 ? 'text-green-600' : progress.adherence_percentage >= 60 ? 'text-yellow-600' : 'text-red-600'}`}>
                      {progress.adherence_percentage}%
                    </span>
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {courses.length === 0 && (
        <div className="text-center py-12">
          <Pill className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-500">No medication courses yet. Create your first course to get started!</p>
        </div>
      )}
    </div>
  );
};

const DailyTracker = ({ todaySchedules, onScheduleUpdate }) => {
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [dateSchedules, setDateSchedules] = useState([]);

  useEffect(() => {
    fetchSchedulesForDate();
  }, [selectedDate]);

  const fetchSchedulesForDate = async () => {
    try {
      const response = await axios.get(`${API}/schedules/date/${selectedDate}`);
      setDateSchedules(response.data);
    } catch (error) {
      console.error('Error fetching schedules:', error);
    }
  };

  const updateScheduleStatus = async (scheduleId, status) => {
    try {
      await axios.put(`${API}/schedules/${scheduleId}`, { status });
      onScheduleUpdate();
      fetchSchedulesForDate();
      
      const statusText = status === 'taken' ? 'marked as taken' : 'marked as missed';
      sendNotification('Medication Updated', `Your medication has been ${statusText}!`);
    } catch (error) {
      console.error('Error updating schedule:', error);
    }
  };

  const isToday = selectedDate === new Date().toISOString().split('T')[0];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900">Daily Tracker</h2>
        <input
          type="date"
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>

      {dateSchedules.length > 0 ? (
        <div className="space-y-4">
          {dateSchedules.map((item, index) => (
            <div key={index} className="bg-white p-6 rounded-lg shadow-sm border">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-gray-900">{item.course.pill_name}</h3>
                  <p className="text-gray-600">{item.course.course_name}</p>
                  <div className="flex items-center gap-2 mt-2">
                    <Clock className="h-4 w-4 text-gray-400" />
                    <span className="text-sm text-gray-500">{item.schedule.time_slot}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                    item.schedule.status === 'taken' ? 'bg-green-100 text-green-800' :
                    item.schedule.status === 'missed' ? 'bg-red-100 text-red-800' :
                    'bg-yellow-100 text-yellow-800'
                  }`}>
                    {item.schedule.status.charAt(0).toUpperCase() + item.schedule.status.slice(1)}
                  </span>

                  {(isToday || item.schedule.status === 'pending') && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => updateScheduleStatus(item.schedule.id, 'taken')}
                        className="flex items-center gap-1 px-3 py-1 bg-green-100 text-green-700 rounded-lg hover:bg-green-200 transition-colors"
                        disabled={item.schedule.status === 'taken'}
                      >
                        <CheckCircle className="h-4 w-4" />
                        Taken
                      </button>
                      <button
                        onClick={() => updateScheduleStatus(item.schedule.id, 'missed')}
                        className="flex items-center gap-1 px-3 py-1 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors"
                        disabled={item.schedule.status === 'missed'}
                      >
                        <XCircle className="h-4 w-4" />
                        Missed
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-12">
          <AlertCircle className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-500">No medications scheduled for {selectedDate}</p>
        </div>
      )}
    </div>
  );
};

const AppointmentsManager = ({ appointments, setAppointments }) => {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newAppointment, setNewAppointment] = useState({
    doctor_name: '',
    appointment_date: '',
    appointment_time: '',
    purpose: '',
    notes: ''
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const response = await axios.post(`${API}/appointments`, newAppointment);
      setAppointments(prev => [...prev, response.data]);
      setNewAppointment({
        doctor_name: '',
        appointment_date: '',
        appointment_time: '',
        purpose: '',
        notes: ''
      });
      setShowCreateForm(false);
      sendNotification('Appointment Scheduled', `Your appointment with Dr. ${newAppointment.doctor_name} has been scheduled!`);
    } catch (error) {
      console.error('Error creating appointment:', error);
    }
  };

  const toggleAppointmentStatus = async (appointmentId, completed) => {
    try {
      await axios.put(`${API}/appointments/${appointmentId}`, { completed });
      setAppointments(prev => 
        prev.map(apt => 
          apt.id === appointmentId ? { ...apt, completed } : apt
        )
      );
    } catch (error) {
      console.error('Error updating appointment:', error);
    }
  };

  const deleteAppointment = async (appointmentId) => {
    if (window.confirm('Are you sure you want to delete this appointment?')) {
      try {
        await axios.delete(`${API}/appointments/${appointmentId}`);
        setAppointments(prev => prev.filter(apt => apt.id !== appointmentId));
      } catch (error) {
        console.error('Error deleting appointment:', error);
      }
    }
  };

  const upcomingAppointments = appointments.filter(apt => !apt.completed && new Date(apt.appointment_date) >= new Date());
  const pastAppointments = appointments.filter(apt => apt.completed || new Date(apt.appointment_date) < new Date());

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900">Appointments</h2>
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="h-4 w-4" />
          New Appointment
        </button>
      </div>

      {showCreateForm && (
        <div className="bg-white p-6 rounded-lg shadow-sm border">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Schedule New Appointment</h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Doctor Name</label>
                <input
                  type="text"
                  value={newAppointment.doctor_name}
                  onChange={(e) => setNewAppointment(prev => ({ ...prev, doctor_name: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Dr. Smith"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Purpose</label>
                <input
                  type="text"
                  value={newAppointment.purpose}
                  onChange={(e) => setNewAppointment(prev => ({ ...prev, purpose: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Regular checkup"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Date</label>
                <input
                  type="date"
                  value={newAppointment.appointment_date}
                  onChange={(e) => setNewAppointment(prev => ({ ...prev, appointment_date: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Time</label>
                <input
                  type="time"
                  value={newAppointment.appointment_time}
                  onChange={(e) => setNewAppointment(prev => ({ ...prev, appointment_time: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Notes (Optional)</label>
              <textarea
                value={newAppointment.notes}
                onChange={(e) => setNewAppointment(prev => ({ ...prev, notes: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                rows="3"
                placeholder="Any additional notes..."
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCreateForm(false)}
                className="px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Schedule Appointment
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Upcoming Appointments */}
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Upcoming Appointments</h3>
        {upcomingAppointments.length > 0 ? (
          <div className="space-y-4">
            {upcomingAppointments.map((appointment) => (
              <div key={appointment.id} className="bg-white p-6 rounded-lg shadow-sm border">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <User className="h-5 w-5 text-blue-600" />
                      <h4 className="text-lg font-semibold text-gray-900">{appointment.doctor_name}</h4>
                    </div>
                    <p className="text-gray-600 mb-2">{appointment.purpose}</p>
                    <div className="flex items-center gap-4 text-sm text-gray-500">
                      <div className="flex items-center gap-1">
                        <Calendar className="h-4 w-4" />
                        {appointment.appointment_date}
                      </div>
                      <div className="flex items-center gap-1">
                        <Clock className="h-4 w-4" />
                        {appointment.appointment_time}
                      </div>
                    </div>
                    {appointment.notes && (
                      <p className="text-sm text-gray-600 mt-2 italic">"{appointment.notes}"</p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => toggleAppointmentStatus(appointment.id, true)}
                      className="flex items-center gap-1 px-3 py-1 bg-green-100 text-green-700 rounded-lg hover:bg-green-200 transition-colors"
                    >
                      <CheckCircle className="h-4 w-4" />
                      Complete
                    </button>
                    <button
                      onClick={() => deleteAppointment(appointment.id)}
                      className="text-red-500 hover:text-red-700 transition-colors"
                    >
                      <XCircle className="h-5 w-5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-500 text-center py-8">No upcoming appointments</p>
        )}
      </div>

      {/* Past Appointments */}
      {pastAppointments.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Past Appointments</h3>
          <div className="space-y-4">
            {pastAppointments.map((appointment) => (
              <div key={appointment.id} className="bg-gray-50 p-6 rounded-lg shadow-sm border opacity-75">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <User className="h-5 w-5 text-gray-500" />
                      <h4 className="text-lg font-semibold text-gray-700">{appointment.doctor_name}</h4>
                      {appointment.completed && (
                        <span className="px-2 py-1 bg-green-100 text-green-800 text-xs rounded-full">Completed</span>
                      )}
                    </div>
                    <p className="text-gray-600 mb-2">{appointment.purpose}</p>
                    <div className="flex items-center gap-4 text-sm text-gray-500">
                      <div className="flex items-center gap-1">
                        <Calendar className="h-4 w-4" />
                        {appointment.appointment_date}
                      </div>
                      <div className="flex items-center gap-1">
                        <Clock className="h-4 w-4" />
                        {appointment.appointment_time}
                      </div>
                    </div>
                    {appointment.notes && (
                      <p className="text-sm text-gray-600 mt-2 italic">"{appointment.notes}"</p>
                    )}
                  </div>
                  <button
                    onClick={() => deleteAppointment(appointment.id)}
                    className="text-red-500 hover:text-red-700 transition-colors"
                  >
                    <XCircle className="h-5 w-5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [courses, setCourses] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [analytics, setAnalytics] = useState({});
  const [todaySchedules, setTodaySchedules] = useState([]);

  useEffect(() => {
    requestNotificationPermission();
    fetchData();
    
    // Initialize notification scheduling
    initializeNotifications();
    
    // Cleanup on unmount
    return () => {
      notificationManager.cleanup();
    };
  }, []);

  const initializeNotifications = async () => {
    try {
      const response = await axios.get(`${API}/schedules/pending-reminders`);
      notificationManager.scheduleReminders(response.data);
    } catch (error) {
      console.error('Error initializing notifications:', error);
    }
  };

  const fetchData = async () => {
    try {
      // Fetch all data
      const [coursesRes, appointmentsRes, analyticsRes, todayRes] = await Promise.all([
        axios.get(`${API}/courses`),
        axios.get(`${API}/appointments`),
        axios.get(`${API}/analytics/overview`),
        axios.get(`${API}/schedules/today`)
      ]);

      setCourses(coursesRes.data);
      setAppointments(appointmentsRes.data);
      setAnalytics(analyticsRes.data);
      setTodaySchedules(todayRes.data);
    } catch (error) {
      console.error('Error fetching data:', error);
    }
  };

  const onDataUpdate = useCallback(() => {
    fetchData();
    // Refresh notification scheduling when data changes
    initializeNotifications();
  }, []);

  const navigation = [
    { id: 'dashboard', name: 'Dashboard', icon: Home },
    { id: 'courses', name: 'Courses', icon: Pill },
    { id: 'tracker', name: 'Daily Tracker', icon: CheckCircle },
    { id: 'appointments', name: 'Appointments', icon: Calendar },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Navigation */}
      <nav className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center space-x-8">
              <div className="flex items-center">
                <div className="bg-blue-600 p-2 rounded-lg">
                  <Pill className="h-6 w-6 text-white" />
                </div>
                <span className="ml-2 text-xl font-bold text-gray-900">CareLog</span>
              </div>
              <div className="hidden md:flex space-x-1">
                {navigation.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      onClick={() => setActiveTab(item.id)}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                        activeTab === item.id
                          ? 'bg-blue-100 text-blue-700'
                          : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      {item.name}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </nav>

      {/* Mobile Navigation */}
      <div className="md:hidden bg-white border-t">
        <div className="flex justify-around py-2">
          {navigation.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`flex flex-col items-center gap-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  activeTab === item.id
                    ? 'bg-blue-100 text-blue-700'
                    : 'text-gray-600'
                }`}
              >
                <Icon className="h-5 w-5" />
                {item.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'dashboard' && (
          <Dashboard 
            courses={courses} 
            analytics={analytics} 
            todaySchedules={todaySchedules}
          />
        )}
        {activeTab === 'courses' && (
          <CoursesManager 
            courses={courses} 
            setCourses={setCourses}
            onCourseCreated={onDataUpdate}
          />
        )}
        {activeTab === 'tracker' && (
          <DailyTracker 
            todaySchedules={todaySchedules}
            onScheduleUpdate={onDataUpdate}
          />
        )}
        {activeTab === 'appointments' && (
          <AppointmentsManager 
            appointments={appointments}
            setAppointments={setAppointments}
          />
        )}
      </main>
    </div>
  );
}

export default App;