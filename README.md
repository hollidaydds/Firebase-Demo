# SageReport Backend API

[![Firebase](https://img.shields.io/badge/Firebase-FFCA28?style=for-the-badge&logo=firebase&logoColor=black)](https://firebase.google.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Cloud Functions](https://img.shields.io/badge/Cloud%20Functions-4285F4?style=for-the-badge&logo=google-cloud&logoColor=white)](https://cloud.google.com/functions)
[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)

> Production-ready backend API for school psychology evaluation management, built on Firebase/Google Cloud Platform.

---

## Live Demo

| Endpoint | Status |
|----------|--------|
| [Health Check](https://us-central1-sagereportdemoapp.cloudfunctions.net/healthCheck) | ![Status](https://img.shields.io/badge/status-live-brightgreen) |

---

## Features

### Security & Authentication
- Firebase Authentication (Email/Password, OAuth-ready)
- Role-Based Access Control (user / moderator / admin)
- Field-level security with whitelist pattern
- Defense in depth (Functions + Firestore rules)

### FERPA Compliance
- Access logging on every student record view
- Soft deletes (data retention)
- Data isolation (users only see their own students)
- Ownership verification on all operations

### Automated Operations
| Job | Schedule | Purpose |
|-----|----------|---------|
| `dailyUserReport` | 6 AM daily | User metrics & activity stats |
| `weeklyCleanup` | 2 AM Sundays | Archive inactive users |
| `hourlyMetrics` | Every hour | System health snapshots |

### API Endpoints

```
Authentication
├── healthCheck          GET   Public health endpoint
├── onUserCreated        AUTH  Auto-creates user profile
└── onUserDeleted        AUTH  Soft-delete on account removal

User Management
├── getUserProfile       POST  Get current user's profile
├── updateUserProfile    POST  Update allowed fields only
├── listUsers            POST  Admin: list all users
└── updateUserRole       POST  Admin: change user roles

Students (CRUD)
├── createStudent        POST  Create student record
├── getStudents          POST  List user's students
├── getStudent           POST  Get single student + log access
├── updateStudent        POST  Update allowed fields
└── deleteStudent        POST  Soft delete (FERPA)

Assessments
├── createAssessment     POST  Add assessment to student
├── getAssessments       POST  List assessments for student
└── updateAssessment     POST  Update scores/status

Evaluation Reports
├── createEvaluationReport   POST  Generate report
├── getEvaluationReports     POST  List reports for student
└── finalizeReport           POST  Lock report from editing
```

---

## Load Test Results

Real production load test using [Grafana K6](https://k6.io/):

```
══════════════════════════════════════════════════════════════
           SAGEREPORT API LOAD TEST RESULTS
══════════════════════════════════════════════════════════════

  Total HTTP Requests:    2,695
  Requests/sec:           66.96

  Response Times:
    Average:              62ms
    Median:               53ms
    95th Percentile:      82ms
    Max:                  2,780ms (cold start)

  Error Rate:             0.00%

══════════════════════════════════════════════════════════════
```

**Key Takeaways:**
- Zero errors under load
- 95% of requests under 82ms
- Auto-scaling handled 50 concurrent users instantly
- No server configuration required

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Client Applications                       │
│              (Web App, Mobile App, Admin Portal)             │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                  Firebase Authentication                     │
│               (Email/Password, OAuth, SSO)                   │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                   Cloud Functions API                        │
│    ┌───────────┐  ┌───────────┐  ┌───────────────────┐     │
│    │   Auth    │  │   CRUD    │  │  Scheduled Jobs   │     │
│    │ Triggers  │  │ Endpoints │  │    (Webjobs)      │     │
│    └───────────┘  └───────────┘  └───────────────────┘     │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    Cloud Firestore                           │
│  ┌───────┐ ┌──────────┐ ┌─────────────┐ ┌───────────────┐  │
│  │ users │ │ students │ │ assessments │ │ evalReports   │  │
│  └───────┘ └──────────┘ └─────────────┘ └───────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## Quick Start

### Prerequisites
- Node.js 18+
- Firebase CLI (`npm install -g firebase-tools`)

### Setup
```bash
# Clone the repository
git clone https://github.com/hollidaydds/Firebase-Demo.git
cd Firebase-Demo

# Install dependencies
cd functions && npm install

# Login to Firebase
firebase login

# Start local emulators
firebase emulators:start
```

### Deploy to Production
```bash
firebase deploy --only functions
```

---

## Security Highlights

### Privilege Escalation Prevention
```typescript
// Whitelist pattern - only these fields can be updated
const allowedFields = ["displayName", "photoURL", "preferences"];

// "role" field is NEVER allowed - silently ignored
```

### Defense in Depth
1. **Authentication Layer** - Firebase Auth verifies identity
2. **Authorization Layer** - Cloud Functions check roles
3. **Data Layer** - Firestore rules enforce access
4. **Application Layer** - Field whitelisting, input validation

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js 18 |
| Language | TypeScript |
| Functions | Firebase Cloud Functions (2nd Gen) |
| Database | Cloud Firestore |
| Auth | Firebase Authentication |
| Scheduling | Cloud Scheduler |
| Hosting | Google Cloud Platform |

---

## Cost Estimate

| Service | Free Tier | Production (~10K users) |
|---------|-----------|------------------------|
| Cloud Functions | 2M invocations/month | ~$20/month |
| Firestore | 1GB storage | ~$25/month |
| Authentication | 50K MAU | $0 |
| **Total** | **$0** | **~$50/month** |

---

## License

MIT License - see [LICENSE](LICENSE) for details.

---

<p align="center">
  Built with Firebase by <a href="https://github.com/hollidaydds">Ian Hale</a>
</p>
