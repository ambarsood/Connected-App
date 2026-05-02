import { useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { auth, firebaseReady, googleProvider } from './firebase.js';

const tabs = [
  { id: 'wishlist', label: 'Wishlist', emptyTitle: 'Nothing on the wishlist yet', emptyIcon: '✨' },
  { id: 'scheduled', label: 'Scheduled', emptyTitle: 'Nothing scheduled yet', emptyIcon: '📅' }
];

const categories = [
  { id: 'all', label: 'All' },
  { id: 'movie', label: 'Movies' },
  { id: 'restaurant', label: 'Restaurants' },
  { id: 'trip', label: 'Trips' },
  { id: 'hotel', label: 'Hotels' }
];

const activeConnectionStorageKey = 'coupleWishlistActiveConnectionId';
const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || '';

function apiPath(path) {
  return `${apiBaseUrl}${path}`;
}

async function responseError(response, fallbackMessage) {
  try {
    const data = await response.json();
    return new Error(data.message || fallbackMessage);
  } catch {
    return new Error(fallbackMessage);
  }
}

function App() {
  const [authUser, setAuthUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [connections, setConnections] = useState([]);
  const [activeConnectionId, setActiveConnectionId] = useState(localStorage.getItem(activeConnectionStorageKey) || '');
  const [items, setItems] = useState([]);
  const [calendarItems, setCalendarItems] = useState({});
  const [activeTab, setActiveTab] = useState('wishlist');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [viewMode, setViewMode] = useState('list');
  const [calendarMonth, setCalendarMonth] = useState(startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState(toDateInputValue(new Date()));
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [date, setDate] = useState('');
  const [category, setCategory] = useState('movie');
  const [inviteCode, setInviteCode] = useState('');
  const [message, setMessage] = useState('');
  const [toast, setToast] = useState('');
  const [loading, setLoading] = useState(true);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isConnectOpen, setIsConnectOpen] = useState(false);

  const activeTabMeta = tabs.find((tab) => tab.id === activeTab);
  const activeConnection = connections.find((connection) => connection.connectionId === activeConnectionId);
  const visibleItems = useMemo(() => {
    return items
      .filter((item) => itemTabStatus(item) === activeTab)
      .filter((item) => categoryFilter === 'all' || itemCategory(item) === categoryFilter);
  }, [activeTab, categoryFilter, items]);
  const selectedDateItems = (calendarItems[selectedDate] || [])
    .filter((item) => item.date)
    .filter((item) => categoryFilter === 'all' || itemCategory(item) === categoryFilter);

  useEffect(() => {
    if (!toast) return undefined;

    const timeout = window.setTimeout(() => setToast(''), 2600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  async function getAuthHeaders(currentUser = authUser) {
    if (!currentUser) return {};

    const token = await currentUser.getIdToken();

    return {
      Authorization: `Bearer ${token}`,
      'user-id': currentUser.uid
    };
  }

  async function ensureUserDocument(currentUser) {
    const response = await fetch(apiPath('/api/users'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await getAuthHeaders(currentUser))
      },
      body: JSON.stringify({
        id: currentUser.uid,
        name: currentUser.displayName,
        email: currentUser.email
      })
    });

    if (!response.ok) throw await responseError(response, 'Could not create user');
    return response.json();
  }

  async function loadProfile(currentUser = authUser) {
    if (!currentUser) return null;

    const response = await fetch(apiPath('/api/user'), { headers: await getAuthHeaders(currentUser) });

    if (!response.ok) throw await responseError(response, 'Could not load profile');

    const nextProfile = await response.json();
    setProfile(nextProfile);
    return nextProfile;
  }

  async function loadConnections(currentUser = authUser) {
    if (!currentUser) return [];

    const response = await fetch(apiPath('/api/connections'), { headers: await getAuthHeaders(currentUser) });

    if (!response.ok) throw await responseError(response, 'Could not load connections');

    const nextConnections = await response.json();
    setConnections(nextConnections);
    return nextConnections;
  }

  async function loadItems(connectionId = activeConnectionId, currentUser = authUser) {
    if (!currentUser || !connectionId) {
      setItems([]);
      setCalendarItems({});
      return;
    }

    const params = new URLSearchParams({ connectionId });
    const [itemsResponse, calendarResponse] = await Promise.all([
      fetch(apiPath(`/api/items?${params.toString()}`), { headers: await getAuthHeaders(currentUser) }),
      fetch(apiPath(`/api/items/calendar?${params.toString()}`), { headers: await getAuthHeaders(currentUser) })
    ]);

    if (!itemsResponse.ok) throw await responseError(itemsResponse, 'Could not load items');
    if (!calendarResponse.ok) throw await responseError(calendarResponse, 'Could not load calendar items');

    setItems(await itemsResponse.json());
    setCalendarItems(await calendarResponse.json());
  }

  function chooseActiveConnection(nextConnections, preferredConnectionId = activeConnectionId) {
    const savedConnectionId = localStorage.getItem(activeConnectionStorageKey);
    const nextActiveConnection =
      nextConnections.find((connection) => connection.connectionId === preferredConnectionId) ||
      nextConnections.find((connection) => connection.connectionId === savedConnectionId) ||
      nextConnections[0];

    if (!nextActiveConnection) {
      setActiveConnectionId('');
      localStorage.removeItem(activeConnectionStorageKey);
      return '';
    }

    setActiveConnectionId(nextActiveConnection.connectionId);
    localStorage.setItem(activeConnectionStorageKey, nextActiveConnection.connectionId);
    return nextActiveConnection.connectionId;
  }

  useEffect(() => {
    if (!firebaseReady) {
      setLoading(false);
      return undefined;
    }

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setLoading(true);
      setMessage('');
      setAuthUser(currentUser);

      if (!currentUser) {
        setProfile(null);
        setConnections([]);
        setItems([]);
        setCalendarItems({});
        setActiveConnectionId('');
        setLoading(false);
        return;
      }

      try {
        await ensureUserDocument(currentUser);
        await loadProfile(currentUser);
        const nextConnections = await loadConnections(currentUser);
        const nextConnectionId = chooseActiveConnection(nextConnections);
        await loadItems(nextConnectionId, currentUser);
      } catch (error) {
        setMessage(`Could not load your account: ${error.message || 'Check Firebase configuration.'}`);
      } finally {
        setLoading(false);
      }
    });

    return unsubscribe;
  }, []);

  async function handleGoogleLogin() {
    if (!auth || !googleProvider) return;

    setMessage('');

    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      setMessage(`${error.code || 'auth/error'}: ${error.message || 'Google sign-in failed.'}`);
    }
  }

  async function handleSignOut() {
    if (!auth) return;

    localStorage.removeItem(activeConnectionStorageKey);
    await signOut(auth);
  }

  async function switchConnection(connectionId) {
    if (!connectionId || connectionId === activeConnectionId) return;

    setActiveConnectionId(connectionId);
    localStorage.setItem(activeConnectionStorageKey, connectionId);
    setItems([]);
    setCalendarItems({});

    await fetch(apiPath('/api/switch-connection'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await getAuthHeaders())
      },
      body: JSON.stringify({ connectionId })
    });

    const nextConnections = await loadConnections();
    chooseActiveConnection(nextConnections, connectionId);
    await loadItems(connectionId);
  }

  async function addItem(event) {
    event.preventDefault();

    if (!title.trim() || !activeConnectionId) return;

    const response = await fetch(apiPath('/api/items'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await getAuthHeaders())
      },
      body: JSON.stringify({
        connectionId: activeConnectionId,
        category,
        title,
        notes,
        date: date || null
      })
    });

    if (!response.ok) {
      setMessage('Could not add item.');
      return;
    }

    setTitle('');
    setNotes('');
    setDate('');
    setCategory('movie');
    setMessage('');
    setIsAddModalOpen(false);
    setToast('Item added');
    await loadItems();
  }

  async function markDone(itemId) {
    const response = await fetch(apiPath(`/api/items/${itemId}`), {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(await getAuthHeaders())
      },
      body: JSON.stringify({ connectionId: activeConnectionId })
    });

    if (!response.ok) {
      setMessage('Could not update item.');
      return;
    }

    setToast('Marked as done');
    await loadItems();
  }

  async function updateItemDate(itemId, nextDate) {
    const response = await fetch(apiPath(`/api/items/${itemId}`), {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(await getAuthHeaders())
      },
      body: JSON.stringify({ connectionId: activeConnectionId, date: nextDate || null })
    });

    if (!response.ok) {
      setMessage('Could not update date.');
      return;
    }

    setToast(nextDate ? 'Date scheduled' : 'Date cleared');
    await loadItems();
  }

  async function deleteItem(itemId) {
    const response = await fetch(apiPath(`/api/items/${itemId}`), {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        ...(await getAuthHeaders())
      },
      body: JSON.stringify({ connectionId: activeConnectionId })
    });

    if (!response.ok) {
      setMessage('Could not delete item.');
      return;
    }

    setToast('Item deleted');
    await loadItems();
  }

  async function connectPartner(event) {
    event.preventDefault();

    const response = await fetch(apiPath('/api/connect'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await getAuthHeaders())
      },
      body: JSON.stringify({ code: inviteCode })
    });

    const result = await response.json();

    if (!response.ok) {
      setMessage(result.message || 'Could not connect.');
      return;
    }

    const nextConnectionId = result.connection.connectionId;
    setInviteCode('');
    setMessage('');
    setToast('Connection added');
    setIsConnectOpen(false);
    const nextConnections = await loadConnections();
    chooseActiveConnection(nextConnections, nextConnectionId);
    await loadItems(nextConnectionId);
  }

  if (loading) return <LoadingScreen />;
  if (!firebaseReady) return <FirebaseSetupPage />;
  if (!authUser) return <LoginPage message={message} onLogin={handleGoogleLogin} />;

  return (
    <main className="min-h-screen bg-[#f7f3ef] text-gray-950">
      <TopNav
        activeConnection={activeConnection}
        authUser={authUser}
        connections={connections}
        onAddConnection={() => setIsConnectOpen(true)}
        onSignOut={handleSignOut}
        onSwitchConnection={switchConnection}
        profile={profile}
      />

      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 pb-28 pt-5 sm:px-6">
        <section className="rounded-2xl bg-white/80 p-5 shadow-sm ring-1 ring-black/5 backdrop-blur">
          <p className="text-xl font-semibold">Hey {firstName(profile?.name || authUser.displayName || authUser.email)} 👋</p>
          <p className="mt-1 text-sm text-gray-600">
            {activeConnection ? `Planning with ${activeConnection.partnerName}.` : 'Add a connection to start a shared wishlist.'}
          </p>
        </section>

        <ConnectionPanel
          inviteCode={inviteCode}
          isOpen={isConnectOpen || connections.length === 0}
          message={message}
          onClose={() => setIsConnectOpen(false)}
          onConnect={connectPartner}
          onInviteCodeChange={setInviteCode}
          userCode={profile?.inviteCode}
        />

        <section className="rounded-2xl bg-white/80 p-4 shadow-sm ring-1 ring-black/5 backdrop-blur">
          {activeConnection ? (
            <>
              <Tabs
                activeTab={activeTab}
                onChange={(tab) => {
                  setActiveTab(tab);
                  if (tab === 'wishlist') setViewMode('list');
                }}
              />
              <CategoryFilter categoryFilter={categoryFilter} onChange={setCategoryFilter} />
              <ViewToggle
                onChange={(mode) => {
                  setViewMode(mode);
                  if (mode === 'calendar') setActiveTab('scheduled');
                }}
                viewMode={viewMode}
              />
              {viewMode === 'list' ? (
                <ItemList
                  activeTab={activeTabMeta}
                  authUser={authUser}
                  connection={activeConnection}
                  items={visibleItems}
                  onDateChange={updateItemDate}
                  onDelete={deleteItem}
                  onDone={markDone}
                />
              ) : (
                <CalendarView
                  activeTab={activeTabMeta}
                  calendarItems={calendarItems}
                  categoryFilter={categoryFilter}
                  month={calendarMonth}
                  onMonthChange={setCalendarMonth}
                  onSelectDate={setSelectedDate}
                  selectedDate={selectedDate}
                  selectedItems={selectedDateItems}
                />
              )}
            </>
          ) : (
            <NoConnectionState onAddConnection={() => setIsConnectOpen(true)} />
          )}
        </section>
      </div>

      {activeConnection ? (
        <button
          className="fixed bottom-5 right-5 grid h-14 w-14 place-items-center rounded-2xl bg-gray-950 text-3xl leading-none text-white shadow-md transition hover:-translate-y-0.5 hover:bg-gray-800 focus:outline-none focus:ring-4 focus:ring-pink-200"
          onClick={() => setIsAddModalOpen(true)}
          type="button"
        >
          +
        </button>
      ) : null}

      {isAddModalOpen ? (
        <AddItemModal
          activeTab={activeTabMeta}
          category={category}
          date={date}
          notes={notes}
          onCategoryChange={setCategory}
          onClose={() => setIsAddModalOpen(false)}
          onDateChange={setDate}
          onNotesChange={setNotes}
          onSubmit={addItem}
          onTitleChange={setTitle}
          title={title}
        />
      ) : null}

      {toast ? <Toast message={toast} /> : null}
    </main>
  );
}

function firstName(name) {
  return (name || 'there').split(' ')[0] || 'there';
}

function itemCategory(item) {
  if (item.category) return item.category;
  if (item.type === 'place') return 'trip';
  return item.type || 'trip';
}

function itemStatus(item) {
  if (item.status === 'done') return 'done';
  if (item.status === 'scheduled' || item.status === 'wishlist') return item.status;
  return item.date ? 'scheduled' : 'wishlist';
}

function itemTabStatus(item) {
  return item.date ? 'scheduled' : 'wishlist';
}

function categoryLabel(category) {
  return categories.find((option) => option.id === category)?.label || 'Trips';
}

function toDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function formatMonth(date) {
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function formatReadableDate(dateString) {
  if (!dateString) return 'No date';

  return new Date(`${dateString}T00:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

function getCalendarDays(month) {
  const firstDay = startOfMonth(month);
  const startDate = new Date(firstDay);
  startDate.setDate(firstDay.getDate() - firstDay.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(startDate);
    day.setDate(startDate.getDate() + index);
    return day;
  });
}

function LoadingScreen() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f7f3ef] px-4 text-gray-950">
      <div className="rounded-2xl bg-white p-5 shadow-sm">
        <p className="text-sm font-medium text-gray-600">Loading Couple Wishlist...</p>
      </div>
    </main>
  );
}

function TopNav({ activeConnection, authUser, connections, onAddConnection, onSignOut, onSwitchConnection, profile }) {
  const avatarUrl = authUser.photoURL;
  const name = profile?.name || authUser.displayName || 'You';

  return (
    <nav className="sticky top-0 z-20 border-b border-black/5 bg-[#f7f3ef]/90 backdrop-blur">
      <div className="mx-auto flex max-w-3xl flex-col gap-3 px-4 py-3 sm:px-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xl font-semibold tracking-tight">Couple Wishlist</p>
            <p className="text-sm text-gray-600">Shared plans, one cozy list</p>
          </div>
          <div className="flex items-center gap-3">
            {avatarUrl ? (
              <img alt={name} className="h-10 w-10 rounded-full object-cover ring-2 ring-white" src={avatarUrl} />
            ) : (
              <div className="grid h-10 w-10 place-items-center rounded-full bg-pink-100 text-sm font-semibold text-pink-700">
                {name.charAt(0)}
              </div>
            )}
            <button
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 shadow-sm transition hover:border-gray-300 hover:bg-gray-50"
              onClick={onSignOut}
              type="button"
            >
              Logout
            </button>
          </div>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1">
          {connections.map((connection) => (
            <button
              className={`min-w-fit rounded-full px-4 py-2 text-sm font-semibold transition ${
                activeConnection?.connectionId === connection.connectionId
                  ? 'bg-gray-950 text-white'
                  : 'bg-white text-gray-700 shadow-sm ring-1 ring-black/5 hover:bg-gray-50'
              }`}
              key={connection.connectionId}
              onClick={() => onSwitchConnection(connection.connectionId)}
              type="button"
            >
              {connection.partnerName}
            </button>
          ))}
          <button
            className="min-w-fit rounded-full bg-pink-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-pink-700"
            onClick={onAddConnection}
            type="button"
          >
            + Add new connection
          </button>
        </div>
      </div>
    </nav>
  );
}

function Tabs({ activeTab, onChange }) {
  return (
    <div className="flex gap-2 overflow-x-auto border-b border-gray-100">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className={`min-w-fit border-b-2 px-3 pb-3 pt-1 text-sm font-semibold transition ${
            activeTab === tab.id
              ? 'border-pink-500 text-gray-950'
              : 'border-transparent text-gray-500 hover:text-gray-900'
          }`}
          onClick={() => onChange(tab.id)}
          type="button"
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function CategoryFilter({ categoryFilter, onChange }) {
  return (
    <label className="mt-4 grid gap-2 text-sm font-semibold text-gray-700">
      Filter
      <select
        className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-pink-400 focus:ring-4 focus:ring-pink-100"
        onChange={(event) => onChange(event.target.value)}
        value={categoryFilter}
      >
        {categories.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function ViewToggle({ onChange, viewMode }) {
  return (
    <div className="mt-4 grid grid-cols-2 gap-2 rounded-2xl bg-gray-100 p-1">
      {['list', 'calendar'].map((mode) => (
        <button
          className={`rounded-xl px-3 py-2 text-sm font-semibold transition ${
            viewMode === mode ? 'bg-white text-gray-950 shadow-sm' : 'text-gray-500 hover:text-gray-900'
          }`}
          key={mode}
          onClick={() => onChange(mode)}
          type="button"
        >
          {mode === 'list' ? 'List View' : 'Calendar View'}
        </button>
      ))}
    </div>
  );
}

function ConnectionPanel({ inviteCode, isOpen, message, onClose, onConnect, onInviteCodeChange, userCode }) {
  if (!isOpen) return null;

  return (
    <section className="grid gap-4 rounded-2xl bg-white/80 p-4 shadow-sm ring-1 ring-black/5 backdrop-blur sm:grid-cols-[1fr_1fr]">
      <div>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xl font-semibold">Add Connection</p>
            <p className="mt-1 text-sm text-gray-600">Share your invite code or enter theirs once.</p>
          </div>
          <button
            className="rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-sm font-semibold text-gray-600 hover:bg-gray-50"
            onClick={onClose}
            type="button"
          >
            Hide
          </button>
        </div>
        <div className="mt-4 rounded-2xl bg-pink-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-pink-700">Your Invite Code</p>
          <p className="mt-1 font-mono text-2xl font-semibold tracking-wide text-gray-950">{userCode || '...'}</p>
        </div>
      </div>

      <div>
        <form className="grid gap-3" onSubmit={onConnect}>
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-gray-700">Friend or partner code</span>
            <input
              className="min-w-0 rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm uppercase outline-none transition focus:border-pink-400 focus:ring-4 focus:ring-pink-100"
              onChange={(event) => onInviteCodeChange(event.target.value)}
              placeholder="Invite code"
              value={inviteCode}
            />
          </label>
          <button
            className="rounded-xl bg-pink-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-pink-700"
            type="submit"
          >
            Connect
          </button>
        </form>
        {message ? <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">{message}</p> : null}
      </div>
    </section>
  );
}

function NoConnectionState({ onAddConnection }) {
  return (
    <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-6 py-12 text-center">
      <p className="text-4xl">🤝</p>
      <h2 className="mt-3 text-xl font-semibold text-gray-950">No connections yet</h2>
      <p className="mt-1 text-sm text-gray-600">Add a friend or partner to start sharing wishlist items.</p>
      <button
        className="mt-5 rounded-xl bg-gray-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-gray-800"
        onClick={onAddConnection}
        type="button"
      >
        Add new connection
      </button>
    </div>
  );
}

function ItemList({ activeTab, authUser, connection, items, onDateChange, onDelete, onDone }) {
  if (items.length === 0) return <EmptyState activeTab={activeTab} />;
  const groupedItems = items.reduce((groups, item) => {
    const category = itemCategory(item);
    return {
      ...groups,
      [category]: [...(groups[category] || []), item]
    };
  }, {});

  return (
    <div className="mt-4 grid gap-4">
      {Object.entries(groupedItems).map(([category, categoryItems]) => (
        <section className="grid gap-3" key={category}>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">{categoryLabel(category)}</h2>
          {categoryItems.map((item) => (
            <ItemCard
              authUser={authUser}
              connection={connection}
              item={item}
              key={item.id}
              onDateChange={onDateChange}
              onDelete={onDelete}
              onDone={onDone}
            />
          ))}
        </section>
      ))}
    </div>
  );
}

function ItemCard({ authUser, connection, item, onDateChange, onDelete, onDone }) {
  const isDone = item.status === 'done';
  const addedBy = item.userId === authUser.uid ? 'You' : connection?.partnerName || 'Connection';
  const category = itemCategory(item);
  const status = itemStatus(item);

  return (
    <article className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5 transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className={`text-xl font-semibold ${isDone ? 'text-gray-400 line-through' : 'text-gray-950'}`}>
            {item.title}
          </h2>
          {item.notes ? <p className="mt-1 text-sm text-gray-600">{item.notes}</p> : null}
          <p className="mt-2 text-sm font-medium text-gray-500">{item.date ? formatReadableDate(item.date) : 'Not scheduled'}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <CategoryBadge category={category} />
          <StatusBadge status={status} />
        </div>
      </div>

      <div className="mt-4 grid gap-3 border-t border-gray-100 pt-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-gray-500">Added by {addedBy}</p>
          <label className="flex items-center gap-2 text-sm font-medium text-gray-600">
            Date
            <input
              className="rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none transition focus:border-pink-400 focus:ring-4 focus:ring-pink-100"
              onChange={(event) => onDateChange(item.id, event.target.value)}
              type="date"
              value={item.date || ''}
            />
          </label>
        </div>
        <div className="flex gap-2">
          {!isDone ? (
            <button
              className="rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700"
              onClick={() => onDone(item.id)}
              type="button"
            >
              Mark as Done
            </button>
          ) : null}
          <button
            className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
            onClick={() => onDelete(item.id)}
            type="button"
          >
            Delete
          </button>
        </div>
      </div>
    </article>
  );
}

function CalendarView({ activeTab, calendarItems, categoryFilter, month, onMonthChange, onSelectDate, selectedDate, selectedItems }) {
  const days = getCalendarDays(month);

  function moveMonth(offset) {
    onMonthChange(new Date(month.getFullYear(), month.getMonth() + offset, 1));
  }

  return (
    <div className="mt-4 grid gap-4">
      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
        <div className="flex items-center justify-between gap-3">
          <button
            className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
            onClick={() => moveMonth(-1)}
            type="button"
          >
            Prev
          </button>
          <h2 className="text-xl font-semibold">{formatMonth(month)}</h2>
          <button
            className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
            onClick={() => moveMonth(1)}
            type="button"
          >
            Next
          </button>
        </div>

        <div className="mt-4 grid grid-cols-7 gap-1 text-center text-xs font-semibold text-gray-500">
          {weekdays.map((day) => (
            <div key={day}>{day}</div>
          ))}
        </div>

        <div className="mt-2 grid grid-cols-7 gap-1">
          {days.map((day) => {
            const dateKey = toDateInputValue(day);
            const dayItems = (calendarItems[dateKey] || [])
              .filter((item) => item.date)
              .filter((item) => categoryFilter === 'all' || itemCategory(item) === categoryFilter);
            const isCurrentMonth = day.getMonth() === month.getMonth();
            const isSelected = selectedDate === dateKey;

            return (
              <button
                className={`min-h-14 rounded-xl border p-1 text-left text-sm transition ${
                  isSelected
                    ? 'border-pink-500 bg-pink-50'
                    : dayItems.length
                      ? 'border-pink-200 bg-white'
                      : 'border-gray-100 bg-gray-50 hover:bg-white'
                } ${isCurrentMonth ? 'text-gray-900' : 'text-gray-300'}`}
                key={dateKey}
                onClick={() => onSelectDate(dateKey)}
                type="button"
              >
                <span className="font-semibold">{day.getDate()}</span>
                {dayItems.length ? <span className="mt-2 block h-2 w-2 rounded-full bg-pink-500" /> : null}
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
        <h3 className="text-xl font-semibold">{formatReadableDate(selectedDate)}</h3>
        {selectedItems.length ? (
          <div className="mt-3 grid gap-3">
            {selectedItems.map((item) => (
              <div className="rounded-xl bg-gray-50 p-3" key={item.id}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-gray-950">{item.title}</p>
                    {item.notes ? <p className="mt-1 text-sm text-gray-600">{item.notes}</p> : null}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <CategoryBadge category={itemCategory(item)} />
                    <StatusBadge status={itemStatus(item)} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 rounded-xl border border-dashed border-gray-200 bg-gray-50 p-5 text-center text-sm text-gray-600">
            No {activeTab.label.toLowerCase()} items scheduled for this day.
          </p>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  const isDone = status === 'done';
  const isScheduled = status === 'scheduled';

  return (
    <span
      className={`rounded-full px-3 py-1 text-xs font-semibold ${
        isDone
          ? 'bg-emerald-100 text-emerald-700'
          : isScheduled
            ? 'bg-blue-100 text-blue-700'
            : 'bg-amber-100 text-amber-700'
      }`}
    >
      {isDone ? 'Done' : isScheduled ? 'Scheduled' : 'Wishlist'}
    </span>
  );
}

function CategoryBadge({ category }) {
  return (
    <span className="rounded-full bg-pink-50 px-3 py-1 text-xs font-semibold text-pink-700">
      {categoryLabel(category)}
    </span>
  );
}

function EmptyState({ activeTab }) {
  const tab = activeTab || tabs[0];

  return (
    <div className="mt-4 rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-6 py-12 text-center">
      <p className="text-4xl">{tab.emptyIcon}</p>
      <h2 className="mt-3 text-xl font-semibold text-gray-950">
        {tab.emptyTitle} {tab.emptyIcon}
      </h2>
      <p className="mt-1 text-sm text-gray-600">Add your first one</p>
    </div>
  );
}

function AddItemModal({
  activeTab,
  category,
  date,
  notes,
  onCategoryChange,
  onClose,
  onDateChange,
  onNotesChange,
  onSubmit,
  onTitleChange,
  title
}) {
  const tab = activeTab || tabs[0];

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-gray-950/40 px-4 backdrop-blur-sm">
      <section className="w-full max-w-md rounded-2xl bg-white p-5 shadow-md">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">Add Item</h2>
            <p className="mt-1 text-sm text-gray-600">
              Choose a date to schedule it, or leave it blank for the wishlist.
            </p>
          </div>
          <button
            className="rounded-xl border border-gray-200 px-3 py-1 text-sm font-semibold text-gray-600 hover:bg-gray-50"
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        </div>

        <form className="mt-5 grid gap-4" onSubmit={onSubmit}>
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-gray-700">Title</span>
            <input
              autoFocus
              className="rounded-xl border border-gray-200 px-3 py-3 text-sm outline-none transition focus:border-pink-400 focus:ring-4 focus:ring-pink-100"
              onChange={(event) => onTitleChange(event.target.value)}
              placeholder={`Add ${tab.label.toLowerCase()} item`}
              required
              value={title}
            />
          </label>

          <label className="grid gap-2">
            <span className="text-sm font-semibold text-gray-700">Category</span>
            <select
              className="rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm outline-none transition focus:border-pink-400 focus:ring-4 focus:ring-pink-100"
              onChange={(event) => onCategoryChange(event.target.value)}
              value={category}
            >
              {categories
                .filter((option) => option.id !== 'all')
                .map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
            </select>
          </label>

          <label className="grid gap-2">
            <span className="text-sm font-semibold text-gray-700">Date</span>
            <input
              className="rounded-xl border border-gray-200 px-3 py-3 text-sm outline-none transition focus:border-pink-400 focus:ring-4 focus:ring-pink-100"
              onChange={(event) => onDateChange(event.target.value)}
              type="date"
              value={date}
            />
          </label>

          <label className="grid gap-2">
            <span className="text-sm font-semibold text-gray-700">Notes</span>
            <textarea
              className="min-h-24 rounded-xl border border-gray-200 px-3 py-3 text-sm outline-none transition focus:border-pink-400 focus:ring-4 focus:ring-pink-100"
              onChange={(event) => onNotesChange(event.target.value)}
              placeholder="Optional"
              value={notes}
            />
          </label>

          <div className="flex gap-2 pt-1">
            <button
              className="flex-1 rounded-xl bg-gray-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-gray-800"
              type="submit"
            >
              Add Item
            </button>
            <button
              className="rounded-xl border border-gray-200 px-4 py-3 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
              onClick={onClose}
              type="button"
            >
              Cancel
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function Toast({ message }) {
  return (
    <div className="fixed bottom-24 left-1/2 z-40 -translate-x-1/2 rounded-full bg-gray-950 px-4 py-2 text-sm font-semibold text-white shadow-md">
      {message}
    </div>
  );
}

function FirebaseSetupPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f7f3ef] px-4 text-gray-950">
      <section className="w-full max-w-lg rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-wide text-pink-600">Couple Wishlist</p>
        <h1 className="mt-2 text-xl font-semibold">Firebase config needed</h1>
        <p className="mt-3 text-sm text-gray-600">
          Add your Firebase values to a root <span className="font-mono">.env</span> file, then restart Docker.
        </p>
        <pre className="mt-4 overflow-auto rounded-xl bg-gray-950 p-4 text-xs text-white">
{`cp .env.example .env
docker compose down
docker compose up --build`}
        </pre>
      </section>
    </main>
  );
}

function LoginPage({ message, onLogin }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f7f3ef] px-4 text-gray-950">
      <section className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-wide text-pink-600">Couple Wishlist</p>
        <h1 className="mt-2 text-xl font-semibold">Sign in to continue</h1>
        <p className="mt-2 text-sm text-gray-600">Use Google to keep your shared wishlist connected.</p>
        <button
          className="mt-6 w-full rounded-xl bg-gray-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-gray-800"
          onClick={onLogin}
          type="button"
        >
          Sign in with Google
        </button>
        {message ? <p className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">{message}</p> : null}
      </section>
    </main>
  );
}

export default App;
