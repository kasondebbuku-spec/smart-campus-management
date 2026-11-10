# Requirements

## Problem

Attendance in many Zambian university classes is still taken on paper sign-in sheets. Sheets get lost, friends sign for each other, and lecturers spend hours typing them up. Students only find out they are below the attendance requirement when they are barred from an exam. Administrators have no up-to-date view across courses.

Smart Campus replaces the sheet with a system that records attendance at the door, keeps one trustworthy record per student per class, and warns students early.

## Users

| Role | Who | Main goals |
|---|---|---|
| **Admin** | Registry or department administrator | Manage accounts, courses and enrolments; see attendance across the department; audit changes |
| **Lecturer** | Teaching staff | Run class sessions, take attendance quickly, correct mistakes, see who is at risk |
| **Student** | Enrolled student | Check in to class, see their own attendance record, get warnings before it is too late |

## Functional requirements

Status: ✅ done · 🚧 in progress · ⏳ planned

### Accounts and access
- ✅ Admins create student, lecturer and admin accounts
- ✅ Users sign in with email and password
- ✅ Sessions stay signed in for 7 days without storing the password, and can be revoked
- ✅ Each role sees only what it is allowed to (role-based access control)
- ✅ Admins can deactivate an account, which signs that user out everywhere immediately
- ⏳ Password reset by email
- ⏳ Bulk import of students from a CSV class list

### Courses
- ✅ Admins create courses and assign a lecturer
- ✅ Admins enrol students; enrolling someone twice is harmless
- ✅ Lecturers see only their courses; students see only the courses they are enrolled in
- ✅ Lecturers and admins see a course's class list

### Attendance (week 2)
- ✅ Lecturers create, move and cancel class sessions (time, venue)
- ✅ No overlapping sessions for one course; no double-booked venues
- ✅ Sessions with attendance can't be deleted
- ✅ Lecturers open check-in and project a QR code that changes every 30 seconds
- ✅ Students scan the QR code to mark themselves present; late after a set number of minutes
- ✅ Lecturers see a live roster: every enrolled student and whether they've checked in
- ✅ Lecturers mark or correct attendance manually (present, late, absent, excused), with every change audited
- ✅ After class, everyone without a record can be marked absent in one step
- ✅ Before class, only pre-approved absences (excused) can be recorded
- ✅ One record per student per session, enforced by the database

### Reports and notifications (week 3)
- ⏳ Attendance rate per student, per course and per session
- ⏳ Warnings when a student falls below the attendance threshold
- ⏳ CSV and PDF export of class attendance

## Non-functional requirements

| Area | Requirement |
|---|---|
| Security | Passwords hashed with bcrypt; short-lived access tokens; refresh tokens stored only as hashes; login rate limiting; every data-changing action written to an audit log |
| Privacy | Students never see other students' records; a course a user can't access returns 404 so its existence isn't revealed |
| Integrity | Multi-step changes run in database transactions; uniqueness rules (one enrolment, one attendance record) are enforced by the database, not just the code |
| Reliability | Every pull request runs type checks, lint, unit and integration tests against a real PostgreSQL |
| Usability | Works on a phone, because students check in from their phones |
| Portability | Runs anywhere with Docker; configuration only through environment variables |

## Out of scope (for now)

Timetabling, grades and exams, fees, and integration with an existing student information system. The data model leaves room for these, but the goal is to do attendance thoroughly first.
