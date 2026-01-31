// Firebase Configuration
const firebaseConfig = {
  apiKey: "AIzaSyAq_UmyqRmCpve7ApMEgYDXGySd4c21YVw",
  authDomain: "feedback-74cb9.firebaseapp.com",
  projectId: "feedback-74cb9",
  storageBucket: "feedback-74cb9.firebasestorage.app",
  messagingSenderId: "56327861363",
  appId: "1:56327861363:web:d909d829c122c87d4a2606"
};

// Initialize Firebase
let auth, functions;
try {
  firebase.initializeApp(firebaseConfig);
  auth = firebase.auth();
  functions = firebase.functions();
  console.log('Firebase initialized successfully');
} catch (error) {
  console.error('Firebase initialization error:', error);
  alert('Failed to initialize app. Please refresh the page.');
}

// If using emulators locally, uncomment these lines:
// auth.useEmulator("http://localhost:9099");
// functions.useEmulator("localhost", 5001);

// State
let currentUser = null;
let isLoginMode = true;
let currentFormCode = null;

// ============================================
// PAGE MANAGEMENT
// ============================================

function hideAllPages() {
  document.querySelectorAll('.page').forEach(page => {
    page.classList.add('hidden');
  });
}

function showPage(pageId) {
  hideAllPages();
  document.getElementById(pageId).classList.remove('hidden');
}

function showLanding() {
  showPage('landingPage');
}

function showLogin() {
  showPage('authPage');
}

function showDashboard() {
  showPage('dashboardPage');
  loadForms();
}

function showCreateForm() {
  showPage('createFormPage');
  document.getElementById('createFeedbackForm').reset();
  document.getElementById('categoriesGroup').classList.add('hidden');
}

let currentFormUniqueCode = null;

function showResponses(formId, formTitle, uniqueCode) {
  currentFormUniqueCode = uniqueCode;
  showPage('responsesPage');
  document.getElementById('responsesTitle').textContent = formTitle;

  // Set up share section with QR code
  const shareUrl = `${window.location.origin}/f/${uniqueCode}`;
  document.getElementById('responseShareLink').value = shareUrl;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(shareUrl)}`;
  document.getElementById('responseQrCode').innerHTML = `<img src="${qrUrl}" alt="QR Code" width="120" height="120">`;

  loadResponses(formId);
}

function copyResponseLink() {
  const input = document.getElementById('responseShareLink');
  navigator.clipboard.writeText(input.value).then(() => {
    alert('Link copied!');
  });
}

// ============================================
// AUTHENTICATION
// ============================================

function toggleAuthMode(event) {
  event.preventDefault();
  isLoginMode = !isLoginMode;

  document.getElementById('authTitle').textContent = isLoginMode ? 'Sign In' : 'Sign Up';
  document.getElementById('authButton').textContent = isLoginMode ? 'Sign In' : 'Sign Up';
  document.getElementById('authSwitchText').textContent = isLoginMode ? "Don't have an account?" : "Already have an account?";
  document.querySelector('.auth-switch a').textContent = isLoginMode ? 'Sign Up' : 'Sign In';
  document.getElementById('authError').classList.add('hidden');
}

async function handleAuth(event) {
  event.preventDefault();

  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  const errorDiv = document.getElementById('authError');
  const submitBtn = document.getElementById('authButton');

  errorDiv.classList.add('hidden');
  submitBtn.disabled = true;
  submitBtn.textContent = isLoginMode ? 'Signing in...' : 'Signing up...';

  try {
    if (isLoginMode) {
      await auth.signInWithEmailAndPassword(email, password);
    } else {
      await auth.createUserWithEmailAndPassword(email, password);
    }
  } catch (error) {
    console.error('Auth error:', error);
    errorDiv.textContent = error.message || 'Authentication failed. Please try again.';
    errorDiv.classList.remove('hidden');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = isLoginMode ? 'Sign In' : 'Sign Up';
  }
}

function updateNavForUser(user) {
  const navActions = document.getElementById('navActions');

  if (user) {
    navActions.innerHTML = `
      <span class="nav-user">${user.email}</span>
      <button class="btn btn-secondary btn-sm" onclick="showDashboard()">Dashboard</button>
      <button class="btn btn-secondary btn-sm" onclick="signOut()">Sign Out</button>
    `;
  } else {
    navActions.innerHTML = `
      <button class="btn btn-secondary btn-sm" onclick="showLogin()">Sign In</button>
    `;
  }
}

async function signOut() {
  await auth.signOut();
  showLanding();
}

// Auth state listener
auth.onAuthStateChanged((user) => {
  currentUser = user;
  updateNavForUser(user);

  // If logged in and on landing or auth page, go to dashboard
  if (user) {
    const onLanding = !document.getElementById('landingPage').classList.contains('hidden');
    const onAuth = !document.getElementById('authPage').classList.contains('hidden');
    if (onLanding || onAuth) {
      showDashboard();
    }
  }
});

// ============================================
// FEEDBACK FORMS
// ============================================

async function loadForms() {
  const formsList = document.getElementById('formsList');
  const subtitle = document.getElementById('dashboardSubtitle');

  formsList.innerHTML = '<div class="loading"><div class="spinner"></div>Loading...</div>';

  try {
    const getFeedbackForms = functions.httpsCallable('getFeedbackForms', { timeout: 30000 });
    console.log('Calling getFeedbackForms...');
    const result = await getFeedbackForms({});
    console.log('Got result:', result);
    const forms = result.data.forms;

    // Update subtitle with stats
    const totalResponses = forms.reduce((sum, f) => sum + (f.responseCount || 0), 0);
    subtitle.textContent = `${forms.length} form${forms.length !== 1 ? 's' : ''} \u2022 ${totalResponses} total response${totalResponses !== 1 ? 's' : ''}`;

    if (forms.length === 0) {
      subtitle.textContent = 'Create your first form to get started';
      formsList.innerHTML = `
        <div class="empty-state">
          <h3>No forms yet</h3>
          <p>Click "Create Form" to start collecting anonymous feedback.</p>
        </div>
      `;
      return;
    }

    formsList.innerHTML = forms.map(form => `
      <div class="form-card">
        <div class="form-card-info">
          <div class="form-card-title">${escapeHtml(form.title)}</div>
          <div class="form-card-meta">
            <span>${form.uniqueCode}</span>
            <span>${formatTimeAgo(form.createdAt)}</span>
          </div>
        </div>
        <div class="form-card-responses">
          ${form.responseCount || 0}
          <small>responses</small>
        </div>
        <div class="form-card-actions">
          <button class="btn btn-secondary btn-sm" onclick="copyFormLink('${form.uniqueCode}')">Copy</button>
          <button class="btn btn-secondary btn-sm" onclick="showResponses('${form.id}', '${escapeHtml(form.title)}', '${form.uniqueCode}')">View</button>
          <button class="btn btn-danger btn-sm" onclick="deleteForm('${form.id}')">Delete</button>
        </div>
      </div>
    `).join('');
  } catch (error) {
    console.error('Error loading forms:', error);
    subtitle.textContent = 'Error loading forms';
    formsList.innerHTML = `<div class="error-message">Error: ${error.message}</div>`;
  }
}

function formatTimeAgo(timestamp) {
  if (!timestamp) return '';

  const date = timestamp._seconds
    ? new Date(timestamp._seconds * 1000)
    : new Date(timestamp);

  const now = new Date();
  const diffMs = now - date;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  return date.toLocaleDateString();
}

let isCreatingForm = false;

async function handleCreateForm(event) {
  event.preventDefault();

  // Prevent double submission
  if (isCreatingForm) return;
  isCreatingForm = true;

  const submitBtn = event.target.querySelector('button[type="submit"]');
  const originalText = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = 'Creating...';

  const title = document.getElementById('formTitle').value;
  const description = document.getElementById('formDescription').value;
  const allowMultiple = document.getElementById('allowMultiple').checked;
  const requireCategory = document.getElementById('requireCategory').checked;
  const categoriesInput = document.getElementById('categories').value;

  const categories = requireCategory && categoriesInput
    ? categoriesInput.split(',').map(c => c.trim()).filter(c => c)
    : [];

  try {
    const createFeedbackForm = functions.httpsCallable('createFeedbackForm');
    const result = await createFeedbackForm({
      title,
      description,
      allowMultipleResponses: allowMultiple,
      requireCategory,
      categories
    });

    // Show success page
    showPage('formCreatedPage');
    const shareUrl = `${window.location.origin}/f/${result.data.uniqueCode}`;
    document.getElementById('shareLink').value = shareUrl;

    // Generate QR code using API
    const qrDiv = document.getElementById('qrCode');
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(shareUrl)}`;
    qrDiv.innerHTML = `<img src="${qrUrl}" alt="QR Code" width="200" height="200">`;
    isCreatingForm = false;
  } catch (error) {
    alert('Error creating form: ' + error.message);
    submitBtn.disabled = false;
    submitBtn.textContent = originalText;
    isCreatingForm = false;
  }
}

async function deleteForm(formId) {
  if (!confirm('Are you sure you want to delete this form? All responses will be lost.')) {
    return;
  }

  try {
    const deleteFeedbackForm = functions.httpsCallable('deleteFeedbackForm');
    await deleteFeedbackForm({ formId });
    loadForms();
  } catch (error) {
    alert('Error deleting form: ' + error.message);
  }
}

function copyFormLink(code) {
  const url = `${window.location.origin}/f/${code}`;
  navigator.clipboard.writeText(url).then(() => {
    alert('Link copied to clipboard!');
  });
}

function copyLink() {
  const input = document.getElementById('shareLink');
  navigator.clipboard.writeText(input.value).then(() => {
    alert('Link copied to clipboard!');
  });
}

function toggleCategoryInput() {
  const requireCategory = document.getElementById('requireCategory').checked;
  document.getElementById('categoriesGroup').classList.toggle('hidden', !requireCategory);
}

// ============================================
// RESPONSES
// ============================================

let currentFormId = null;

async function loadResponses(formId) {
  currentFormId = formId;
  const responsesList = document.getElementById('responsesList');
  responsesList.innerHTML = '<div class="loading"><div class="spinner"></div>Loading responses...</div>';

  try {
    const getFeedbackResponses = functions.httpsCallable('getFeedbackResponses');
    const result = await getFeedbackResponses({ formId });

    document.getElementById('responsesCount').textContent = result.data.count;

    if (result.data.responses.length === 0) {
      responsesList.innerHTML = `
        <div class="empty-state">
          <h3>No responses yet</h3>
          <p>Share your form link to start collecting feedback.</p>
        </div>
      `;
      return;
    }

    responsesList.innerHTML = result.data.responses.map(response => `
      <div class="response-card">
        <div class="response-card-header">
          ${response.category ? `<span class="response-category">${escapeHtml(response.category)}</span>` : '<span></span>'}
          <span class="response-time">${formatDate(response.submittedAt)}</span>
        </div>
        <div class="response-message">${escapeHtml(response.message)}</div>
        <div class="response-actions">
          <button class="btn btn-danger btn-sm" onclick="deleteResponse('${response.id}')">Delete</button>
        </div>
      </div>
    `).join('');
  } catch (error) {
    responsesList.innerHTML = `<div class="error-message">Error loading responses: ${error.message}</div>`;
  }
}

async function deleteResponse(responseId) {
  if (!confirm('Delete this response?')) {
    return;
  }

  try {
    const deleteFeedbackResponse = functions.httpsCallable('deleteFeedbackResponse');
    await deleteFeedbackResponse({ responseId });
    loadResponses(currentFormId);
  } catch (error) {
    alert('Error deleting response: ' + error.message);
  }
}

// ============================================
// ANONYMOUS FEEDBACK SUBMISSION
// ============================================

async function loadSubmitForm(code) {
  currentFormCode = code;

  try {
    const response = await fetch(`/api/form?code=${code}`);

    if (!response.ok) {
      showPage('notFoundPage');
      return;
    }

    const form = await response.json();

    showPage('submitPage');
    document.getElementById('submitFormTitle').textContent = form.title;
    document.getElementById('submitFormDescription').textContent = form.description || '';

    // Handle categories
    const categoryGroup = document.getElementById('submitCategoryGroup');
    const categorySelect = document.getElementById('submitCategory');

    if (form.requireCategory && form.categories.length > 0) {
      categoryGroup.classList.remove('hidden');
      categorySelect.innerHTML = form.categories.map(c =>
        `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`
      ).join('');
    } else {
      categoryGroup.classList.add('hidden');
    }
  } catch (error) {
    showPage('notFoundPage');
  }
}

let isSubmitting = false;

async function handleSubmitFeedback(event) {
  event.preventDefault();

  // Prevent double submission
  if (isSubmitting) return;
  isSubmitting = true;

  const submitBtn = event.target.querySelector('button[type="submit"]');
  const originalText = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = 'Submitting...';

  const message = document.getElementById('feedbackMessage').value;
  const categorySelect = document.getElementById('submitCategory');
  const category = document.getElementById('submitCategoryGroup').classList.contains('hidden')
    ? null
    : categorySelect.value;

  try {
    const response = await fetch('/api/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: currentFormCode,
        message,
        category
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error);
    }

    showPage('submittedPage');
  } catch (error) {
    alert('Error submitting feedback: ' + error.message);
    submitBtn.disabled = false;
    submitBtn.textContent = originalText;
    isSubmitting = false;
  }
}

// ============================================
// UTILITIES
// ============================================

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatDate(timestamp) {
  if (!timestamp) return '';

  // Handle Firestore timestamp
  const date = timestamp._seconds
    ? new Date(timestamp._seconds * 1000)
    : new Date(timestamp);

  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// ============================================
// ROUTING
// ============================================

function handleRoute() {
  const path = window.location.pathname;

  // Check for feedback form submission route
  if (path.startsWith('/f/')) {
    const code = path.substring(3);
    loadSubmitForm(code);
    return;
  }

  // Check for feedback view route (legacy support)
  if (path.startsWith('/feedback/')) {
    const code = path.substring(10);
    loadSubmitForm(code);
    return;
  }

  // Default: show landing or dashboard based on auth
  if (currentUser) {
    showDashboard();
  } else {
    showLanding();
  }
}

// Handle browser navigation
window.addEventListener('popstate', handleRoute);

// Initial route
document.addEventListener('DOMContentLoaded', () => {
  // Check URL params for form code
  const urlParams = new URLSearchParams(window.location.search);
  const code = urlParams.get('code') || urlParams.get('id');

  if (code) {
    loadSubmitForm(code);
  } else {
    handleRoute();
  }
});
