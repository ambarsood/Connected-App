import { useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { auth, firebaseReady, googleProvider } from './firebase.js';

const tabs = [
  { id: 'wishlist', label: 'Wishlist', emptyTitle: 'Nothing on the wishlist yet', emptyIcon: '✨' },
  { id: 'scheduled', label: 'Scheduled', emptyTitle: 'Nothing scheduled yet', emptyIcon: '📅' },
  { id: 'feelings', label: 'Feelings 💌', emptyTitle: 'No feelings shared yet', emptyIcon: '💌' },
  { id: 'to-buy', label: 'To Buy 🛒', emptyTitle: 'No items yet', emptyIcon: '🛒' }
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
const toBuyCategories = ['Fashion', 'Electronics', 'Home', 'Travel', 'Gift', 'Personal', 'Other'];
const toBuyStatuses = ['all', 'thinking', 'approved', 'bought', 'dropped'];
const toBuyPriorities = ['low', 'medium', 'high'];
const emptyToBuyDraft = {
  title: '',
  description: '',
  amount: '',
  productLink: '',
  category: 'Other',
  forUserId: 'both',
  purchaseIntentDate: '',
  priority: 'medium',
  opinionQuestion: ''
};
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
  const [feelings, setFeelings] = useState([]);
  const [toBuyItems, setToBuyItems] = useState([]);
  const [activeTab, setActiveTab] = useState('wishlist');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [toBuyStatusFilter, setToBuyStatusFilter] = useState('all');
  const [toBuyCategoryFilter, setToBuyCategoryFilter] = useState('All');
  const [viewMode, setViewMode] = useState('list');
  const [calendarMonth, setCalendarMonth] = useState(startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState(toDateInputValue(new Date()));
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [date, setDate] = useState('');
  const [category, setCategory] = useState('movie');
  const [addMode, setAddMode] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [feelingText, setFeelingText] = useState('');
  const [toBuyDraft, setToBuyDraft] = useState(emptyToBuyDraft);
  const [editingToBuyItem, setEditingToBuyItem] = useState(null);
  const [opinionDrafts, setOpinionDrafts] = useState({});
  const [message, setMessage] = useState('');
  const [toast, setToast] = useState('');
  const [loading, setLoading] = useState(true);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isConnectOpen, setIsConnectOpen] = useState(false);
  const [isFriendsOpen, setIsFriendsOpen] = useState(false);
  const [isTourOpen, setIsTourOpen] = useState(false);
  const [isPrivacyOpen, setIsPrivacyOpen] = useState(false);
  const [isToBuyModalOpen, setIsToBuyModalOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState('');
  const pendingActionRef = useRef('');

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
  const visibleToBuyItems = toBuyItems
    .filter((item) => toBuyStatusFilter === 'all' || item.status === toBuyStatusFilter)
    .filter((item) => toBuyCategoryFilter === 'All' || item.category === toBuyCategoryFilter);

  function startPendingAction(action) {
    if (pendingActionRef.current) return false;

    pendingActionRef.current = action;
    setPendingAction(action);
    return true;
  }

  function finishPendingAction() {
    pendingActionRef.current = '';
    setPendingAction('');
  }

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

  async function loadFeelings(connectionId = activeConnectionId, currentUser = authUser) {
    if (!currentUser || !connectionId) {
      setFeelings([]);
      return;
    }

    const params = new URLSearchParams({ connectionId });
    const response = await fetch(apiPath(`/api/feelings?${params.toString()}`), {
      headers: await getAuthHeaders(currentUser)
    });

    if (!response.ok) throw await responseError(response, 'Could not load feelings');

    setFeelings(await response.json());
  }

  async function loadToBuyItems(connectionId = activeConnectionId, currentUser = authUser) {
    if (!currentUser || !connectionId) {
      setToBuyItems([]);
      return;
    }

    const params = new URLSearchParams({ connectionId });
    const response = await fetch(apiPath(`/api/to-buy?${params.toString()}`), {
      headers: await getAuthHeaders(currentUser)
    });

    if (!response.ok) throw await responseError(response, 'Could not load to-buy items');

    setToBuyItems(await response.json());
  }

  async function loadConnectionData(connectionId, currentUser = authUser) {
    await Promise.all([
      loadItems(connectionId, currentUser),
      loadFeelings(connectionId, currentUser),
      loadToBuyItems(connectionId, currentUser)
    ]);
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
        setFeelings([]);
        setToBuyItems([]);
        setActiveConnectionId('');
        setLoading(false);
        return;
      }

      try {
        await ensureUserDocument(currentUser);
        await loadProfile(currentUser);
        const nextConnections = await loadConnections(currentUser);
        const nextConnectionId = chooseActiveConnection(nextConnections);
        await loadConnectionData(nextConnectionId, currentUser);
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
    setFeelings([]);
    setToBuyItems([]);

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
    await loadConnectionData(connectionId);
  }

  async function shareFeeling(event) {
    event.preventDefault();

    if (!feelingText.trim() || !activeConnectionId) return;
    if (!startPendingAction('share-feeling')) return;

    try {
      const response = await fetch(apiPath('/api/feelings'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(await getAuthHeaders())
        },
        body: JSON.stringify({
          connectionId: activeConnectionId,
          text: feelingText
        })
      });

      if (!response.ok) {
        setMessage('Could not share feeling.');
        return;
      }

      setFeelingText('');
      setMessage('');
      setToast('Feeling shared');
      await loadFeelings();
    } finally {
      finishPendingAction();
    }
  }

  async function deleteFeeling(feelingId) {
    const response = await fetch(apiPath(`/api/feelings/${feelingId}`), {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        ...(await getAuthHeaders())
      },
      body: JSON.stringify({ connectionId: activeConnectionId })
    });

    if (!response.ok) {
      setMessage('Could not delete feeling.');
      return;
    }

    setToast('Feeling deleted');
    await loadFeelings();
  }

  function openToBuyModal(item = null) {
    setEditingToBuyItem(item);
    setToBuyDraft(
      item
        ? {
            title: item.title || '',
            description: item.description || '',
            amount: item.amount ?? '',
            productLink: item.productLink || '',
            category: item.category || 'Other',
            forUserId: item.forUserId || 'both',
            purchaseIntentDate: item.purchaseIntentDate || '',
            priority: item.priority || 'medium',
            opinionQuestion: item.opinionQuestion || ''
          }
        : emptyToBuyDraft
    );
    setIsToBuyModalOpen(true);
  }

  function closeToBuyModal() {
    setEditingToBuyItem(null);
    setToBuyDraft(emptyToBuyDraft);
    setIsToBuyModalOpen(false);
  }

  async function saveToBuyItem(event) {
    event.preventDefault();
    if (!toBuyDraft.title.trim() || !activeConnectionId) return;
    if (!startPendingAction('save-to-buy')) return;

    const path = editingToBuyItem ? `/api/to-buy/${editingToBuyItem.id}` : '/api/to-buy';
    try {
      const response = await fetch(apiPath(path), {
        method: editingToBuyItem ? 'PATCH' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(await getAuthHeaders())
        },
        body: JSON.stringify({
          ...toBuyDraft,
          connectionId: activeConnectionId,
          amount: toBuyDraft.amount === '' ? null : Number(toBuyDraft.amount),
          purchaseIntentDate: toBuyDraft.purchaseIntentDate || null
        })
      });

      if (!response.ok) {
        setMessage('Could not save to-buy item.');
        return;
      }

      closeToBuyModal();
      setToast(editingToBuyItem ? 'Item updated' : 'Item added');
      await loadToBuyItems();
    } finally {
      finishPendingAction();
    }
  }

  async function updateToBuyStatus(item, status) {
    const response = await fetch(apiPath(`/api/to-buy/${item.id}`), {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(await getAuthHeaders())
      },
      body: JSON.stringify({ connectionId: activeConnectionId, ...item, status })
    });

    if (!response.ok) {
      setMessage('Could not update to-buy item.');
      return;
    }

    setToast('Item updated');
    await loadToBuyItems();
  }

  async function deleteToBuyItem(itemId) {
    const response = await fetch(apiPath(`/api/to-buy/${itemId}`), {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        ...(await getAuthHeaders())
      },
      body: JSON.stringify({ connectionId: activeConnectionId })
    });

    if (!response.ok) {
      setMessage('Could not delete to-buy item.');
      return;
    }

    setToast('Item deleted');
    await loadToBuyItems();
  }

  async function sendToBuyOpinion(itemId) {
    const actionKey = `opinion-${itemId}`;
    const opinion = opinionDrafts[itemId] || '';
    if (!opinion.trim()) return;
    if (!startPendingAction(actionKey)) return;

    try {
      const response = await fetch(apiPath(`/api/to-buy/${itemId}/opinion`), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(await getAuthHeaders())
        },
        body: JSON.stringify({
          connectionId: activeConnectionId,
          partnerOpinion: opinion
        })
      });

      if (!response.ok) {
        setMessage('Could not send opinion.');
        return;
      }

      setOpinionDrafts((drafts) => ({ ...drafts, [itemId]: '' }));
      setToast('Opinion sent');
      await loadToBuyItems();
    } finally {
      finishPendingAction();
    }
  }

  async function addItem(event) {
    event.preventDefault();

    if (!title.trim() || !activeConnectionId) return;
    if (addMode === 'scheduled' && !date) return;
    if (!startPendingAction('add-item')) return;

    try {
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
          status: addMode === 'scheduled' ? 'scheduled' : 'wishlist',
          date: addMode === 'scheduled' ? date : null
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
      setAddMode('');
      setMessage('');
      setIsAddModalOpen(false);
      setToast('Item added');
      await loadItems();
    } finally {
      finishPendingAction();
    }
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
    if (!inviteCode.trim()) return;
    if (!startPendingAction('connect')) return;

    try {
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
      await loadConnectionData(nextConnectionId);
    } finally {
      finishPendingAction();
    }
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
        onOpenFriends={() => setIsFriendsOpen(true)}
        onOpenPrivacy={() => setIsPrivacyOpen(true)}
        onReplayTour={() => setIsTourOpen(true)}
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

        <section className="rounded-2xl bg-white/80 p-4 shadow-sm ring-1 ring-black/5 backdrop-blur">
          {activeConnection ? (
            <>
              <Tabs
                activeTab={activeTab}
                onChange={(tab) => {
                  setActiveTab(tab);
                  if (tab !== 'scheduled') setViewMode('list');
                }}
              />
              {activeTab !== 'feelings' && activeTab !== 'to-buy' ? (
                <CategoryFilter categoryFilter={categoryFilter} onChange={setCategoryFilter} />
              ) : null}
              {activeTab === 'scheduled' ? <ViewToggle onChange={setViewMode} viewMode={viewMode} /> : null}
              {activeTab === 'to-buy' ? (
                <ToBuyView
                  authUser={authUser}
                  categoryFilter={toBuyCategoryFilter}
                  connection={activeConnection}
                  items={visibleToBuyItems}
                  onAdd={() => openToBuyModal()}
                  onCategoryFilterChange={setToBuyCategoryFilter}
                  onDelete={deleteToBuyItem}
                  onEdit={openToBuyModal}
                  onOpinionChange={(itemId, value) => setOpinionDrafts((drafts) => ({ ...drafts, [itemId]: value }))}
                  onSendOpinion={sendToBuyOpinion}
                  onStatusChange={updateToBuyStatus}
                  opinionDrafts={opinionDrafts}
                  pendingAction={pendingAction}
                  statusFilter={toBuyStatusFilter}
                  onStatusFilterChange={setToBuyStatusFilter}
                />
              ) : activeTab === 'feelings' ? (
                <FeelingsView
                  authUser={authUser}
                  connection={activeConnection}
                  feelingText={feelingText}
                  feelings={feelings}
                  isSubmitting={pendingAction === 'share-feeling'}
                  onDelete={deleteFeeling}
                  onFeelingTextChange={setFeelingText}
                  onSubmit={shareFeeling}
                />
              ) : activeTab !== 'scheduled' || viewMode === 'list' ? (
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

      {activeConnection && activeTab !== 'feelings' && activeTab !== 'to-buy' ? (
        <button
          className="fixed bottom-5 right-5 grid h-14 w-14 place-items-center rounded-2xl bg-gray-950 text-3xl leading-none text-white shadow-md transition hover:-translate-y-0.5 hover:bg-gray-800 focus:outline-none focus:ring-4 focus:ring-pink-200"
          onClick={() => {
            setAddMode('');
            setDate('');
            setIsAddModalOpen(true);
          }}
          type="button"
        >
          +
        </button>
      ) : null}

      {isAddModalOpen ? (
        <AddItemModal
          addMode={addMode}
          activeTab={activeTabMeta}
          category={category}
          date={date}
          notes={notes}
          onCategoryChange={setCategory}
          onChooseMode={setAddMode}
          onClose={() => {
            setAddMode('');
            setIsAddModalOpen(false);
          }}
          onDateChange={setDate}
          onNotesChange={setNotes}
          onSubmit={addItem}
          isSubmitting={pendingAction === 'add-item'}
          onTitleChange={setTitle}
          title={title}
        />
      ) : null}

      {isToBuyModalOpen ? (
        <ToBuyModal
          authUser={authUser}
          connection={activeConnection}
          draft={toBuyDraft}
          isEditing={Boolean(editingToBuyItem)}
          isSubmitting={pendingAction === 'save-to-buy'}
          onChange={(field, value) => setToBuyDraft((draft) => ({ ...draft, [field]: value }))}
          onClose={closeToBuyModal}
          onSubmit={saveToBuyItem}
        />
      ) : null}

      {isConnectOpen || connections.length === 0 ? (
        <ConnectionPanel
          inviteCode={inviteCode}
          message={message}
          isSubmitting={pendingAction === 'connect'}
          onClose={() => setIsConnectOpen(false)}
          onConnect={connectPartner}
          onInviteCodeChange={setInviteCode}
          userCode={profile?.inviteCode}
        />
      ) : null}

      {isFriendsOpen ? (
        <FriendsModal
          activeConnectionId={activeConnectionId}
          connections={connections}
          onAddConnection={() => {
            setIsFriendsOpen(false);
            setIsConnectOpen(true);
          }}
          onClose={() => setIsFriendsOpen(false)}
          onSwitch={async (connectionId) => {
            await switchConnection(connectionId);
            setIsFriendsOpen(false);
          }}
        />
      ) : null}

      {isTourOpen ? <TourModal onClose={() => setIsTourOpen(false)} /> : null}
      {isPrivacyOpen ? <PrivacyPolicyModal onClose={() => setIsPrivacyOpen(false)} /> : null}

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

function formatDateTime(dateString) {
  if (!dateString) return 'Not used yet';

  return new Date(dateString).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

function relativeTime(dateString) {
  if (!dateString) return 'just now';

  const diffSeconds = Math.max(0, Math.floor((Date.now() - new Date(dateString).getTime()) / 1000));
  const units = [
    ['year', 31536000],
    ['month', 2592000],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60]
  ];
  const nextUnit = units.find(([, seconds]) => diffSeconds >= seconds);

  if (!nextUnit) return 'just now';

  const [label, seconds] = nextUnit;
  const value = Math.floor(diffSeconds / seconds);
  return `${value} ${label}${value === 1 ? '' : 's'} ago`;
}

function formatInr(amount) {
  if (amount === null || amount === undefined || amount === '') return '';

  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0
  }).format(Number(amount));
}

function toBuyForLabel(item, authUser, connection) {
  if (item.forUserId === 'both') return 'Both';
  if (item.forUserId === authUser.uid) return 'Me';
  if (item.forUserId === connection?.partnerId) return 'Partner';
  return 'Both';
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
        <p className="text-sm font-medium text-gray-600">Loading CONNECTED...</p>
      </div>
    </main>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  );
}

function ButtonContent({ isLoading, children, loadingText = 'Saving...' }) {
  return (
    <span className="inline-flex items-center justify-center gap-2">
      {isLoading ? <Spinner /> : null}
      {isLoading ? loadingText : children}
    </span>
  );
}

function TopNav({
  activeConnection,
  authUser,
  connections,
  onAddConnection,
  onOpenFriends,
  onOpenPrivacy,
  onReplayTour,
  onSignOut,
  onSwitchConnection,
  profile
}) {
  const avatarUrl = authUser.photoURL;
  const name = profile?.name || authUser.displayName || 'You';
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    function handlePointerDown(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setIsMenuOpen(false);
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, []);

  function handleMenuAction(action) {
    setIsMenuOpen(false);
    action();
  }

  return (
    <nav className="sticky top-0 z-20 border-b border-black/5 bg-[#f7f3ef]/90 backdrop-blur">
      <div className="mx-auto flex max-w-3xl flex-col gap-3 px-4 py-3 sm:px-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xl font-semibold tracking-tight">CONNECTED</p>
            <p className="text-sm text-gray-600">Shared plans, one simple place</p>
          </div>
          <div className="relative" ref={menuRef}>
            <button
              className="flex items-center gap-2 rounded-2xl border border-gray-200 bg-white px-2 py-2 text-sm font-semibold text-gray-700 shadow-sm transition hover:border-gray-300 hover:bg-gray-50"
              aria-expanded={isMenuOpen}
              aria-label="Open account menu"
              onClick={() => setIsMenuOpen((isOpen) => !isOpen)}
              type="button"
            >
              {avatarUrl ? (
                <img alt={name} className="h-9 w-9 rounded-full object-cover ring-2 ring-white" src={avatarUrl} />
              ) : (
                <span className="grid h-9 w-9 place-items-center rounded-full bg-pink-100 text-sm font-semibold text-pink-700">
                  {name.charAt(0)}
                </span>
              )}
              <span className="hidden max-w-28 truncate sm:block">{firstName(name)}</span>
              <svg
                aria-hidden="true"
                className={`h-4 w-4 text-gray-400 transition-transform ${isMenuOpen ? 'rotate-180' : ''}`}
                fill="none"
                viewBox="0 0 24 24"
              >
                <path d="m6 9 6 6 6-6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
              </svg>
            </button>
            {isMenuOpen ? (
              <div className="absolute right-0 mt-2 w-56 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-md ring-1 ring-black/5">
                <MenuButton label="Friends List" onClick={() => handleMenuAction(onOpenFriends)} />
                <MenuButton label="Replay Tour" onClick={() => handleMenuAction(onReplayTour)} />
                <MenuButton label="Privacy Policy" onClick={() => handleMenuAction(onOpenPrivacy)} />
                <div className="border-t border-gray-100" />
                <MenuButton label="Logout" onClick={() => handleMenuAction(onSignOut)} tone="danger" />
              </div>
            ) : null}
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

function MenuButton({ label, onClick, tone = 'default' }) {
  return (
    <button
      className={`block w-full px-4 py-3 text-left text-sm font-semibold transition ${
        tone === 'danger' ? 'text-red-600 hover:bg-red-50' : 'text-gray-700 hover:bg-gray-50'
      }`}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
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

function ConnectionPanel({ inviteCode, isSubmitting, message, onClose, onConnect, onInviteCodeChange, userCode }) {
  const [copyStatus, setCopyStatus] = useState('');

  async function copyInviteCode() {
    if (!userCode) return;

    try {
      await navigator.clipboard.writeText(userCode);
      setCopyStatus('copied');
      window.setTimeout(() => setCopyStatus(''), 1800);
    } catch {
      setCopyStatus('failed');
      window.setTimeout(() => setCopyStatus(''), 2200);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-gray-950/40 px-4 backdrop-blur-sm">
      <section className="w-full max-w-md rounded-2xl bg-white p-5 shadow-md">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">Add Connection</h2>
            <p className="mt-1 text-sm text-gray-600">Share your invite code or enter theirs once.</p>
          </div>
          <button
            aria-label="Close add connection"
            className="rounded-xl border border-gray-200 px-3 py-1 text-sm font-semibold text-gray-600 hover:bg-gray-50"
            onClick={onClose}
            type="button"
          >
            X
          </button>
        </div>

        <div className="mt-5 rounded-2xl bg-pink-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-pink-700">Your Invite Code</p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
            <p className="min-w-0 flex-1 rounded-xl bg-white px-3 py-3 font-mono text-xl font-semibold tracking-wide text-gray-950">
              {userCode || '...'}
            </p>
            <button
              className="rounded-xl bg-gray-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-300"
              disabled={!userCode}
              onClick={copyInviteCode}
              type="button"
            >
              {copyStatus === 'copied' ? 'Copied!' : 'Copy'}
            </button>
          </div>
          {copyStatus === 'failed' ? (
            <p className="mt-2 text-sm font-medium text-red-600">Could not copy. Select the code manually.</p>
          ) : null}
        </div>

        <form className="mt-5 grid gap-3" onSubmit={onConnect}>
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
            className="rounded-xl bg-pink-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-pink-700 disabled:cursor-not-allowed disabled:bg-gray-300"
            disabled={isSubmitting || !inviteCode.trim()}
            type="submit"
          >
            <ButtonContent isLoading={isSubmitting} loadingText="Connecting...">
              Connect
            </ButtonContent>
          </button>
          <button
            className="rounded-xl border border-gray-200 px-4 py-3 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
        </form>
        {message ? <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">{message}</p> : null}
      </section>
    </div>
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

function ToBuyView({
  authUser,
  categoryFilter,
  connection,
  items,
  onAdd,
  onCategoryFilterChange,
  onDelete,
  onEdit,
  onOpinionChange,
  onSendOpinion,
  onStatusChange,
  opinionDrafts,
  pendingAction,
  statusFilter,
  onStatusFilterChange
}) {
  return (
    <div className="mt-4 grid gap-4">
      <div className="flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold">To Buy</h2>
          <p className="mt-1 text-sm text-gray-600">Plan purchases together and get opinions</p>
        </div>
        <button
          className="rounded-xl bg-gray-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-gray-800"
          onClick={onAdd}
          type="button"
        >
          + Add Item
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-2 text-sm font-semibold text-gray-700">
          Status
          <select
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-pink-400 focus:ring-4 focus:ring-pink-100"
            onChange={(event) => onStatusFilterChange(event.target.value)}
            value={statusFilter}
          >
            {toBuyStatuses.map((status) => (
              <option key={status} value={status}>
                {status === 'all' ? 'All' : statusLabel(status)}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-2 text-sm font-semibold text-gray-700">
          Category
          <select
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-pink-400 focus:ring-4 focus:ring-pink-100"
            onChange={(event) => onCategoryFilterChange(event.target.value)}
            value={categoryFilter}
          >
            {['All', ...toBuyCategories].map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </label>
      </div>

      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-6 py-12 text-center">
          <p className="text-4xl">🛒</p>
          <h2 className="mt-3 text-xl font-semibold text-gray-950">No items yet</h2>
          <p className="mt-1 text-sm text-gray-600">Add something you’re thinking of buying.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {items.map((item) => (
            <ToBuyCard
              authUser={authUser}
              connection={connection}
              item={item}
              key={item.id}
              onDelete={onDelete}
              onEdit={onEdit}
              onOpinionChange={onOpinionChange}
              onSendOpinion={onSendOpinion}
              onStatusChange={onStatusChange}
              opinionValue={opinionDrafts[item.id] ?? item.partnerOpinion ?? ''}
              pendingAction={pendingAction}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ToBuyCard({
  authUser,
  connection,
  item,
  onDelete,
  onEdit,
  onOpinionChange,
  onSendOpinion,
  onStatusChange,
  opinionValue,
  pendingAction
}) {
  const isCreator = item.addedByUserId === authUser.uid;
  const addedBy = isCreator ? 'You' : connection?.partnerName || 'Partner';
  const opinionBy = item.partnerOpinionByUserId === authUser.uid ? 'You' : connection?.partnerName || 'Partner';
  const isSendingOpinion = pendingAction === `opinion-${item.id}`;

  return (
    <article className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-xl font-semibold text-gray-950">{item.title}</h3>
          {item.description ? <p className="mt-1 text-sm text-gray-600">{item.description}</p> : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {item.amount !== null && item.amount !== undefined ? <Badge>{formatInr(item.amount)}</Badge> : null}
            <Badge>{item.category || 'Other'}</Badge>
            <Badge tone={priorityTone(item.priority)}>{statusLabel(item.priority || 'medium')}</Badge>
            <Badge tone={statusTone(item.status)}>{statusLabel(item.status || 'thinking')}</Badge>
          </div>
        </div>
        {item.productLink ? (
          <a
            className="rounded-xl border border-gray-200 px-3 py-2 text-center text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
            href={item.productLink}
            rel="noreferrer"
            target="_blank"
          >
            Open Link
          </a>
        ) : null}
      </div>

      <div className="mt-4 grid gap-2 border-t border-gray-100 pt-4 text-sm text-gray-500 sm:grid-cols-2">
        <p>For: {toBuyForLabel(item, authUser, connection)}</p>
        <p>Added by {addedBy}</p>
        {item.purchaseIntentDate ? <p>Thinking of buying: {formatReadableDate(item.purchaseIntentDate)}</p> : null}
        {item.opinionQuestion ? <p className="sm:col-span-2">Question: {item.opinionQuestion}</p> : null}
      </div>

      <div className="mt-4 rounded-2xl bg-gray-50 p-4">
        <p className="text-sm font-semibold text-gray-700">Opinion</p>
        {isCreator ? (
          item.partnerOpinion ? (
            <p className="mt-2 text-sm text-gray-700">
              {item.partnerOpinion} <span className="text-gray-400">- {opinionBy}</span>
            </p>
          ) : (
            <p className="mt-2 text-sm text-gray-500">Waiting for opinion…</p>
          )
        ) : (
          <div className="mt-3 grid gap-2">
            <textarea
              className="min-h-20 rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm outline-none transition focus:border-pink-400 focus:ring-4 focus:ring-pink-100"
              onChange={(event) => onOpinionChange(item.id, event.target.value)}
              placeholder="Share your opinion"
              value={opinionValue}
            />
            <button
              className="justify-self-start rounded-xl bg-pink-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-pink-700 disabled:cursor-not-allowed disabled:bg-gray-300"
              disabled={isSendingOpinion || !opinionValue.trim()}
              onClick={() => onSendOpinion(item.id)}
              type="button"
            >
              <ButtonContent isLoading={isSendingOpinion} loadingText="Sending...">
                Send Opinion
              </ButtonContent>
            </button>
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50" onClick={() => onEdit(item)} type="button">
          Edit
        </button>
        <button className="rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700" onClick={() => onStatusChange(item, 'bought')} type="button">
          Mark as Bought
        </button>
        <button className="rounded-xl border border-emerald-100 px-3 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50" onClick={() => onStatusChange(item, 'approved')} type="button">
          Approve
        </button>
        <button className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50" onClick={() => onStatusChange(item, 'dropped')} type="button">
          Drop item
        </button>
        {isCreator ? (
          <button className="rounded-xl border border-red-100 px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50" onClick={() => onDelete(item.id)} type="button">
            Delete
          </button>
        ) : null}
      </div>
    </article>
  );
}

function Badge({ children, tone = 'gray' }) {
  const tones = {
    gray: 'bg-gray-100 text-gray-700',
    green: 'bg-emerald-100 text-emerald-700',
    blue: 'bg-blue-100 text-blue-700',
    amber: 'bg-amber-100 text-amber-700',
    red: 'bg-red-100 text-red-700',
    pink: 'bg-pink-100 text-pink-700'
  };

  return <span className={`rounded-full px-3 py-1 text-xs font-semibold ${tones[tone] || tones.gray}`}>{children}</span>;
}

function statusLabel(value) {
  return String(value || '').replace(/^\w/, (letter) => letter.toUpperCase());
}

function statusTone(status) {
  return {
    approved: 'green',
    bought: 'blue',
    dropped: 'red',
    thinking: 'amber'
  }[status] || 'gray';
}

function priorityTone(priority) {
  return {
    high: 'red',
    medium: 'amber',
    low: 'green'
  }[priority] || 'gray';
}

function FeelingsView({ authUser, connection, feelingText, feelings, isSubmitting, onDelete, onFeelingTextChange, onSubmit }) {
  return (
    <div className="mt-4 grid gap-4">
      <form className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5" onSubmit={onSubmit}>
        <label className="grid gap-2">
          <span className="text-sm font-semibold text-gray-700">Share a feeling</span>
          <textarea
            className="min-h-28 rounded-xl border border-gray-200 px-3 py-3 text-sm outline-none transition focus:border-pink-400 focus:ring-4 focus:ring-pink-100"
            onChange={(event) => onFeelingTextChange(event.target.value)}
            placeholder="What are you feeling?"
            value={feelingText}
          />
        </label>
        <div className="mt-3 flex justify-end">
          <button
            className="rounded-xl bg-pink-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-pink-700 disabled:cursor-not-allowed disabled:bg-gray-300"
            disabled={isSubmitting || !feelingText.trim()}
            type="submit"
          >
            <ButtonContent isLoading={isSubmitting} loadingText="Sharing...">
              Share
            </ButtonContent>
          </button>
        </div>
      </form>

      {feelings.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-6 py-12 text-center">
          <p className="text-4xl">💌</p>
          <h2 className="mt-3 text-xl font-semibold text-gray-950">No feelings shared yet</h2>
          <p className="mt-1 text-sm text-gray-600">Write a small note when you want to be understood.</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {feelings.map((feeling) => (
            <FeelingCard
              authUser={authUser}
              connection={connection}
              feeling={feeling}
              key={feeling.id}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FeelingCard({ authUser, connection, feeling, onDelete }) {
  const isOwn = feeling.userId === authUser.uid;
  const addedBy = isOwn ? 'You' : connection?.partnerName || 'Partner';

  return (
    <article className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
      <p className="whitespace-pre-wrap text-sm leading-6 text-gray-800">{feeling.text}</p>
      <div className="mt-4 flex flex-col gap-3 border-t border-gray-100 pt-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-gray-500">
          Added by {addedBy} - {relativeTime(feeling.createdAt)}
        </p>
        {isOwn ? (
          <button
            className="self-start rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 sm:self-auto"
            onClick={() => onDelete(feeling.id)}
            type="button"
          >
            Delete
          </button>
        ) : null}
      </div>
    </article>
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
  addMode,
  activeTab,
  category,
  date,
  notes,
  onCategoryChange,
  onChooseMode,
  onClose,
  onDateChange,
  onNotesChange,
  onSubmit,
  isSubmitting,
  onTitleChange,
  title
}) {
  const tab = activeTab || tabs[0];
  const modeLabel = addMode === 'scheduled' ? 'scheduled' : tab.label.toLowerCase();

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-gray-950/40 px-4 backdrop-blur-sm">
      <section className="w-full max-w-md rounded-2xl bg-white p-5 shadow-md">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">Add Item</h2>
            <p className="mt-1 text-sm text-gray-600">
              Choose where this item belongs, then add the details.
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

        {!addMode ? (
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <button
              className="rounded-2xl border border-pink-100 bg-pink-50 p-4 text-left transition hover:-translate-y-0.5 hover:bg-pink-100"
              onClick={() => onChooseMode('wishlist')}
              type="button"
            >
              <span className="text-sm font-semibold text-pink-700">Add to Wishlist</span>
              <span className="mt-1 block text-sm text-gray-600">Save an idea without picking a date.</span>
            </button>
            <button
              className="rounded-2xl border border-blue-100 bg-blue-50 p-4 text-left transition hover:-translate-y-0.5 hover:bg-blue-100"
              onClick={() => onChooseMode('scheduled')}
              type="button"
            >
              <span className="text-sm font-semibold text-blue-700">Schedule Item</span>
              <span className="mt-1 block text-sm text-gray-600">Add it directly to the calendar.</span>
            </button>
          </div>
        ) : (
          <form className="mt-5 grid gap-4" onSubmit={onSubmit}>
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-gray-700">Title</span>
            <input
              autoFocus
              className="rounded-xl border border-gray-200 px-3 py-3 text-sm outline-none transition focus:border-pink-400 focus:ring-4 focus:ring-pink-100"
              onChange={(event) => onTitleChange(event.target.value)}
              placeholder={`Add ${modeLabel} item`}
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

          {addMode === 'scheduled' ? (
            <label className="grid gap-2">
              <span className="text-sm font-semibold text-gray-700">Date</span>
              <input
                className="rounded-xl border border-gray-200 px-3 py-3 text-sm outline-none transition focus:border-pink-400 focus:ring-4 focus:ring-pink-100"
                onChange={(event) => onDateChange(event.target.value)}
                required
                type="date"
                value={date}
              />
            </label>
          ) : null}

          <label className="grid gap-2">
            <span className="text-sm font-semibold text-gray-700">Notes</span>
            <textarea
              className="min-h-24 rounded-xl border border-gray-200 px-3 py-3 text-sm outline-none transition focus:border-pink-400 focus:ring-4 focus:ring-pink-100"
              onChange={(event) => onNotesChange(event.target.value)}
              placeholder="Optional"
              value={notes}
            />
          </label>

          <div className="flex flex-col gap-2 pt-1 sm:flex-row">
            <button
              className="flex-1 rounded-xl bg-gray-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-300"
              disabled={isSubmitting}
              type="submit"
            >
              <ButtonContent isLoading={isSubmitting} loadingText="Adding...">
                {addMode === 'scheduled' ? 'Schedule Item' : 'Add to Wishlist'}
              </ButtonContent>
            </button>
            <button
              className="rounded-xl border border-gray-200 px-4 py-3 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
              onClick={() => onChooseMode('')}
              type="button"
            >
              Back
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
        )}
      </section>
    </div>
  );
}

function ToBuyModal({ authUser, connection, draft, isEditing, isSubmitting, onChange, onClose, onSubmit }) {
  const forOptions = [
    { label: 'Me', value: authUser.uid },
    { label: 'Partner', value: connection?.partnerId || '' },
    { label: 'Both', value: 'both' }
  ].filter((option) => option.value);

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-gray-950/40 px-4 backdrop-blur-sm">
      <section className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-2xl bg-white p-5 shadow-md">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">{isEditing ? 'Edit Item' : 'Add Item'}</h2>
            <p className="mt-1 text-sm text-gray-600">Plan purchases together and get opinions.</p>
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
              className="rounded-xl border border-gray-200 px-3 py-3 text-sm outline-none transition focus:border-pink-400 focus:ring-4 focus:ring-pink-100"
              onChange={(event) => onChange('title', event.target.value)}
              required
              value={draft.title}
            />
          </label>

          <label className="grid gap-2">
            <span className="text-sm font-semibold text-gray-700">Description</span>
            <textarea
              className="min-h-20 rounded-xl border border-gray-200 px-3 py-3 text-sm outline-none transition focus:border-pink-400 focus:ring-4 focus:ring-pink-100"
              onChange={(event) => onChange('description', event.target.value)}
              value={draft.description}
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-2">
              <span className="text-sm font-semibold text-gray-700">Amount</span>
              <input
                className="rounded-xl border border-gray-200 px-3 py-3 text-sm outline-none transition focus:border-pink-400 focus:ring-4 focus:ring-pink-100"
                min="0"
                onChange={(event) => onChange('amount', event.target.value)}
                placeholder="₹"
                type="number"
                value={draft.amount}
              />
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-semibold text-gray-700">Category</span>
              <select
                className="rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm outline-none transition focus:border-pink-400 focus:ring-4 focus:ring-pink-100"
                onChange={(event) => onChange('category', event.target.value)}
                value={draft.category}
              >
                {toBuyCategories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="grid gap-2">
            <span className="text-sm font-semibold text-gray-700">Product Link</span>
            <input
              className="rounded-xl border border-gray-200 px-3 py-3 text-sm outline-none transition focus:border-pink-400 focus:ring-4 focus:ring-pink-100"
              onChange={(event) => onChange('productLink', event.target.value)}
              placeholder="https://"
              type="url"
              value={draft.productLink}
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-2">
              <span className="text-sm font-semibold text-gray-700">Who is it for?</span>
              <select
                className="rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm outline-none transition focus:border-pink-400 focus:ring-4 focus:ring-pink-100"
                onChange={(event) => onChange('forUserId', event.target.value)}
                value={draft.forUserId}
              >
                {forOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-semibold text-gray-700">Thinking of buying on</span>
              <input
                className="rounded-xl border border-gray-200 px-3 py-3 text-sm outline-none transition focus:border-pink-400 focus:ring-4 focus:ring-pink-100"
                onChange={(event) => onChange('purchaseIntentDate', event.target.value)}
                type="date"
                value={draft.purchaseIntentDate}
              />
            </label>
          </div>

          <label className="grid gap-2">
            <span className="text-sm font-semibold text-gray-700">Priority</span>
            <select
              className="rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm outline-none transition focus:border-pink-400 focus:ring-4 focus:ring-pink-100"
              onChange={(event) => onChange('priority', event.target.value)}
              value={draft.priority}
            >
              {toBuyPriorities.map((priority) => (
                <option key={priority} value={priority}>
                  {statusLabel(priority)}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-2">
            <span className="text-sm font-semibold text-gray-700">Opinion question</span>
            <textarea
              className="min-h-20 rounded-xl border border-gray-200 px-3 py-3 text-sm outline-none transition focus:border-pink-400 focus:ring-4 focus:ring-pink-100"
              onChange={(event) => onChange('opinionQuestion', event.target.value)}
              placeholder="What do you think about this?"
              value={draft.opinionQuestion}
            />
          </label>

          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              className="flex-1 rounded-xl bg-gray-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-300"
              disabled={isSubmitting}
              type="submit"
            >
              <ButtonContent isLoading={isSubmitting} loadingText="Saving...">
                {isEditing ? 'Save Changes' : 'Add Item'}
              </ButtonContent>
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

function ModalShell({ children, onClose, title }) {
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-gray-950/40 px-4 backdrop-blur-sm">
      <section className="max-h-[85vh] w-full max-w-lg overflow-auto rounded-2xl bg-white p-5 shadow-md">
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-xl font-semibold">{title}</h2>
          <button
            className="rounded-xl border border-gray-200 px-3 py-1 text-sm font-semibold text-gray-600 hover:bg-gray-50"
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

function FriendsModal({ activeConnectionId, connections, onAddConnection, onClose, onSwitch }) {
  return (
    <ModalShell onClose={onClose} title="Friends List">
      {connections.length === 0 ? (
        <div className="mt-5 rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-5 py-8 text-center">
          <p className="text-sm text-gray-600">No friends connected yet. Add someone using an invite code.</p>
          <button
            className="mt-4 rounded-xl bg-pink-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-pink-700"
            onClick={onAddConnection}
            type="button"
          >
            Add new connection
          </button>
        </div>
      ) : (
        <div className="mt-5 grid gap-3">
          {connections.map((connection) => {
            const isActive = connection.connectionId === activeConnectionId;

            return (
              <article
                className={`rounded-2xl border p-4 transition ${
                  isActive ? 'border-pink-200 bg-pink-50' : 'border-gray-100 bg-white hover:bg-gray-50'
                }`}
                key={connection.connectionId}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-gray-950">{connection.partnerName}</h3>
                      {isActive ? (
                        <span className="rounded-full bg-gray-950 px-2 py-1 text-xs font-semibold text-white">Active</span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm text-gray-600">
                      Last used {formatDateTime(connection.lastUsedAt || connection.lastActiveAt)}
                    </p>
                  </div>
                  <button
                    className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                      isActive
                        ? 'border border-pink-200 bg-white text-pink-700'
                        : 'bg-gray-950 text-white hover:bg-gray-800'
                    }`}
                    disabled={isActive}
                    onClick={() => onSwitch(connection.connectionId)}
                    type="button"
                  >
                    {isActive ? 'Current' : 'Switch'}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </ModalShell>
  );
}

function TourModal({ onClose }) {
  return (
    <ModalShell onClose={onClose} title="Welcome to CONNECTED">
      <div className="mt-5 grid gap-3">
        {[
          ['Connect', 'Share your invite code or enter someone else’s code to create a shared space.'],
          ['Plan', 'Add ideas to Wishlist, or schedule plans with a date.'],
          ['Switch', 'Use Friends List to move between different people without re-entering codes.']
        ].map(([heading, text]) => (
          <div className="rounded-2xl bg-gray-50 p-4" key={heading}>
            <p className="font-semibold text-gray-950">{heading}</p>
            <p className="mt-1 text-sm text-gray-600">{text}</p>
          </div>
        ))}
      </div>
      <button
        className="mt-5 w-full rounded-xl bg-gray-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-gray-800"
        onClick={onClose}
        type="button"
      >
        Got it
      </button>
    </ModalShell>
  );
}

function PrivacyPolicyModal({ onClose }) {
  return (
    <ModalShell onClose={onClose} title="Privacy Policy">
      <div className="mt-5 grid gap-4 text-sm text-gray-600">
        <p>
          CONNECTED uses Firebase Authentication to sign you in and Firestore to store your profile, connections, and
          shared items.
        </p>
        <p>
          Your wishlist and scheduled items are only requested by the app for the active connection you select. The app
          does not sell personal data or include ads.
        </p>
        <p>
          Avoid adding sensitive information to item titles or notes. You can remove items from the app at any time.
        </p>
      </div>
    </ModalShell>
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
        <p className="text-sm font-semibold uppercase tracking-wide text-pink-600">CONNECTED</p>
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
        <p className="text-sm font-semibold uppercase tracking-wide text-pink-600">CONNECTED</p>
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
