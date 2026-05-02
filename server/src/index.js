import express from 'express';
import crypto from 'node:crypto';
import { auth, db } from './firebase.js';

const app = express();
const port = process.env.PORT || 5000;
const validCategories = ['movie', 'restaurant', 'trip', 'hotel'];
const validStatuses = ['wishlist', 'scheduled', 'done'];
const allowedOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
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
    res.status(401).json({ message: 'user-id and Firebase ID token are required' });
    return null;
  }

  const decodedToken = await auth.verifyIdToken(token);

  if (decodedToken.uid !== userId) {
    res.status(403).json({ message: 'Token does not match user-id' });
    return null;
  }

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

  if (!id || !email || id !== requestUserId) {
    return res.status(400).json({ message: 'Valid id and email are required' });
  }

  const userRef = db.collection('users').doc(id);
  const existingUser = await userRef.get();

  if (existingUser.exists) {
    return res.json(existingUser.data());
  }

  const user = {
    id,
    name: name || 'User',
    email,
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

app.post('/api/items', asyncHandler(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const { category, type, title, notes = '', connectionId, date = null } = req.body;
  const userConnection = await requireConnection(user.id, connectionId, res);
  if (!userConnection) return;
  const nextCategory = normalizeCategory(category, type);
  const nextDate = normalizeDate(date);

  if (!nextCategory) {
    return res.status(400).json({ message: 'Invalid item category' });
  }

  if (!title || !title.trim()) {
    return res.status(400).json({ message: 'Title is required' });
  }

  const now = new Date().toISOString();
  const item = {
    userId: user.id,
    connectionId,
    category: nextCategory,
    title: title.trim(),
    notes: notes.trim(),
    status: statusFromDate(nextDate),
    date: nextDate,
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

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ message: 'Server error' });
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
