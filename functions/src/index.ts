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
    role: "user", // Default role
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    lastLoginAt: FieldValue.serverTimestamp(),
    isActive: true,
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

  // Whitelist allowed fields - security best practice
  const allowedFields = ["displayName", "photoURL", "preferences"];
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
// ADMIN ENDPOINTS (Role-based access)
// ============================================

// Admin-only: List all users
export const listUsers = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "You must be logged in."
    );
  }

  // Check admin role
  const callerDoc = await db.collection("users").doc(context.auth.uid).get();
  const callerData = callerDoc.data();

  if (!callerData || callerData.role !== "admin") {
    functions.logger.warn("Unauthorized admin access attempt", {
      uid: context.auth.uid,
      attemptedAction: "listUsers",
    });
    throw new functions.https.HttpsError(
      "permission-denied",
      "Admin access required."
    );
  }

  functions.logger.info("Admin listUsers called", { adminUid: context.auth.uid });

  const limit = Math.min(data.limit || 50, 100); // Cap at 100
  const usersSnapshot = await db
    .collection("users")
    .where("isActive", "==", true)
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();

  const users = usersSnapshot.docs.map((doc) => ({
    uid: doc.id,
    ...doc.data(),
  }));

  return { users, count: users.length };
});

// Admin-only: Update user role
export const updateUserRole = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "You must be logged in."
    );
  }

  const { targetUid, newRole } = data;

  if (!targetUid || !newRole) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "targetUid and newRole are required."
    );
  }

  const validRoles = ["user", "moderator", "admin"];
  if (!validRoles.includes(newRole)) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      `Invalid role. Must be one of: ${validRoles.join(", ")}`
    );
  }

  // Check admin role
  const callerDoc = await db.collection("users").doc(context.auth.uid).get();
  const callerData = callerDoc.data();

  if (!callerData || callerData.role !== "admin") {
    functions.logger.warn("Unauthorized role change attempt", {
      uid: context.auth.uid,
      targetUid,
      attemptedRole: newRole,
    });
    throw new functions.https.HttpsError(
      "permission-denied",
      "Admin access required."
    );
  }

  functions.logger.info("Admin updateUserRole called", {
    adminUid: context.auth.uid,
    targetUid,
    newRole,
  });

  await db.collection("users").doc(targetUid).update({
    role: newRole,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: context.auth.uid,
  });

  return { success: true, targetUid, newRole };
});

// ============================================
// SCHEDULED FUNCTIONS (Webjobs)
// ============================================

// Daily user metrics report - runs every day at 6:00 AM UTC
export const dailyUserReport = functions.pubsub
  .schedule("0 6 * * *") // Cron: minute hour day month weekday
  .timeZone("America/New_York")
  .onRun(async (context) => {
    functions.logger.info("Daily user report started", {
      scheduledTime: context.timestamp,
    });

    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Get all active users
    const usersSnapshot = await db
      .collection("users")
      .where("isActive", "==", true)
      .get();

    // Calculate metrics
    let totalUsers = 0;
    let newUsersLast24h = 0;
    let activeUsersLast7d = 0;
    const roleBreakdown: Record<string, number> = {};

    usersSnapshot.docs.forEach((doc) => {
      const data = doc.data();
      totalUsers++;

      // Count by role
      const role = data.role || "unknown";
      roleBreakdown[role] = (roleBreakdown[role] || 0) + 1;

      // New users in last 24 hours
      const createdAt = data.createdAt?.toDate?.();
      if (createdAt && createdAt > oneDayAgo) {
        newUsersLast24h++;
      }

      // Active users in last 7 days
      const lastLogin = data.lastLoginAt?.toDate?.();
      if (lastLogin && lastLogin > sevenDaysAgo) {
        activeUsersLast7d++;
      }
    });

    const report = {
      reportDate: now.toISOString(),
      metrics: {
        totalUsers,
        newUsersLast24h,
        activeUsersLast7d,
        inactiveUsers: totalUsers - activeUsersLast7d,
        roleBreakdown,
      },
      generatedAt: FieldValue.serverTimestamp(),
    };

    // Store report in Firestore
    await db.collection("reports").doc(`daily-${now.toISOString().split("T")[0]}`).set(report);

    functions.logger.info("Daily user report completed", {
      totalUsers,
      newUsersLast24h,
      activeUsersLast7d,
    });

    return null;
  });

// Weekly cleanup job - runs every Sunday at 2:00 AM UTC
export const weeklyCleanup = functions.pubsub
  .schedule("0 2 * * 0") // Every Sunday at 2 AM
  .timeZone("America/New_York")
  .onRun(async (context) => {
    functions.logger.info("Weekly cleanup started", {
      scheduledTime: context.timestamp,
    });

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    let archivedCount = 0;
    let deletedReportsCount = 0;

    // Archive users inactive for 30+ days
    const inactiveUsers = await db
      .collection("users")
      .where("isActive", "==", true)
      .where("lastLoginAt", "<", thirtyDaysAgo)
      .get();

    const batch = db.batch();

    inactiveUsers.docs.forEach((doc) => {
      batch.update(doc.ref, {
        isActive: false,
        archivedAt: FieldValue.serverTimestamp(),
        archiveReason: "inactive_30_days",
      });
      archivedCount++;
    });

    // Delete reports older than 90 days
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const oldReports = await db
      .collection("reports")
      .where("generatedAt", "<", ninetyDaysAgo)
      .get();

    oldReports.docs.forEach((doc) => {
      batch.delete(doc.ref);
      deletedReportsCount++;
    });

    await batch.commit();

    functions.logger.info("Weekly cleanup completed", {
      archivedUsers: archivedCount,
      deletedReports: deletedReportsCount,
    });

    return null;
  });

// Hourly health metrics - runs every hour
export const hourlyMetrics = functions.pubsub
  .schedule("0 * * * *") // Every hour on the hour
  .onRun(async (context) => {
    const timestamp = new Date();

    // Collect system metrics
    const metrics = {
      timestamp: timestamp.toISOString(),
      hour: timestamp.getUTCHours(),
      usersCollection: (await db.collection("users").count().get()).data().count,
      reportsCollection: (await db.collection("reports").count().get()).data().count,
      recordedAt: FieldValue.serverTimestamp(),
    };

    // Store in metrics collection (for monitoring dashboards)
    await db.collection("metrics").add(metrics);

    functions.logger.info("Hourly metrics recorded", metrics);

    return null;
  });

// ============================================
// MANUAL TRIGGER FOR TESTING SCHEDULED JOBS
// ============================================

// HTTP endpoint to manually trigger scheduled jobs (admin only)
export const runScheduledJob = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "You must be logged in.");
  }

  // Check admin role
  const callerDoc = await db.collection("users").doc(context.auth.uid).get();
  const callerData = callerDoc.data();

  if (!callerData || callerData.role !== "admin") {
    throw new functions.https.HttpsError("permission-denied", "Admin access required.");
  }

  const { jobName } = data;
  const validJobs = ["dailyUserReport", "weeklyCleanup", "hourlyMetrics"];

  if (!jobName || !validJobs.includes(jobName)) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      `Invalid job. Must be one of: ${validJobs.join(", ")}`
    );
  }

  functions.logger.info("Manual job trigger", {
    adminUid: context.auth.uid,
    jobName,
  });

  // Execute the job logic inline
  if (jobName === "dailyUserReport") {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const usersSnapshot = await db.collection("users").where("isActive", "==", true).get();

    let totalUsers = 0;
    let newUsersLast24h = 0;
    let activeUsersLast7d = 0;
    const roleBreakdown: Record<string, number> = {};

    usersSnapshot.docs.forEach((doc) => {
      const userData = doc.data();
      totalUsers++;
      const role = userData.role || "unknown";
      roleBreakdown[role] = (roleBreakdown[role] || 0) + 1;
      const createdAt = userData.createdAt?.toDate?.();
      if (createdAt && createdAt > oneDayAgo) newUsersLast24h++;
      const lastLogin = userData.lastLoginAt?.toDate?.();
      if (lastLogin && lastLogin > sevenDaysAgo) activeUsersLast7d++;
    });

    const report = {
      reportDate: now.toISOString(),
      metrics: { totalUsers, newUsersLast24h, activeUsersLast7d, inactiveUsers: totalUsers - activeUsersLast7d, roleBreakdown },
      generatedAt: FieldValue.serverTimestamp(),
      manualTrigger: true,
      triggeredBy: context.auth.uid,
    };

    await db.collection("reports").doc(`daily-${now.toISOString().split("T")[0]}`).set(report);
    return { success: true, jobName, report: report.metrics };
  }

  if (jobName === "hourlyMetrics") {
    const timestamp = new Date();
    const metrics = {
      timestamp: timestamp.toISOString(),
      hour: timestamp.getUTCHours(),
      usersCollection: (await db.collection("users").count().get()).data().count,
      reportsCollection: (await db.collection("reports").count().get()).data().count,
      recordedAt: FieldValue.serverTimestamp(),
      manualTrigger: true,
    };
    await db.collection("metrics").add(metrics);
    return { success: true, jobName, metrics };
  }

  return { success: true, jobName, message: "Job executed" };
});
