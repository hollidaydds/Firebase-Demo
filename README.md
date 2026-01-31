# Feedback

[![Firebase](https://img.shields.io/badge/Firebase-FFCA28?style=for-the-badge&logo=firebase&logoColor=black)](https://firebase.google.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

> Anonymous feedback collection platform. Create forms, share links, collect honest responses.

---

## Features

- **Create Feedback Forms** - Sign up and create custom feedback forms with configurable options
- **Share via Link or QR Code** - Each form gets a unique URL and shareable QR code
- **Anonymous Submissions** - Respondents submit feedback without any tracking
- **Private Dashboard** - Only you can see responses to your forms
- **Category Support** - Optionally require respondents to categorize their feedback

---

## How It Works

1. **Sign up** with email/password
2. **Create a form** with a title and optional description
3. **Share the link** with anyone you want feedback from
4. **View responses** in your private dashboard

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | HTML/CSS/JavaScript |
| Backend | Firebase Cloud Functions (TypeScript) |
| Database | Cloud Firestore |
| Auth | Firebase Authentication |
| Hosting | Firebase Hosting |

---

## API Endpoints

### Authenticated (Firebase Callable)
```
User Management
├── getUserProfile       Get current user's profile
└── updateUserProfile    Update display name/photo

Feedback Forms
├── createFeedbackForm   Create a new form
├── getFeedbackForms     List your forms
├── getFeedbackForm      Get form details
└── deleteFeedbackForm   Delete a form

Responses
├── getFeedbackResponses Get responses for a form
└── deleteFeedbackResponse Delete a response
```

### Public (HTTP)
```
├── GET  /api/form?code=xxx    Get form info for submission
├── POST /api/submit           Submit anonymous feedback
└── GET  /api/health           Health check
```

---

## Setup

### Prerequisites
- Node.js 18+
- Firebase CLI (`npm install -g firebase-tools`)

### Local Development

```bash
# Install dependencies
cd functions && npm install

# Start emulators
firebase emulators:start
```

### Configuration

1. Create a Firebase project at [console.firebase.google.com](https://console.firebase.google.com)
2. Enable **Authentication** (Email/Password)
3. Enable **Firestore Database**
4. Update `public/js/app.js` with your Firebase config
5. Update `.firebaserc` with your project ID

### Deploy

```bash
# Deploy everything
firebase deploy

# Deploy only functions
firebase deploy --only functions

# Deploy only hosting
firebase deploy --only hosting
```

---

## Project Structure

```
├── functions/
│   └── src/
│       └── index.ts      # Cloud Functions (API)
├── public/
│   ├── index.html        # Single-page app
│   ├── css/styles.css    # Styling
│   └── js/app.js         # Frontend logic
├── firebase.json         # Firebase config
├── firestore.rules       # Security rules
└── .firebaserc           # Project ID
```

---

## Security

- **Authentication Required** - Only logged-in users can create forms and view responses
- **Anonymous Submissions** - No IP logging, no tracking, no identifying info stored
- **Owner-Only Access** - Users can only see their own forms and responses
- **Cloud Functions** - All sensitive operations go through server-side validation
- **Firestore Rules** - Database-level security as backup

---

## License

MIT

---

Built with Firebase
