import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

admin.initializeApp();

const db = admin.firestore();

// ============================================
// HEALTH & MONITORING
// ============================================

export const healthCheck = functions.https.onRequest((req, res) => {
  functions.logger.info("Health check called", { structuredData: true });
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    project: process.env.GCLOUD_PROJECT,
  });
});

// ============================================
// AUTHENTICATION TRIGGERS
// ============================================

// Automatically create user profile when a new user signs up
export const onUserCreated = functions.auth.user().onCreate(async (user) => {
  functions.logger.info("New user created", {
    uid: user.uid,
    email: user.email,
    provider: user.providerData[0]?.providerId || "unknown",
  });

  const userProfile = {
    uid: user.uid,
    email: user.email || null,
    displayName: user.displayName || null,
    photoURL: user.photoURL || null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    lastLoginAt: FieldValue.serverTimestamp(),
    isActive: true,
    formsCreated: 0,
  };

  await db.collection("users").doc(user.uid).set(userProfile);

  functions.logger.info("User profile created in Firestore", { uid: user.uid });

  return { success: true };
});

// Clean up when user is deleted
export const onUserDeleted = functions.auth.user().onDelete(async (user) => {
  functions.logger.info("User deleted", { uid: user.uid, email: user.email });

  // Soft delete - mark as inactive rather than removing data
  await db.collection("users").doc(user.uid).update({
    isActive: false,
    deletedAt: FieldValue.serverTimestamp(),
  });

  return { success: true };
});

// ============================================
// USER PROFILE ENDPOINTS
// ============================================

// Get current user's profile
export const getUserProfile = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "You must be logged in."
    );
  }

  functions.logger.info("getUserProfile called", { uid: context.auth.uid });

  const userDoc = await db.collection("users").doc(context.auth.uid).get();

  if (!userDoc.exists) {
    throw new functions.https.HttpsError("not-found", "User profile not found.");
  }

  // Update last login
  await db.collection("users").doc(context.auth.uid).update({
    lastLoginAt: FieldValue.serverTimestamp(),
  });

  return userDoc.data();
});

// Update user profile (only allowed fields)
export const updateUserProfile = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "You must be logged in."
    );
  }

  // Whitelist allowed fields
  const allowedFields = ["displayName", "photoURL"];
  const updates: Record<string, unknown> = {};

  for (const field of allowedFields) {
    if (data[field] !== undefined) {
      updates[field] = data[field];
    }
  }

  if (Object.keys(updates).length === 0) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "No valid fields to update."
    );
  }

  updates.updatedAt = FieldValue.serverTimestamp();

  functions.logger.info("updateUserProfile called", {
    uid: context.auth.uid,
    fields: Object.keys(updates),
  });

  await db.collection("users").doc(context.auth.uid).update(updates);

  return { success: true, updatedFields: Object.keys(updates) };
});

// ============================================
// FEEDBACK FORM CRUD (Authenticated Users)
// ============================================

// Generate a unique code for the feedback form
function generateUniqueCode(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Create a new feedback form
export const createFeedbackForm = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "You must be logged in to create a feedback form.");
  }

  const { title, description, allowMultipleResponses, requireCategory, categories } = data;

  if (!title || title.trim().length === 0) {
    throw new functions.https.HttpsError("invalid-argument", "Title is required.");
  }

  if (title.length > 200) {
    throw new functions.https.HttpsError("invalid-argument", "Title must be 200 characters or less.");
  }

  if (description && description.length > 1000) {
    throw new functions.https.HttpsError("invalid-argument", "Description must be 1000 characters or less.");
  }

  // Generate unique code and ensure it doesn't exist
  let uniqueCode = generateUniqueCode();
  let codeExists = true;
  let attempts = 0;

  while (codeExists && attempts < 10) {
    const existingForm = await db.collection("feedbackForms")
      .where("uniqueCode", "==", uniqueCode)
      .limit(1)
      .get();

    if (existingForm.empty) {
      codeExists = false;
    } else {
      uniqueCode = generateUniqueCode();
      attempts++;
    }
  }

  if (codeExists) {
    throw new functions.https.HttpsError("internal", "Failed to generate unique code. Please try again.");
  }

  const formData = {
    uniqueCode,
    title: title.trim(),
    description: description?.trim() || null,
    allowMultipleResponses: allowMultipleResponses || false,
    requireCategory: requireCategory || false,
    categories: requireCategory && Array.isArray(categories) ? categories : [],
    createdBy: context.auth.uid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    isActive: true,
    responseCount: 0,
  };

  const docRef = await db.collection("feedbackForms").add(formData);

  // Increment user's form count (don't fail if user doc doesn't exist)
  try {
    await db.collection("users").doc(context.auth.uid).set({
      formsCreated: FieldValue.increment(1),
    }, { merge: true });
  } catch (userUpdateError) {
    functions.logger.warn("Could not update user form count", { error: userUpdateError });
  }

  functions.logger.info("Feedback form created", {
    formId: docRef.id,
    uniqueCode,
    createdBy: context.auth.uid,
  });

  return {
    success: true,
    formId: docRef.id,
    uniqueCode,
  };
});

// Get all feedback forms for the current user
export const getFeedbackForms = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "You must be logged in.");
  }

  const limit = Math.min(data?.limit || 50, 100);

  const snapshot = await db
    .collection("feedbackForms")
    .where("createdBy", "==", context.auth.uid)
    .where("isActive", "==", true)
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();

  const forms = snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));

  functions.logger.info("getFeedbackForms called", {
    uid: context.auth.uid,
    count: forms.length,
  });

  return { forms, count: forms.length };
});

// Get a single feedback form by ID (for owner)
export const getFeedbackForm = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "You must be logged in.");
  }

  const { formId } = data;

  if (!formId) {
    throw new functions.https.HttpsError("invalid-argument", "formId is required.");
  }

  const formDoc = await db.collection("feedbackForms").doc(formId).get();

  if (!formDoc.exists) {
    throw new functions.https.HttpsError("not-found", "Feedback form not found.");
  }

  const formData = formDoc.data();

  // Only owner can get full form details
  if (formData?.createdBy !== context.auth.uid) {
    throw new functions.https.HttpsError("permission-denied", "Access denied.");
  }

  return {
    id: formDoc.id,
    ...formData,
  };
});

// Delete a feedback form (soft delete)
export const deleteFeedbackForm = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "You must be logged in.");
  }

  const { formId } = data;

  if (!formId) {
    throw new functions.https.HttpsError("invalid-argument", "formId is required.");
  }

  const formDoc = await db.collection("feedbackForms").doc(formId).get();

  if (!formDoc.exists) {
    throw new functions.https.HttpsError("not-found", "Feedback form not found.");
  }

  if (formDoc.data()?.createdBy !== context.auth.uid) {
    throw new functions.https.HttpsError("permission-denied", "Access denied.");
  }

  await db.collection("feedbackForms").doc(formId).update({
    isActive: false,
    deletedAt: FieldValue.serverTimestamp(),
  });

  functions.logger.info("Feedback form deleted", {
    formId,
    deletedBy: context.auth.uid,
  });

  return { success: true, formId };
});

// ============================================
// ANONYMOUS FEEDBACK SUBMISSION
// ============================================

// Get form info for anonymous users (public endpoint)
export const getFormForSubmission = functions.https.onRequest(async (req, res) => {
  // Enable CORS
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const uniqueCode = req.query.code as string;

  if (!uniqueCode) {
    res.status(400).json({ error: "code parameter is required" });
    return;
  }

  const snapshot = await db
    .collection("feedbackForms")
    .where("uniqueCode", "==", uniqueCode)
    .where("isActive", "==", true)
    .limit(1)
    .get();

  if (snapshot.empty) {
    res.status(404).json({ error: "Feedback form not found" });
    return;
  }

  const formDoc = snapshot.docs[0];
  const formData = formDoc.data();

  // Only return public-safe fields
  res.json({
    title: formData.title,
    description: formData.description,
    requireCategory: formData.requireCategory,
    categories: formData.categories || [],
    allowMultipleResponses: formData.allowMultipleResponses,
  });
});

// Submit anonymous feedback (public endpoint - no auth required)
export const submitFeedback = functions.https.onRequest(async (req, res) => {
  // Enable CORS
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { code, message, category } = req.body;

  if (!code) {
    res.status(400).json({ error: "code is required" });
    return;
  }

  if (!message || message.trim().length === 0) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  if (message.length > 5000) {
    res.status(400).json({ error: "message must be 5000 characters or less" });
    return;
  }

  // Find the form
  const snapshot = await db
    .collection("feedbackForms")
    .where("uniqueCode", "==", code)
    .where("isActive", "==", true)
    .limit(1)
    .get();

  if (snapshot.empty) {
    res.status(404).json({ error: "Feedback form not found" });
    return;
  }

  const formDoc = snapshot.docs[0];
  const formData = formDoc.data();

  // Validate category if required
  if (formData.requireCategory) {
    if (!category || category.trim().length === 0) {
      res.status(400).json({ error: "category is required for this form" });
      return;
    }
    if (formData.categories?.length > 0 && !formData.categories.includes(category)) {
      res.status(400).json({ error: "Invalid category" });
      return;
    }
  }

  const responseData = {
    formId: formDoc.id,
    message: message.trim(),
    category: category?.trim() || null,
    submittedAt: FieldValue.serverTimestamp(),
    // Explicitly NOT storing IP or any identifying info for anonymity
  };

  await db.collection("feedbackResponses").add(responseData);

  // Increment response count on the form
  await db.collection("feedbackForms").doc(formDoc.id).update({
    responseCount: FieldValue.increment(1),
    lastResponseAt: FieldValue.serverTimestamp(),
  });

  functions.logger.info("Anonymous feedback submitted", {
    formId: formDoc.id,
    hasCategory: !!category,
  });

  res.json({ success: true, message: "Feedback submitted successfully" });
});

// ============================================
// FEEDBACK RESPONSES (Authenticated - Owner Only)
// ============================================

// Get all responses for a feedback form
export const getFeedbackResponses = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "You must be logged in.");
  }

  const { formId, limit: requestedLimit } = data;

  if (!formId) {
    throw new functions.https.HttpsError("invalid-argument", "formId is required.");
  }

  // Verify form ownership
  const formDoc = await db.collection("feedbackForms").doc(formId).get();

  if (!formDoc.exists) {
    throw new functions.https.HttpsError("not-found", "Feedback form not found.");
  }

  if (formDoc.data()?.createdBy !== context.auth.uid) {
    throw new functions.https.HttpsError("permission-denied", "Access denied.");
  }

  const limit = Math.min(requestedLimit || 100, 500);

  const snapshot = await db
    .collection("feedbackResponses")
    .where("formId", "==", formId)
    .orderBy("submittedAt", "desc")
    .limit(limit)
    .get();

  const responses = snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));

  functions.logger.info("getFeedbackResponses called", {
    uid: context.auth.uid,
    formId,
    count: responses.length,
  });

  return { responses, count: responses.length };
});

// Delete a single feedback response
export const deleteFeedbackResponse = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "You must be logged in.");
  }

  const { responseId } = data;

  if (!responseId) {
    throw new functions.https.HttpsError("invalid-argument", "responseId is required.");
  }

  const responseDoc = await db.collection("feedbackResponses").doc(responseId).get();

  if (!responseDoc.exists) {
    throw new functions.https.HttpsError("not-found", "Response not found.");
  }

  const responseData = responseDoc.data();

  // Verify ownership through form
  const formDoc = await db.collection("feedbackForms").doc(responseData?.formId).get();

  if (!formDoc.exists || formDoc.data()?.createdBy !== context.auth.uid) {
    throw new functions.https.HttpsError("permission-denied", "Access denied.");
  }

  await db.collection("feedbackResponses").doc(responseId).delete();

  // Decrement response count
  await db.collection("feedbackForms").doc(responseData?.formId).update({
    responseCount: FieldValue.increment(-1),
  });

  functions.logger.info("Feedback response deleted", {
    responseId,
    formId: responseData?.formId,
    deletedBy: context.auth.uid,
  });

  return { success: true, responseId };
});

// ============================================
// SCHEDULED FUNCTIONS
// ============================================

// Daily metrics report - runs every day at 6:00 AM
export const dailyMetricsReport = functions.pubsub
  .schedule("0 6 * * *")
  .timeZone("America/New_York")
  .onRun(async (context) => {
    functions.logger.info("Daily metrics report started", {
      scheduledTime: context.timestamp,
    });

    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Get counts
    const usersCount = (await db.collection("users").where("isActive", "==", true).count().get()).data().count;
    const formsCount = (await db.collection("feedbackForms").where("isActive", "==", true).count().get()).data().count;
    const responsesCount = (await db.collection("feedbackResponses").count().get()).data().count;

    // New responses in last 24 hours
    const recentResponses = await db
      .collection("feedbackResponses")
      .where("submittedAt", ">", oneDayAgo)
      .count()
      .get();

    const report = {
      reportDate: now.toISOString(),
      metrics: {
        totalUsers: usersCount,
        totalForms: formsCount,
        totalResponses: responsesCount,
        responsesLast24h: recentResponses.data().count,
      },
      generatedAt: FieldValue.serverTimestamp(),
    };

    await db.collection("reports").doc(`daily-${now.toISOString().split("T")[0]}`).set(report);

    functions.logger.info("Daily metrics report completed", report.metrics);

    return null;
  });

// Hourly metrics - runs every hour
export const hourlyMetrics = functions.pubsub
  .schedule("0 * * * *")
  .onRun(async (context) => {
    const timestamp = new Date();

    const metrics = {
      timestamp: timestamp.toISOString(),
      hour: timestamp.getUTCHours(),
      usersCollection: (await db.collection("users").count().get()).data().count,
      formsCollection: (await db.collection("feedbackForms").count().get()).data().count,
      responsesCollection: (await db.collection("feedbackResponses").count().get()).data().count,
      recordedAt: FieldValue.serverTimestamp(),
    };

    await db.collection("metrics").add(metrics);

    functions.logger.info("Hourly metrics recorded", metrics);

    return null;
  });
