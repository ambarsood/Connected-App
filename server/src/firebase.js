import admin from 'firebase-admin';

function parseServiceAccount() {
  const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  if (!rawServiceAccount) {
    console.warn('[firebase-admin] FIREBASE_SERVICE_ACCOUNT_JSON is not set. Falling back to application default credentials.');
    return null;
  }

  try {
    const serviceAccount = JSON.parse(rawServiceAccount.trim());
    const missingFields = ['project_id', 'client_email', 'private_key'].filter((field) => !serviceAccount[field]);

    if (missingFields.length > 0) {
      throw new Error(`Missing required service account fields: ${missingFields.join(', ')}`);
    }

    return {
      ...serviceAccount,
      private_key: serviceAccount.private_key.replace(/\\n/g, '\n')
    };
  } catch (error) {
    console.error('[firebase-admin] Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON.');
    console.error('[firebase-admin] Expected a single-line JSON string from a Firebase Admin SDK service account key.');
    console.error(`[firebase-admin] Parse error: ${error.message}`);
    throw error;
  }
}

const serviceAccount = parseServiceAccount();

if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: serviceAccount ? admin.credential.cert(serviceAccount) : admin.credential.applicationDefault()
    });

    console.log(`[firebase-admin] Initialized for project: ${serviceAccount?.project_id || process.env.GOOGLE_CLOUD_PROJECT || 'application-default'}`);
  } catch (error) {
    console.error('[firebase-admin] Failed to initialize Firebase Admin SDK.');
    console.error(`[firebase-admin] Initialization error: ${error.message}`);
    throw error;
  }
}

export const auth = admin.auth();
export const db = admin.firestore();
