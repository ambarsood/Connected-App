import express from 'express';
import crypto from 'node:crypto';
import { auth, db } from './firebase.js';

const app = express();
const port = process.env.PORT || 5000;
const validCategories = ['movie', 'restaurant', 'trip', 'hotel'];
const validStatuses = ['wishlist', 'scheduled', 'done'];
const toBuyCategories = ['Fashion', 'Electronics', 'Home', 'Travel', 'Gift', 'Personal', 'Other'];
const toBuyStatuses = ['thinking', 'approved', 'bought', 'dropped'];
const toBuyPriorities = ['low', 'medium', 'high'];

function normalizeOrigin(origin) {
  return origin.trim().replace(/\/+$/, '');
}

const allowedOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map(normalizeOrigin)
  .filter(Boolean);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  const normalizedOrigin = origin ? normalizeOrigin(origin) : '';

  if (origin && allowedOrigins.includes(normalizedOrigin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  } else if (origin) {
    console.warn(`[cors] Blocked origin: ${origin}. Allowed origins: ${allowedOrigins.join(', ') || 'none'}`);
  }

  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, user-id');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  return next();
});

app.use(express.json());

app.use((req, _res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.originalUrl}`);
  next();
});

function asyncHandler(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      next(error);
    }
  };
}

function createInviteCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

async function createUniqueInviteCode() {
  let code = createInviteCode();
  let existingCode = await db.collection('users').where('inviteCode', '==', code).limit(1).get();

  while (!existingCode.empty) {
    code = createInviteCode();
    existingCode = await db.collection('users').where('inviteCode', '==', code).limit(1).get();
  }

  return code;
}

async function verifyRequestUser(req, res) {
  const userId = req.headers['user-id'];
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!userId || !token) {
    console.warn(`[auth] Missing auth header data for ${req.method} ${req.originalUrl}. user-id present: ${Boolean(userId)}, token present: ${Boolean(token)}`);
    res.status(401).json({ message: 'user-id and Firebase ID token are required' });
    return null;
  }

  let decodedToken;

  try {
    decodedToken = await auth.verifyIdToken(token);
  } catch (error) {
    console.error(`[auth] Firebase ID token verification failed for ${req.method} ${req.originalUrl}.`);
    console.error(`[auth] Verification error: ${error.code || 'unknown'} ${error.message}`);
    res.status(401).json({ message: 'Invalid or expired Firebase ID token' });
    return null;
  }

  if (decodedToken.uid !== userId) {
    console.warn(`[auth] Token uid mismatch for ${req.method} ${req.originalUrl}. header uid: ${userId}, token uid: ${decodedToken.uid}`);
    res.status(403).json({ message: 'Token does not match user-id' });
    return null;
  }

  req.firebaseUser = decodedToken;
  return userId;
}

async function requireUser(req, res) {
  const userId = await verifyRequestUser(req, res);
  if (!userId) return null;

  const userSnapshot = await db.collection('users').doc(userId).get();

  if (!userSnapshot.exists) {
    res.status(401).json({ message: 'User document does not exist' });
    return null;
  }

  return userSnapshot.data();
}

async function getUser(userId) {
  if (!userId) return null;

  const snapshot = await db.collection('users').doc(userId).get();
  return snapshot.exists ? snapshot.data() : null;
}

function userConnectionId(userId, connectionId) {
  return `${userId}_${connectionId}`;
}

async function getUserConnection(userId, connectionId) {
  if (!connectionId) return null;

  const snapshot = await db.collection('user_connections').doc(userConnectionId(userId, connectionId)).get();
  return snapshot.exists ? snapshot.data() : null;
}

async function requireConnection(userId, connectionId, res) {
  const userConnection = await getUserConnection(userId, connectionId);

  if (!userConnection) {
    res.status(403).json({ message: 'Connection not found' });
    return null;
  }

  return userConnection;
}

function getConnectionId(req) {
  return req.query.connectionId || req.body.connectionId;
}

function normalizeDate(date) {
  if (!date) return null;

  const nextDate = String(date).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(nextDate) ? nextDate : null;
}

function normalizeOptionalUrl(url) {
  if (!url) return '';

  const nextUrl = String(url).trim();
  if (!nextUrl) return '';

  try {
    const parsedUrl = new URL(nextUrl);
    return ['http:', 'https:'].includes(parsedUrl.protocol) ? parsedUrl.toString() : '';
  } catch {
    return '';
  }
}

function normalizeAmount(amount) {
  if (amount === null || amount === undefined || amount === '') return null;

  const nextAmount = Number(amount);
  return Number.isFinite(nextAmount) && nextAmount >= 0 ? nextAmount : null;
}

function normalizeToBuyPayload(body, user, userConnection, existingItem = {}) {
  const forUserId = body.forUserId || existingItem.forUserId || 'both';
  const allowedForUserIds = [user.id, userConnection.partnerId, 'both'].filter(Boolean);

  return {
    title: Object.prototype.hasOwnProperty.call(body, 'title') ? String(body.title || '').trim() : existingItem.title,
    description: Object.prototype.hasOwnProperty.call(body, 'description')
      ? String(body.description || '').trim()
      : existingItem.description || '',
    amount: Object.prototype.hasOwnProperty.call(body, 'amount') ? normalizeAmount(body.amount) : existingItem.amount ?? null,
    productLink: Object.prototype.hasOwnProperty.call(body, 'productLink')
      ? normalizeOptionalUrl(body.productLink)
      : existingItem.productLink || '',
    category: toBuyCategories.includes(body.category) ? body.category : existingItem.category || 'Other',
    forUserId: allowedForUserIds.includes(forUserId) ? forUserId : 'both',
    purchaseIntentDate: Object.prototype.hasOwnProperty.call(body, 'purchaseIntentDate')
      ? normalizeDate(body.purchaseIntentDate)
      : existingItem.purchaseIntentDate || null,
    status: toBuyStatuses.includes(body.status) ? body.status : existingItem.status || 'thinking',
    priority: toBuyPriorities.includes(body.priority) ? body.priority : existingItem.priority || 'medium',
    opinionQuestion: Object.prototype.hasOwnProperty.call(body, 'opinionQuestion')
      ? String(body.opinionQuestion || '').trim()
      : existingItem.opinionQuestion || ''
  };
}

function normalizeCategory(category, type) {
  const nextCategory = category || type;

  if (nextCategory === 'place') return 'trip';
  return validCategories.includes(nextCategory) ? nextCategory : null;
}

function statusFromDate(date) {
  return date ? 'scheduled' : 'wishlist';
}

function normalizeItem(itemDoc) {
  const item = { id: itemDoc.id, ...itemDoc.data() };
  const category = normalizeCategory(item.category, item.type) || 'trip';
  const status = validStatuses.includes(item.status) && item.status !== 'pending'
    ? item.status
    : statusFromDate(item.date);

  return {
    ...item,
    category,
    status,
    date: item.date || null
  };
}

function groupItemsByDate(items) {
  return items.reduce((groups, item) => {
    if (!item.date) return groups;

    return {
      ...groups,
      [item.date]: [...(groups[item.date] || []), item]
    };
  }, {});
}

async function getConnectionsForUser(userId) {
  const snapshot = await db.collection('user_connections').where('userId', '==', userId).get();

  return snapshot.docs
    .map((connectionDoc) => ({ id: connectionDoc.id, ...connectionDoc.data() }))
    .sort((a, b) => new Date(b.lastUsedAt || 0) - new Date(a.lastUsedAt || 0));
}

async function connectionExists(userId, partnerId) {
  const snapshot = await db.collection('connections').where('users', 'array-contains', userId).get();

  return snapshot.docs
    .map((connectionDoc) => ({ id: connectionDoc.id, ...connectionDoc.data() }))
    .find((connection) => connection.users.includes(partnerId));
}

async function createConnection(user, partner) {
  const now = new Date().toISOString();
  const connectionRef = db.collection('connections').doc();
  const connection = {
    id: connectionRef.id,
    users: [user.id, partner.id],
    createdAt: now,
    lastActiveAt: now
  };
  const batch = db.batch();

  batch.set(connectionRef, connection);
  batch.set(db.collection('user_connections').doc(userConnectionId(user.id, connectionRef.id)), {
    userId: user.id,
    connectionId: connectionRef.id,
    partnerName: partner.name,
    partnerId: partner.id,
    lastUsedAt: now
  });
  batch.set(db.collection('user_connections').doc(userConnectionId(partner.id, connectionRef.id)), {
    userId: partner.id,
    connectionId: connectionRef.id,
    partnerName: user.name,
    partnerId: user.id,
    lastUsedAt: now
  });
  await batch.commit();

  return {
    connectionId: connectionRef.id,
    partnerName: partner.name,
    partnerId: partner.id,
    lastUsedAt: now
  };
}

async function migrateLegacyPartnerConnection(user) {
  if (!user.partnerId) return null;

  const partner = await getUser(user.partnerId);
  if (!partner) return null;

  const existingConnection = await connectionExists(user.id, partner.id);
  let connection = null;

  if (existingConnection) {
    const now = new Date().toISOString();
    const batch = db.batch();
    batch.set(
      db.collection('user_connections').doc(userConnectionId(user.id, existingConnection.id)),
      {
        userId: user.id,
        connectionId: existingConnection.id,
        partnerName: partner.name,
        partnerId: partner.id,
        lastUsedAt: now
      },
      { merge: true }
    );
    batch.set(
      db.collection('user_connections').doc(userConnectionId(partner.id, existingConnection.id)),
      {
        userId: partner.id,
        connectionId: existingConnection.id,
        partnerName: user.name,
        partnerId: user.id,
        lastUsedAt: now
      },
      { merge: true }
    );
    await batch.commit();
    connection = {
      connectionId: existingConnection.id,
      partnerName: partner.name,
      partnerId: partner.id,
      lastUsedAt: now
    };
  } else {
    connection = await createConnection(user, partner);
  }

  const legacyItemsSnapshot = await db.collection('items').where('userId', 'in', [user.id, partner.id]).get();
  const batch = db.batch();
  let hasUpdates = false;

  legacyItemsSnapshot.docs.forEach((itemDoc) => {
    const item = itemDoc.data();
    const belongsToPair =
      !item.connectionId &&
      ((item.userId === user.id && item.partnerId === partner.id) ||
        (item.userId === partner.id && item.partnerId === user.id));

    if (belongsToPair) {
      batch.update(itemDoc.ref, { connectionId: connection.connectionId });
      hasUpdates = true;
    }
  });

  if (hasUpdates) {
    await batch.commit();
  }

  return connection;
}

app.get('/api/health', (_req, res) => {
  res.send('OK');
});

app.post('/api/users', asyncHandler(async (req, res) => {
  const requestUserId = await verifyRequestUser(req, res);
  if (!requestUserId) return;

  const { id, name, email } = req.body;
  const tokenUser = req.firebaseUser || {};

  if (id && id !== requestUserId) {
    return res.status(400).json({ message: 'User id must match the verified Firebase token' });
  }

  const userEmail = email || tokenUser.email;
  const userName = name || tokenUser.name || tokenUser.email || 'User';

  if (!userEmail) {
    return res.status(400).json({ message: 'A verified email is required to create a user' });
  }

  const userRef = db.collection('users').doc(requestUserId);
  const existingUser = await userRef.get();

  if (existingUser.exists) {
    return res.json(existingUser.data());
  }

  const user = {
    id: requestUserId,
    name: userName,
    email: userEmail,
    partnerId: null,
    inviteCode: await createUniqueInviteCode()
  };

  await userRef.set(user);
  res.status(201).json(user);
}));

app.get('/api/user', asyncHandler(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const partner = user.partnerId ? await getUser(user.partnerId) : null;

  res.json({
    ...user,
    partner: partner ? { id: partner.id, name: partner.name, email: partner.email } : null
  });
}));

app.get('/api/connections', asyncHandler(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  let connections = await getConnectionsForUser(user.id);

  if (connections.length === 0) {
    await migrateLegacyPartnerConnection(user);
    connections = await getConnectionsForUser(user.id);
  }

  res.json(connections);
}));

app.post('/api/connect', asyncHandler(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const code = String(req.body.code || '').trim().toUpperCase();
  const partnerSnapshot = await db.collection('users').where('inviteCode', '==', code).limit(1).get();

  if (partnerSnapshot.empty) {
    return res.status(404).json({ message: 'Invite code not found' });
  }

  const partner = partnerSnapshot.docs[0].data();

  if (partner.id === user.id) {
    return res.status(400).json({ message: 'You cannot connect to your own code' });
  }

  const existingConnection = await connectionExists(user.id, partner.id);
  if (existingConnection) {
    const now = new Date().toISOString();
    const batch = db.batch();
    batch.update(db.collection('connections').doc(existingConnection.id), { lastActiveAt: now });
    batch.set(
      db.collection('user_connections').doc(userConnectionId(user.id, existingConnection.id)),
      {
        userId: user.id,
        connectionId: existingConnection.id,
        partnerName: partner.name,
        partnerId: partner.id,
        lastUsedAt: now
      },
      { merge: true }
    );
    await batch.commit();

    return res.json({
      connection: {
        connectionId: existingConnection.id,
        partnerName: partner.name,
        partnerId: partner.id,
        lastUsedAt: now
      }
    });
  }

  const connection = await createConnection(user, partner);

  res.status(201).json({
    connection
  });
}));

app.post('/api/switch-connection', asyncHandler(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const { connectionId } = req.body;
  const userConnection = await requireConnection(user.id, connectionId, res);
  if (!userConnection) return;

  const now = new Date().toISOString();
  const batch = db.batch();
  batch.update(db.collection('user_connections').doc(userConnectionId(user.id, connectionId)), { lastUsedAt: now });
  batch.update(db.collection('connections').doc(connectionId), { lastActiveAt: now });
  await batch.commit();

  res.json({ ...userConnection, lastUsedAt: now });
}));

app.get('/api/items', asyncHandler(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const connectionId = getConnectionId(req);
  const userConnection = await requireConnection(user.id, connectionId, res);
  if (!userConnection) return;

  const snapshot = await db.collection('items').where('connectionId', '==', connectionId).get();
  const visibleItems = snapshot.docs
    .map(normalizeItem)
    .filter((item) => !req.query.status || item.status === req.query.status)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  res.json(visibleItems);
}));

app.get('/api/items/calendar', asyncHandler(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const connectionId = getConnectionId(req);
  const userConnection = await requireConnection(user.id, connectionId, res);
  if (!userConnection) return;

  const snapshot = await db.collection('items').where('connectionId', '==', connectionId).get();
  const visibleItems = snapshot.docs
    .map(normalizeItem)
    .filter((item) => item.date)
    .sort((a, b) => new Date(a.date || a.createdAt) - new Date(b.date || b.createdAt));

  res.json(groupItemsByDate(visibleItems));
}));

app.get('/api/feelings', asyncHandler(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const connectionId = getConnectionId(req);
  const userConnection = await requireConnection(user.id, connectionId, res);
  if (!userConnection) return;

  const snapshot = await db.collection('feelings').where('connectionId', '==', connectionId).get();
  const feelings = snapshot.docs
    .map((feelingDoc) => ({ id: feelingDoc.id, ...feelingDoc.data() }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  res.json(feelings);
}));

app.post('/api/feelings', asyncHandler(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const { connectionId, text } = req.body;
  const userConnection = await requireConnection(user.id, connectionId, res);
  if (!userConnection) return;
  const nextText = String(text || '').trim();

  if (!nextText) {
    return res.status(400).json({ message: 'Feeling text is required' });
  }

  const now = new Date().toISOString();
  const feeling = {
    connectionId,
    userId: user.id,
    text: nextText,
    createdAt: now
  };

  const feelingRef = await db.collection('feelings').add(feeling);
  await db.collection('connections').doc(connectionId).update({ lastActiveAt: now });

  res.status(201).json({ id: feelingRef.id, ...feeling });
}));

app.delete('/api/feelings/:id', asyncHandler(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const connectionId = getConnectionId(req);
  const userConnection = await requireConnection(user.id, connectionId, res);
  if (!userConnection) return;

  const feelingRef = db.collection('feelings').doc(req.params.id);
  const feelingSnapshot = await feelingRef.get();
  const feeling = feelingSnapshot.data();

  if (!feelingSnapshot.exists || feeling.connectionId !== connectionId) {
    return res.status(404).json({ message: 'Feeling not found' });
  }

  if (feeling.userId !== user.id) {
    return res.status(403).json({ message: 'You can only delete your own feeling' });
  }

  await feelingRef.delete();
  res.status(204).send();
}));

app.get('/api/to-buy', asyncHandler(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const connectionId = getConnectionId(req);
  const userConnection = await requireConnection(user.id, connectionId, res);
  if (!userConnection) return;

  const snapshot = await db.collection('to_buy_items').where('connectionId', '==', connectionId).get();
  const items = snapshot.docs
    .map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  res.json(items);
}));

app.post('/api/to-buy', asyncHandler(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const { connectionId } = req.body;
  const userConnection = await requireConnection(user.id, connectionId, res);
  if (!userConnection) return;
  const payload = normalizeToBuyPayload(
    {
      ...req.body,
      status: 'thinking',
      priority: req.body.priority || 'medium'
    },
    user,
    userConnection
  );

  if (!payload.title) {
    return res.status(400).json({ message: 'Title is required' });
  }

  const now = new Date().toISOString();
  const item = {
    connectionId,
    ...payload,
    currency: 'INR',
    addedByUserId: user.id,
    partnerOpinion: '',
    partnerOpinionByUserId: null,
    partnerOpinionUpdatedAt: null,
    createdAt: now,
    updatedAt: now
  };

  const itemRef = await db.collection('to_buy_items').add(item);
  await db.collection('connections').doc(connectionId).update({ lastActiveAt: now });

  res.status(201).json({ id: itemRef.id, ...item });
}));

app.patch('/api/to-buy/:id', asyncHandler(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const connectionId = getConnectionId(req);
  const userConnection = await requireConnection(user.id, connectionId, res);
  if (!userConnection) return;

  const itemRef = db.collection('to_buy_items').doc(req.params.id);
  const itemSnapshot = await itemRef.get();
  const item = itemSnapshot.data();

  if (!itemSnapshot.exists || item.connectionId !== connectionId) {
    return res.status(404).json({ message: 'To-buy item not found' });
  }

  const updates = normalizeToBuyPayload(req.body, user, userConnection, item);

  if (!updates.title) {
    return res.status(400).json({ message: 'Title is required' });
  }

  updates.updatedAt = new Date().toISOString();
  await itemRef.update(updates);

  res.json({ id: itemSnapshot.id, ...item, ...updates });
}));

app.patch('/api/to-buy/:id/opinion', asyncHandler(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const connectionId = getConnectionId(req);
  const userConnection = await requireConnection(user.id, connectionId, res);
  if (!userConnection) return;

  const itemRef = db.collection('to_buy_items').doc(req.params.id);
  const itemSnapshot = await itemRef.get();
  const item = itemSnapshot.data();

  if (!itemSnapshot.exists || item.connectionId !== connectionId) {
    return res.status(404).json({ message: 'To-buy item not found' });
  }

  if (item.addedByUserId === user.id) {
    return res.status(403).json({ message: 'Partner opinion must be added by the other user' });
  }

  const partnerOpinion = String(req.body.partnerOpinion || '').trim();
  if (!partnerOpinion) {
    return res.status(400).json({ message: 'Opinion is required' });
  }

  const updates = {
    partnerOpinion,
    partnerOpinionByUserId: user.id,
    partnerOpinionUpdatedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  await itemRef.update(updates);
  res.json({ id: itemSnapshot.id, ...item, ...updates });
}));

app.delete('/api/to-buy/:id', asyncHandler(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const connectionId = getConnectionId(req);
  const userConnection = await requireConnection(user.id, connectionId, res);
  if (!userConnection) return;

  const itemRef = db.collection('to_buy_items').doc(req.params.id);
  const itemSnapshot = await itemRef.get();
  const item = itemSnapshot.data();

  if (!itemSnapshot.exists || item.connectionId !== connectionId) {
    return res.status(404).json({ message: 'To-buy item not found' });
  }

  if (item.addedByUserId !== user.id) {
    return res.status(403).json({ message: 'Only the creator can delete this item' });
  }

  await itemRef.delete();
  res.status(204).send();
}));

app.post('/api/items', asyncHandler(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const { category, type, title, notes = '', connectionId, date = null, status } = req.body;
  const userConnection = await requireConnection(user.id, connectionId, res);
  if (!userConnection) return;
  const nextCategory = normalizeCategory(category, type);
  const nextDate = normalizeDate(date);
  const requestedStatus = validStatuses.includes(status) ? status : statusFromDate(nextDate);
  const nextStatus = requestedStatus === 'done' ? 'done' : nextDate ? 'scheduled' : requestedStatus;
  const itemDate = nextStatus === 'wishlist' ? null : nextDate;

  if (!nextCategory) {
    return res.status(400).json({ message: 'Invalid item category' });
  }

  if (!title || !title.trim()) {
    return res.status(400).json({ message: 'Title is required' });
  }

  if (nextStatus === 'scheduled' && !itemDate) {
    return res.status(400).json({ message: 'Scheduled items require a date' });
  }

  const now = new Date().toISOString();
  const item = {
    userId: user.id,
    connectionId,
    category: nextCategory,
    title: title.trim(),
    notes: notes.trim(),
    status: nextStatus,
    date: itemDate,
    createdAt: now
  };

  const itemRef = await db.collection('items').add(item);
  await db.collection('connections').doc(connectionId).update({ lastActiveAt: now });

  res.status(201).json({ id: itemRef.id, ...item });
}));

app.patch('/api/items/:id', asyncHandler(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const connectionId = getConnectionId(req);
  const userConnection = await requireConnection(user.id, connectionId, res);
  if (!userConnection) return;

  const itemRef = db.collection('items').doc(req.params.id);
  const itemSnapshot = await itemRef.get();
  const item = itemSnapshot.data();

  if (!itemSnapshot.exists || item.connectionId !== connectionId) {
    return res.status(404).json({ message: 'Item not found' });
  }

  const updates = {};

  if (Object.prototype.hasOwnProperty.call(req.body, 'date')) {
    updates.date = normalizeDate(req.body.date);
    updates.status = statusFromDate(updates.date);
  }

  if (!Object.prototype.hasOwnProperty.call(req.body, 'date')) {
    updates.status = 'done';
  }

  await itemRef.update(updates);
  res.json({ id: itemSnapshot.id, ...item, ...updates });
}));

app.delete('/api/items/:id', asyncHandler(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const connectionId = getConnectionId(req);
  const userConnection = await requireConnection(user.id, connectionId, res);
  if (!userConnection) return;

  const itemRef = db.collection('items').doc(req.params.id);
  const itemSnapshot = await itemRef.get();
  const item = itemSnapshot.data();

  if (!itemSnapshot.exists || item.connectionId !== connectionId) {
    return res.status(404).json({ message: 'Item not found' });
  }

  await itemRef.delete();
  res.status(204).send();
}));

app.use((error, req, res, _next) => {
  console.error(`[server] Unhandled error for ${req.method} ${req.originalUrl}`);
  console.error(`[server] ${error.code || 'error'}: ${error.message}`);
  if (error.stack) console.error(error.stack);
  res.status(500).json({ message: 'Server error' });
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
