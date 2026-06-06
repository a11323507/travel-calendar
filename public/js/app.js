/* ==========================================================================
   APP STATE & INITIALIZATION
   ========================================================================== */

const state = {
  trips: [],
  currentTrip: null,
  selectedDayNum: 1,
  activeTab: 'tab-itinerary',
  socket: null,
  recommendations: [],
  selectedRecCategory: '全部',
  restaurants: [],
  selectedRestCategory: '全部'
};

document.addEventListener('DOMContentLoaded', () => {
  initApp();
});

function initApp() {
  // Theme Toggle
  const themeBtn = document.getElementById('theme-toggle-btn');
  themeBtn.addEventListener('click', toggleTheme);

  // Initialize view navigation
  setupNavigation();

  // Load Trips list
  fetchTrips();

  // Modal close buttons setup
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => {
      closeModal(btn.getAttribute('data-close'));
    });
  });

  // Modal forms submit setup
  document.getElementById('new-trip-form').addEventListener('submit', handleNewTripSubmit);
  document.getElementById('schedule-item-form').addEventListener('submit', handleScheduleSubmit);
  
  // Dashboard triggers
  document.getElementById('new-trip-trigger').addEventListener('click', () => openModal('new-trip-modal'));

  // Itinerary UI
  document.getElementById('add-schedule-trigger').addEventListener('click', () => openScheduleModalForAdd());
  
  // Edit Trip triggers
  document.getElementById('edit-trip-trigger').addEventListener('click', openEditTripModal);
  document.getElementById('edit-trip-form').addEventListener('submit', handleEditTripSubmit);

  // Budget Tracker
  document.getElementById('save-budget-limit-btn').addEventListener('click', handleSaveBudgetLimit);

  // Checklist
  document.getElementById('checklist-add-btn').addEventListener('click', handleAddChecklist);
  document.getElementById('checklist-new-text').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleAddChecklist();
  });

  // Connect WebSockets for collaboration
  connectWebSocket();

  // Spot Map Search Sidebar listeners
  const spotSearchBtn = document.getElementById('spot-search-btn');
  if (spotSearchBtn) {
    spotSearchBtn.addEventListener('click', handleSpotSearch);
  }
  const spotSearchInput = document.getElementById('spot-search-input');
  if (spotSearchInput) {
    spotSearchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') handleSpotSearch();
    });
  }

  // Initialize sidebar subtabs, recommendations, and restaurants
  setupSidebarTabs();
  

}

// Toggle light/dark theme
function toggleTheme() {
  const body = document.body;
  const icon = document.querySelector('#theme-toggle-btn i');
  
  if (body.classList.contains('dark-theme')) {
    body.classList.replace('dark-theme', 'light-theme');
    icon.classList.replace('fa-moon', 'fa-sun');
  } else {
    body.classList.replace('light-theme', 'dark-theme');
    icon.classList.replace('fa-sun', 'fa-moon');
  }
}

// Setup view switching
function setupNavigation() {
  // Back to Dashboard
  document.getElementById('back-to-dashboard-btn').addEventListener('click', () => {
    switchView('dashboard-view');
    state.currentTrip = null;
  });

  // Delete Trip
  document.getElementById('delete-trip-btn').addEventListener('click', () => {
    if (confirm(`確定要刪除旅行計畫「${state.currentTrip.name}」嗎？此動作無法復原。`)) {
      deleteTrip(state.currentTrip.id);
    }
  });

  // Tab Panes switches
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      const targetTab = e.currentTarget.getAttribute('data-target');
      
      // Update active nav-tab styling
      document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
      e.currentTarget.classList.add('active');

      // Update active tab pane display
      document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));
      document.getElementById(targetTab).classList.add('active');

      state.activeTab = targetTab;
    });
  });
}

// Switch between dashboard-view and trip-detail-view
function switchView(viewId) {
  document.querySelectorAll('.app-view').forEach(view => {
    view.classList.remove('active');
  });
  document.getElementById(viewId).classList.add('active');
}

/* ==========================================================================
   API FETCH OPERATIONS (BACKEND CONNECTION)
   ========================================================================== */

async function fetchTrips() {
  try {
    const res = await fetch('/api/trips', { cache: 'no-store' });
    const data = await res.json();
    state.trips = data;
    renderTripsGrid();
  } catch (err) {
    console.error('Error fetching trips:', err);
  }
}

async function createTrip(tripData) {
  try {
    const res = await fetch('/api/trips', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tripData)
    });
    const newTrip = await res.json();
    closeModal('new-trip-modal');
    // Clear form
    document.getElementById('new-trip-form').reset();
    
    // Refresh trips and open the newly created trip details
    await fetchTrips();
    openTripDetail(newTrip.id);
  } catch (err) {
    console.error('Error creating trip:', err);
  }
}

async function updateTripOnServer() {
  if (!state.currentTrip) return;
  try {
    const res = await fetch(`/api/trips/${state.currentTrip.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state.currentTrip)
    });
    const updated = await res.json();
    state.currentTrip = updated;
    
    // Update local copy in state.trips list
    const idx = state.trips.findIndex(t => t.id === updated.id);
    if (idx !== -1) state.trips[idx] = updated;

    // Broadcast change to other players
    if (state.socket && state.socket.readyState === WebSocket.OPEN) {
      state.socket.send(JSON.stringify({
        type: 'trip_updated',
        tripId: state.currentTrip.id
      }));
    }

    // Refresh active components
    renderDayTabs();
    renderTimeline();
    renderBudgetTab();
    renderChecklistTab();
    updateSidebarBudgetCard();
  } catch (err) {
    console.error('Error updating trip on server:', err);
  }
}

async function deleteTrip(id) {
  try {
    await fetch(`/api/trips/${id}`, { method: 'DELETE' });

    // Broadcast deletion to other players
    if (state.socket && state.socket.readyState === WebSocket.OPEN) {
      state.socket.send(JSON.stringify({
        type: 'trip_deleted',
        tripId: id
      }));
    }

    switchView('dashboard-view');
    state.currentTrip = null;
    fetchTrips();
  } catch (err) {
    console.error('Error deleting trip:', err);
  }
}

/* ==========================================================================
   RENDERERS: DASHBOARD & TRIP CARDS
   ========================================================================== */

function renderTripsGrid() {
  const container = document.getElementById('trips-grid-container');
  const emptyState = document.getElementById('trips-empty-state');
  const badge = document.getElementById('trip-count-badge');

  container.innerHTML = '';
  badge.textContent = `${state.trips.length} 個計畫`;

  if (state.trips.length === 0) {
    emptyState.style.display = 'flex';
    container.style.display = 'none';
    return;
  }

  emptyState.style.display = 'none';
  container.style.display = 'grid';

  state.trips.forEach(trip => {
    // Count total items
    let totalItems = 0;
    trip.days.forEach(d => totalItems += d.items.length);

    const card = document.createElement('div');
    card.className = 'trip-card';
    card.addEventListener('click', () => openTripDetail(trip.id));

    card.innerHTML = `
      <div class="trip-card-image">
        <img src="${trip.coverImage}" alt="${trip.name}">
        <div class="trip-card-overlay"></div>
        <div class="trip-card-dates">
          <i class="fa-regular fa-calendar-days"></i> ${formatDates(trip.startDate, trip.endDate)}
        </div>
      </div>
      <div class="trip-card-content">
        <h3>${trip.name}</h3>
        <p>${trip.desc || '無備註說明'}</p>
        <div class="trip-card-footer">
          <span><i class="fa-solid fa-route"></i> ${trip.days.length} 天行程</span>
          <span><i class="fa-solid fa-location-dot"></i> ${totalItems} 個景點</span>
        </div>
      </div>
    `;

    container.appendChild(card);
  });
}

function handleNewTripSubmit(e) {
  e.preventDefault();
  const name = document.getElementById('trip-name-input').value;
  const startDate = document.getElementById('trip-start-input').value;
  const endDate = document.getElementById('trip-end-input').value;
  const totalBudget = document.getElementById('trip-budget-input').value;
  const coverImage = document.getElementById('trip-cover-input').value;
  const desc = document.getElementById('trip-desc-input').value;
  const city = document.getElementById('trip-city-input').value.trim();

  if (new Date(startDate) > new Date(endDate)) {
    alert('開始日期不能晚於結束日期！');
    return;
  }

  createTrip({ name, startDate, endDate, totalBudget, coverImage, desc, city });
}

function openEditTripModal() {
  if (!state.currentTrip) return;
  
  document.getElementById('edit-trip-name-input').value = state.currentTrip.name;
  document.getElementById('edit-trip-city-input').value = state.currentTrip.city || '';
  document.getElementById('edit-trip-budget-input').value = state.currentTrip.totalBudget || 0;
  document.getElementById('edit-trip-start-input').value = state.currentTrip.startDate;
  document.getElementById('edit-trip-end-input').value = state.currentTrip.endDate;
  document.getElementById('edit-trip-cover-input').value = state.currentTrip.coverImage || '';
  document.getElementById('edit-trip-desc-input').value = state.currentTrip.desc || '';
  
  openModal('edit-trip-modal');
}

function handleEditTripSubmit(e) {
  e.preventDefault();
  if (!state.currentTrip) return;
  
  const name = document.getElementById('edit-trip-name-input').value.trim();
  const city = document.getElementById('edit-trip-city-input').value.trim();
  const totalBudget = Number(document.getElementById('edit-trip-budget-input').value) || 0;
  const startDate = document.getElementById('edit-trip-start-input').value;
  const endDate = document.getElementById('edit-trip-end-input').value;
  const coverImage = document.getElementById('edit-trip-cover-input').value.trim();
  const desc = document.getElementById('edit-trip-desc-input').value.trim();
  
  if (new Date(startDate) > new Date(endDate)) {
    alert('開始日期不能晚於結束日期！');
    return;
  }
  
  // Adjust dates and days list
  const originalDays = state.currentTrip.days || [];
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffTime = Math.abs(end - start);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
  
  // Map existing days by date to preserve itinerary items
  const existingDaysMap = {};
  originalDays.forEach(d => {
    existingDaysMap[d.date] = d;
  });
  
  const newDays = [];
  for (let i = 1; i <= diffDays; i++) {
    const currentDate = new Date(start);
    currentDate.setDate(start.getDate() + (i - 1));
    const dateStr = currentDate.toISOString().split('T')[0];
    
    if (existingDaysMap[dateStr]) {
      newDays.push(existingDaysMap[dateStr]);
    } else {
      newDays.push({
        dayNum: i,
        date: dateStr,
        items: []
      });
    }
  }
  
  // Sort chronologically and re-assign dayNum
  newDays.sort((a, b) => a.date.localeCompare(b.date));
  newDays.forEach((d, index) => {
    d.dayNum = index + 1;
  });
  
  // Update state.currentTrip details
  state.currentTrip.name = name;
  state.currentTrip.city = city;
  state.currentTrip.totalBudget = totalBudget;
  state.currentTrip.startDate = startDate;
  state.currentTrip.endDate = endDate;
  if (coverImage) {
    state.currentTrip.coverImage = coverImage;
  }
  state.currentTrip.desc = desc;
  state.currentTrip.days = newDays;
  
  // If the currently selected day is out of range, reset it to day 1
  if (state.selectedDayNum > diffDays) {
    state.selectedDayNum = 1;
  }
  
  closeModal('edit-trip-modal');
  
  // Update on server and reload the views
  updateTripOnServer();
  
  // Update DOM elements that display trip details
  document.getElementById('detail-trip-name').textContent = name;
  document.getElementById('detail-trip-dates').textContent = formatDates(startDate, endDate);
  document.getElementById('detail-trip-desc').textContent = desc || '無備註說明';
  if (state.currentTrip.coverImage) {
    document.getElementById('trip-banner-bg').style.backgroundImage = `url('${state.currentTrip.coverImage}')`;
  }
}

/* ==========================================================================
   VIEW 3: TRIP DETAILS CONTROLLERS
   ========================================================================== */

function openTripDetail(tripId) {
  const trip = state.trips.find(t => t.id === tripId);
  if (!trip) return;

  state.currentTrip = trip;
  state.selectedDayNum = 1;
  state.activeTab = 'tab-itinerary';

  // Update trip info in DOM
  document.getElementById('detail-trip-name').textContent = trip.name;
  document.getElementById('detail-trip-dates').textContent = formatDates(trip.startDate, trip.endDate);
  document.getElementById('detail-trip-desc').textContent = trip.desc || '無備註說明';
  
  // Banner background
  document.getElementById('trip-banner-bg').style.backgroundImage = `url('${trip.coverImage}')`;

  // Reset Tab classes
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-itinerary-btn').classList.add('active');
  document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));
  document.getElementById('tab-itinerary').classList.add('active');

  // Load Subsections
  renderDayTabs();
  renderTimeline();
  renderBudgetTab();
  renderChecklistTab();
  updateSidebarBudgetCard();

  // Load recommendations and restaurants from the current trip
  state.recommendations = trip.recommendations || [];
  state.restaurants = trip.restaurants || [];
  state.selectedRecCategory = '全部';
  state.selectedRestCategory = '全部';
  
  renderRecommendations();
  renderRestaurants();

  switchView('trip-detail-view');
}

// Render Day selection tabs
function renderDayTabs() {
  const container = document.getElementById('day-tabs-container');
  container.innerHTML = '';

  state.currentTrip.days.forEach(day => {
    const btn = document.createElement('button');
    btn.className = `day-tab ${day.dayNum === state.selectedDayNum ? 'active' : ''}`;
    btn.textContent = `Day ${day.dayNum}`;
    btn.addEventListener('click', () => {
      state.selectedDayNum = day.dayNum;
      
      // Update Day classes
      document.querySelectorAll('.day-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      renderTimeline();


    });
    container.appendChild(btn);
  });
}

/* ==========================================================================
   TAB 1: TIMELINE ITINERARY
   ========================================================================== */

function renderTimeline() {
  const container = document.getElementById('timeline-events-container');
  container.innerHTML = '';

  const activeDay = state.currentTrip.days.find(d => d.dayNum === state.selectedDayNum);
  if (!activeDay || activeDay.items.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding: 40px 20px;">
        <i class="fa-solid fa-calendar-xmark empty-icon" style="font-size: 36px;"></i>
        <h3>今日行程尚無安排</h3>
        <p>點擊右側的推薦景點，或點擊「新增項目」自行規劃您的行程吧！</p>
      </div>
    `;
    return;
  }

  // Sort items chronologically by time
  const sortedItems = [...activeDay.items].sort((a, b) => a.time.localeCompare(b.time));

  sortedItems.forEach(item => {
    const itemCard = document.createElement('div');
    itemCard.className = `timeline-item cat-${item.category}`;

    const emoji = getCategoryEmoji(item.category);

    itemCard.innerHTML = `
      <div class="timeline-dot">
        ${emoji}
      </div>
      <div class="timeline-card">
        ${item.image ? `
          <div class="timeline-card-image">
            <img src="${item.image}" alt="${item.title}">
          </div>
        ` : ''}
        <div class="timeline-card-info">
          <div class="timeline-card-header">
            <div>
              <span class="timeline-time">${item.time}</span>
              <h3 class="timeline-title">${item.title}</h3>
            </div>
            <div class="timeline-actions">
              <span class="timeline-cost">${item.cost > 0 ? `$${item.cost.toLocaleString()}` : '免費'}</span>
              <div class="action-row">
                <button class="action-btn-link edit" onclick="openScheduleModalForEdit('${item.id}')" title="編輯"><i class="fa-solid fa-pen"></i></button>
                <button class="action-btn-link delete" onclick="handleDeleteScheduleItem('${item.id}')" title="刪除"><i class="fa-solid fa-trash-can"></i></button>
              </div>
            </div>
          </div>
          <div class="timeline-meta">
            ${item.location ? `<span><i class="fa-solid fa-location-dot"></i> ${item.location}</span>` : ''}
            <span><i class="fa-solid fa-tags"></i> ${getCategoryLabel(item.category)}</span>
          </div>
          ${item.notes ? `<p class="timeline-notes">${item.notes}</p>` : ''}
        </div>
      </div>
    `;

    container.appendChild(itemCard);
  });
}

function openScheduleModalForAdd() {
  document.getElementById('schedule-modal-title').textContent = '新增行程項目';
  document.getElementById('schedule-item-form').reset();
  document.getElementById('sched-item-id').value = '';
  document.getElementById('sched-time-start-input').value = '12:00';
  document.getElementById('sched-time-end-input').value = '13:00';
  document.getElementById('sched-cost-input').value = '0';
  openModal('schedule-item-modal');
}

function openScheduleModalForEdit(itemId) {
  const activeDay = state.currentTrip.days.find(d => d.dayNum === state.selectedDayNum);
  const item = activeDay.items.find(i => i.id === itemId);
  if (!item) return;

  document.getElementById('schedule-modal-title').textContent = '編輯行程項目';
  document.getElementById('sched-item-id').value = item.id;
  document.getElementById('sched-title-input').value = item.title;
  const times = item.time ? item.time.split(' - ') : ['12:00', '13:00'];
  document.getElementById('sched-time-start-input').value = times[0] || '12:00';
  document.getElementById('sched-time-end-input').value = times[1] || times[0] || '13:00';
  document.getElementById('sched-category-input').value = item.category;
  document.getElementById('sched-location-input').value = item.location || '';
  document.getElementById('sched-cost-input').value = item.cost || 0;
  document.getElementById('sched-image-input').value = item.image || '';
  document.getElementById('sched-notes-input').value = item.notes || '';

  openModal('schedule-item-modal');
}

async function handleScheduleSubmit(e) {
  e.preventDefault();
  
  const id = document.getElementById('sched-item-id').value;
  const title = document.getElementById('sched-title-input').value;
  const start = document.getElementById('sched-time-start-input').value;
  const end = document.getElementById('sched-time-end-input').value;
  const time = `${start} - ${end}`;
  const category = document.getElementById('sched-category-input').value;
  const location = document.getElementById('sched-location-input').value;
  const cost = Number(document.getElementById('sched-cost-input').value) || 0;
  const image = document.getElementById('sched-image-input').value;
  const notes = document.getElementById('sched-notes-input').value;

  const activeDayIdx = state.currentTrip.days.findIndex(d => d.dayNum === state.selectedDayNum);
  if (activeDayIdx === -1) return;

  if (id) {
    // Update existing item
    const itemIdx = state.currentTrip.days[activeDayIdx].items.findIndex(i => i.id === id);
    if (itemIdx !== -1) {
      state.currentTrip.days[activeDayIdx].items[itemIdx] = {
        ...state.currentTrip.days[activeDayIdx].items[itemIdx],
        title, time, category, location, cost, image, notes
      };
    }
  } else {
    // Create new item
    const newItem = {
      id: Date.now().toString(),
      title, time, category, location, cost, image, notes
    };
    state.currentTrip.days[activeDayIdx].items.push(newItem);
  }

  closeModal('schedule-item-modal');
  updateTripOnServer();
}

function handleDeleteScheduleItem(itemId) {
  if (!confirm('確定要刪除此行程項目嗎？')) return;
  const activeDayIdx = state.currentTrip.days.findIndex(d => d.dayNum === state.selectedDayNum);
  if (activeDayIdx === -1) return;

  state.currentTrip.days[activeDayIdx].items = state.currentTrip.days[activeDayIdx].items.filter(i => i.id !== itemId);
  updateTripOnServer();
}



/* ==========================================================================
   TAB 3: BUDGET TRACKER CONTROLLER
   ========================================================================== */

function renderBudgetTab() {
  const trip = state.currentTrip;
  if (!trip) return;

  // Calculate costs
  let totalSpent = 0;
  const catSpending = { Transport: 0, Food: 0, Hotel: 0, Attraction: 0, Shopping: 0, Others: 0 };
  const costItems = [];

  trip.days.forEach(day => {
    day.items.forEach(item => {
      const cost = Number(item.cost) || 0;
      totalSpent += cost;
      catSpending[item.category] = (catSpending[item.category] || 0) + cost;
      
      if (cost > 0) {
        costItems.push({
          title: item.title,
          category: item.category,
          cost: cost
        });
      }
    });
  });

  // Update budget views
  document.getElementById('budget-total-input').value = trip.totalBudget;
  document.getElementById('budget-total-spent').textContent = `$${totalSpent.toLocaleString()}`;
  
  const remaining = trip.totalBudget - totalSpent;
  const remainingEl = document.getElementById('budget-remaining-value');
  remainingEl.textContent = `$${remaining.toLocaleString()}`;

  if (remaining < 0) {
    remainingEl.className = 'value text-danger';
  } else {
    remainingEl.className = 'value text-primary';
  }

  // Render Category breakdown progress bars
  const breakdownContainer = document.getElementById('budget-category-list');
  breakdownContainer.innerHTML = '';

  const categories = ['Transport', 'Food', 'Hotel', 'Attraction', 'Shopping', 'Others'];
  
  categories.forEach(cat => {
    const amt = catSpending[cat];
    const percentage = totalSpent > 0 ? (amt / totalSpent * 100).toFixed(0) : 0;
    
    const item = document.createElement('div');
    item.className = 'category-breakdown-item';
    item.innerHTML = `
      <div class="category-label-row">
        <span class="category-name">
          <span class="category-name-dot cat-dot-${cat}"></span>
          ${getCategoryLabel(cat)}
        </span>
        <span class="category-amount">$${amt.toLocaleString()} (${percentage}%)</span>
      </div>
      <div class="category-progress-track">
        <div class="category-progress-fill cat-fill-${cat}" style="width: ${percentage}%"></div>
      </div>
    `;
    breakdownContainer.appendChild(item);
  });

  // Render costly items table
  const tableBody = document.getElementById('budget-table-body');
  tableBody.innerHTML = '';

  if (costItems.length === 0) {
    tableBody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">目前尚無付費項目明細。</td></tr>';
  } else {
    // Sort items by cost descending
    costItems.sort((a, b) => b.cost - a.cost);
    
    costItems.forEach(item => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td style="font-weight: 500;">${item.title}</td>
        <td><span class="budget-table-cat ${item.category}">${getCategoryLabel(item.category)}</span></td>
        <td style="font-weight: 700;">$${item.cost.toLocaleString()}</td>
      `;
      tableBody.appendChild(row);
    });
  }
}

function handleSaveBudgetLimit() {
  const val = Number(document.getElementById('budget-total-input').value) || 0;
  if (val < 0) {
    alert('預算上限不能小於 0');
    return;
  }
  state.currentTrip.totalBudget = val;
  updateTripOnServer();
}

function updateSidebarBudgetCard() {
  const trip = state.currentTrip;
  if (!trip) return;

  let totalSpent = 0;
  trip.days.forEach(day => {
    day.items.forEach(item => {
      totalSpent += Number(item.cost) || 0;
    });
  });

  // Fill quick widgets
  const percentage = Math.min((totalSpent / trip.totalBudget * 100), 100);
  document.getElementById('budget-progress-fill').style.width = `${percentage}%`;
  
  document.getElementById('budget-quick-spent').textContent = `$${totalSpent.toLocaleString()}`;
  document.getElementById('budget-quick-total').textContent = `$${trip.totalBudget.toLocaleString()}`;

  const statusEl = document.getElementById('budget-quick-status');
  if (totalSpent > trip.totalBudget) {
    statusEl.textContent = '預算已超支！';
    statusEl.style.color = '#ef4444';
  } else if (totalSpent > trip.totalBudget * 0.8) {
    statusEl.textContent = '即將達到預算上限！';
    statusEl.style.color = '#f59e0b';
  } else {
    statusEl.textContent = '支出在預算範圍內';
    statusEl.style.color = 'var(--text-muted)';
  }
}

/* ==========================================================================
   TAB 4: CHECKLIST CONTROLLERS
   ========================================================================== */

function renderChecklistTab() {
  const trip = state.currentTrip;
  if (!trip) return;

  const container = document.getElementById('checklist-columns-container');
  container.innerHTML = '';

  const groups = {
    '證件/金流': [],
    '衣物': [],
    '電子產品': [],
    '盥洗用品': [],
    '其他': []
  };

  trip.checklist.forEach(item => {
    if (groups[item.category]) {
      groups[item.category].push(item);
    } else {
      groups['其他'].push(item);
    }
  });

  Object.keys(groups).forEach(cat => {
    const items = groups[cat];
    
    const groupCol = document.createElement('div');
    groupCol.className = 'checklist-group';
    
    let itemsHTML = '';
    
    if (items.length === 0) {
      itemsHTML = '<p class="text-muted" style="font-size: 11px; padding: 4px 0;">無項目</p>';
    } else {
      items.forEach(item => {
        itemsHTML += `
          <div class="checklist-item ${item.completed ? 'completed' : ''}" onclick="toggleChecklistItem('${item.id}')">
            <input type="checkbox" ${item.completed ? 'checked' : ''}>
            <span>${item.text}</span>
            <button class="delete-chk-btn" onclick="event.stopPropagation(); deleteChecklistItem('${item.id}')" title="刪除項目">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </div>
        `;
      });
    }

    groupCol.innerHTML = `
      <h4 class="checklist-group-title">${cat}</h4>
      <div class="checklist-items">
        ${itemsHTML}
      </div>
    `;

    container.appendChild(groupCol);
  });
}

window.toggleChecklistItem = function(itemId) {
  const itemIdx = state.currentTrip.checklist.findIndex(c => c.id === itemId);
  if (itemIdx === -1) return;

  state.currentTrip.checklist[itemIdx].completed = !state.currentTrip.checklist[itemIdx].completed;
  updateTripOnServer();
};

window.deleteChecklistItem = function(itemId) {
  state.currentTrip.checklist = state.currentTrip.checklist.filter(c => c.id !== itemId);
  updateTripOnServer();
};

function handleAddChecklist() {
  const cat = document.getElementById('checklist-new-cat').value;
  const text = document.getElementById('checklist-new-text').value.trim();
  if (text === '') return;

  const newItem = {
    id: Date.now().toString(),
    category: cat,
    text: text,
    completed: false
  };

  state.currentTrip.checklist.push(newItem);
  document.getElementById('checklist-new-text').value = '';
  updateTripOnServer();
}

/* ==========================================================================
   MODAL UTILITIES
   ========================================================================== */

function openModal(modalId) {
  document.getElementById(modalId).classList.add('active');
}

function closeModal(modalId) {
  document.getElementById(modalId).classList.remove('active');
}

/* ==========================================================================
   UTILITY & FORMATTING HELPERS
   ========================================================================== */

function formatDates(startStr, endStr) {
  const start = new Date(startStr);
  const end = new Date(endStr);
  
  const opt = { year: 'numeric', month: '2-digit', day: '2-digit' };
  return `${start.toLocaleDateString('zh-TW', opt)} - ${end.toLocaleDateString('zh-TW', opt)}`;
}

function getCategoryEmoji(cat) {
  const emojis = {
    Transport: '🚗',
    Food: '🍔',
    Hotel: '🏨',
    Attraction: '🎡',
    Shopping: '🛍',
    Others: '📍'
  };
  return emojis[cat] || '📍';
}

function getCategoryLabel(cat) {
  const labels = {
    Transport: '交通',
    Food: '美食',
    Hotel: '住宿',
    Attraction: '景點',
    Shopping: '購物',
    Others: '其他'
  };
  return labels[cat] || '其他';
}

function getCategoryColor(cat) {
  const colors = {
    Transport: '#38bdf8', // sky-400
    Food: '#f59e0b',      // amber-500
    Hotel: '#818cf8',     // indigo-400
    Attraction: '#34d399',// emerald-400
    Shopping: '#f472b6',  // pink-400
    Others: '#94a3b8'     // slate-400
  };
  return colors[cat] || '#94a3b8';
}

/* ==========================================================================
   WEBSOCKET REAL-TIME COLLABORATION
   ========================================================================== */

function connectWebSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  state.socket = new WebSocket(`${protocol}//${location.host}`);

  state.socket.onopen = () => {
    console.log('WebSocket connected for real-time collaboration');
    const counterEl = document.getElementById('online-counter');
    if (counterEl) {
      counterEl.className = 'badge text-success';
      counterEl.style.borderColor = 'rgba(16, 185, 129, 0.3)';
      counterEl.style.backgroundColor = 'rgba(16, 185, 129, 0.1)';
      counterEl.innerHTML = `<i class="fa-solid fa-users"></i> 協同連線中`;
    }
  };

  state.socket.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'online_count') {
        const counterEl = document.getElementById('online-counter');
        if (counterEl) {
          counterEl.className = 'badge text-success';
          counterEl.style.borderColor = 'rgba(16, 185, 129, 0.3)';
          counterEl.style.backgroundColor = 'rgba(16, 185, 129, 0.1)';
          counterEl.innerHTML = `<i class="fa-solid fa-users"></i> 線上: ${msg.count} 人`;
        }
      } else if (msg.type === 'trip_updated') {
        handleRemoteTripUpdate(msg.tripId);
      } else if (msg.type === 'trip_deleted') {
        handleRemoteTripDelete(msg.tripId);
      }
    } catch (err) {
      console.error('Error handling WebSocket message:', err);
    }
  };

  state.socket.onclose = () => {
    console.log('WebSocket connection closed. Attempting reconnect in 3s...');
    const counterEl = document.getElementById('online-counter');
    if (counterEl) {
      counterEl.className = 'badge text-warning';
      counterEl.style.borderColor = 'rgba(245, 158, 11, 0.3)';
      counterEl.style.backgroundColor = 'rgba(245, 158, 11, 0.1)';
      counterEl.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> 離線 (重連中...)`;
    }
    setTimeout(connectWebSocket, 3000);
  };
}

async function handleRemoteTripUpdate(tripId) {
  try {
    const res = await fetch(`/api/trips/${tripId}`, { cache: 'no-store' });
    if (!res.ok) throw new Error('Failed to fetch updated trip');
    const tripData = await res.json();

    // Update local trips list
    const idx = state.trips.findIndex(t => t.id === tripId);
    if (idx !== -1) {
      state.trips[idx] = tripData;
    } else {
      state.trips.push(tripData);
    }

    // If this is the active trip being edited by current user, reload views
    if (state.currentTrip && state.currentTrip.id === tripId) {
      state.currentTrip = tripData;
      state.recommendations = tripData.recommendations || [];
      state.restaurants = tripData.restaurants || [];
      
      // Refresh UI components
      renderDayTabs();
      renderTimeline();
      renderBudgetTab();
      renderChecklistTab();
      updateSidebarBudgetCard();
      renderRecommendations();
      renderRestaurants();
    } else {
      // Refresh dashboard if not viewing this trip
      renderTripsGrid();
    }
  } catch (err) {
    console.error('Error handling remote trip update:', err);
  }
}

function handleRemoteTripDelete(tripId) {
  // Remove from local trips list
  state.trips = state.trips.filter(t => t.id !== tripId);
  
  // Refresh dashboard view
  renderTripsGrid();

  // If user is currently editing the deleted trip, boot them out
  if (state.currentTrip && state.currentTrip.id === tripId) {
    alert('此旅行計畫已被其他共同編輯者刪除！將返回儀表板。');
    switchView('dashboard-view');
    state.currentTrip = null;
  }
}

/* ==========================================================================
   SPOT LIVE SEARCH & MAP PREVIEW
   ========================================================================== */

async function handleSpotSearch() {
  const query = document.getElementById('spot-search-input').value.trim();
  if (query === '') return;

  const resultsContainer = document.getElementById('spot-search-results');
  if (!resultsContainer) return;

  // Append city to query for better results if currentTrip is set
  let searchQuery = query;
  if (state.currentTrip && state.currentTrip.city) {
    if (!query.includes(state.currentTrip.city)) {
       searchQuery = `${state.currentTrip.city} ${query}`;
    }
  }

  // Render Loading State & Map iframe
  resultsContainer.innerHTML = `
    <div class="map-preview-wrapper" style="border-radius: var(--radius-md); overflow: hidden; border: 1px solid var(--glass-border); height: 320px; position: relative; width: 100%;">
      <iframe 
        width="100%" 
        height="100%" 
        frameborder="0" 
        style="border:0; background: var(--bg-tertiary);" 
        src="https://maps.google.com/maps?q=${encodeURIComponent(searchQuery)}&t=&z=15&ie=UTF8&iwloc=&output=embed" 
        allowfullscreen>
      </iframe>
    </div>
    
    <div style="display: flex; flex-direction: column; gap: 10px; margin-top: 12px; width: 100%;">
      <h4 style="font-family: var(--font-heading); font-size: 15px; font-weight: 700; margin: 0; display: flex; align-items: center; gap: 6px;">
        📍 搜尋結果：${query}
      </h4>
      <div id="external-api-results" style="display:flex; flex-direction:column; gap:8px;">
         <div style="text-align:center; padding:20px; color:var(--text-muted);"><i class="fa-solid fa-spinner fa-spin"></i> 正在搜尋真實地標...</div>
      </div>
      <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(searchQuery)}" target="_blank" rel="noopener noreferrer" class="btn btn-outline" style="width: 100%; display: flex; justify-content: center; gap: 8px; font-size: 13px; text-decoration: none; align-items: center; color: var(--text-primary); margin-top: 8px;">
        <i class="fa-solid fa-arrow-up-right-from-square"></i> 在 Google Maps 中開啟
      </a>
    </div>
  `;

  // Fetch results from OpenStreetMap Nominatim
  const apiResultsContainer = document.getElementById('external-api-results');
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&limit=5`, {
      headers: {
        'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
        'User-Agent': 'TravelCalendarApp/1.0'
      }
    });
    
    if (!res.ok) throw new Error('API request failed');
    const data = await res.json();
    
    apiResultsContainer.innerHTML = '';
    
    if (data.length === 0) {
      apiResultsContainer.innerHTML = `
        <div style="padding: 12px; border: 1px dashed var(--glass-border); border-radius: var(--radius-sm); color: var(--text-muted); font-size: 13px; text-align: center;">
          找不到相符的地標，但您仍可以透過下方按鈕手動加入行程。
        </div>
        <button class="btn btn-primary w-full" onclick="importSearchedSpotToItinerary('${encodeURIComponent(query)}')" style="width: 100%; display: flex; justify-content: center; gap: 8px; font-size: 13px; margin-top: 8px;">
          <i class="fa-solid fa-calendar-plus"></i> 直接將「${query}」加入行程
        </button>
      `;
      return;
    }

    // Render returned spots
    data.forEach(place => {
      const spotName = place.name || place.display_name.split(',')[0];
      const card = document.createElement('div');
      card.className = 'rec-spot-card';
      card.style.margin = '0';
      card.innerHTML = `
        <div class="rec-spot-card-cat"><i class="fa-solid fa-map-pin"></i> ${place.type === 'restaurant' || place.type === 'cafe' ? '餐飲' : '景點'}</div>
        <h4 class="rec-spot-card-title" style="margin-bottom: 4px; font-size: 14px;">${spotName}</h4>
        <p class="rec-spot-card-desc" style="font-size: 11px; margin-bottom: 8px; opacity: 0.8; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">${place.display_name}</p>
        <button class="btn btn-primary btn-sm" onclick="importExternalSpotToItinerary('${encodeURIComponent(spotName)}', '${encodeURIComponent(place.display_name)}')" style="padding: 4px 8px; font-size: 11px; display: flex; align-items: center; justify-content: center; gap: 4px; width: 100%;">
          <i class="fa-solid fa-plus"></i> 加入行程
        </button>
      `;
      apiResultsContainer.appendChild(card);
    });

  } catch (err) {
    console.error('Error fetching external spots:', err);
    apiResultsContainer.innerHTML = `
      <div style="padding: 12px; border: 1px dashed var(--danger); border-radius: var(--radius-sm); color: var(--danger); font-size: 13px; text-align: center;">
        地圖服務暫時無法連線，請稍後再試。
      </div>
      <button class="btn btn-primary w-full" onclick="importSearchedSpotToItinerary('${encodeURIComponent(query)}')" style="width: 100%; display: flex; justify-content: center; gap: 8px; font-size: 13px; margin-top: 8px;">
        <i class="fa-solid fa-calendar-plus"></i> 直接將「${query}」加入行程
      </button>
    `;
  }
}

window.importSearchedSpotToItinerary = function(encodedQuery) {
  const query = decodeURIComponent(encodedQuery);
  
  // Pre-fill schedule modal fields
  document.getElementById('schedule-modal-title').textContent = '匯入搜尋景點';
  document.getElementById('sched-item-id').value = '';
  document.getElementById('sched-title-input').value = query;
  document.getElementById('sched-time-start-input').value = '12:00';
  document.getElementById('sched-time-end-input').value = '13:00';
  document.getElementById('sched-category-input').value = 'Attraction'; // Defaults to Attraction
  document.getElementById('sched-location-input').value = query;
  document.getElementById('sched-cost-input').value = 0;
  document.getElementById('sched-image-input').value = '';
  document.getElementById('sched-notes-input').value = '經由搜尋景點地圖匯入';

  openModal('schedule-item-modal');
};

window.importExternalSpotToItinerary = function(encodedName, encodedDesc) {
  const name = decodeURIComponent(encodedName);
  const desc = decodeURIComponent(encodedDesc);

  // Pre-fill schedule modal fields
  document.getElementById('schedule-modal-title').textContent = '匯入外部地圖景點';
  document.getElementById('sched-item-id').value = '';
  document.getElementById('sched-title-input').value = name;
  document.getElementById('sched-time-start-input').value = '12:00';
  document.getElementById('sched-time-end-input').value = '13:00';
  document.getElementById('sched-category-input').value = 'Attraction'; // Defaults to Attraction
  document.getElementById('sched-location-input').value = name;
  document.getElementById('sched-cost-input').value = 0;
  document.getElementById('sched-image-input').value = '';
  document.getElementById('sched-notes-input').value = desc;

  openModal('schedule-item-modal');
};

/* ==========================================================================
   POPULAR SPOTS & RESTAURANTS RECOMMENDATIONS PANEL
   ========================================================================== */

function setupSidebarTabs() {
  const searchTabBtn = document.getElementById('sidebar-tab-search-btn');
  const recTabBtn = document.getElementById('sidebar-tab-rec-btn');
  const restTabBtn = document.getElementById('sidebar-tab-rest-btn');
  
  const tabs = [
    { btn: searchTabBtn, contentId: 'sidebar-content-search', onActive: null },
    { btn: recTabBtn, contentId: 'sidebar-content-rec', onActive: renderRecommendations },
    { btn: restTabBtn, contentId: 'sidebar-content-rest', onActive: renderRestaurants }
  ];

  tabs.forEach(tab => {
    if (tab.btn) {
      tab.btn.addEventListener('click', () => {
        tabs.forEach(t => {
          if (t.btn) {
            t.btn.classList.toggle('active', t === tab);
            const contentEl = document.getElementById(t.contentId);
            if (contentEl) {
              contentEl.style.display = t === tab ? 'flex' : 'none';
            }
          }
        });
        if (tab.onActive) tab.onActive();
      });
    }
  });
}

/* ==========================================================================
   POPULAR SPOTS & RESTAURANTS RECOMMENDATIONS PANEL (CLIENT-SIDE TXT IMPORT)
   ========================================================================== */

function parseTxtFile(text) {
  const lines = text.split(/\r?\n/);
  const items = [];
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    // Split by comma. Since description might contain commas, we split only on first two commas
    const firstCommaIdx = line.indexOf(',');
    if (firstCommaIdx === -1) continue;
    const category = cleanCsvVal(line.substring(0, firstCommaIdx));
    const rest = line.substring(firstCommaIdx + 1);
    
    const secondCommaIdx = rest.indexOf(',');
    if (secondCommaIdx === -1) continue;
    const name = cleanCsvVal(rest.substring(0, secondCommaIdx));
    const description = cleanCsvVal(rest.substring(secondCommaIdx + 1));
    
    if (category && name && description) {
      items.push({ category, name, description });
    }
  }
  return items;
}

function cleanCsvVal(val) {
  val = val.trim();
  if (val.startsWith('"') && val.endsWith('"')) {
    val = val.substring(1, val.length - 1);
  }
  return val.replace(/""/g, '"').trim();
}

function triggerImport(type) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.txt,.csv';
  input.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = parseTxtFile(event.target.result);
        if (parsed.length === 0) {
          alert('無法解析檔案內容，請確認檔案格式是否正確。');
          return;
        }
        
        if (type === 'recommendation') {
          state.currentTrip.recommendations = parsed;
          state.recommendations = parsed;
          state.selectedRecCategory = '全部';
          renderRecommendations();
        } else {
          state.currentTrip.restaurants = parsed;
          state.restaurants = parsed;
          state.selectedRestCategory = '全部';
          renderRestaurants();
        }
        
        updateTripOnServer();
      } catch (err) {
        console.error('Error importing file:', err);
        alert('檔案匯入失敗，發生錯誤：' + err.message);
      }
    };
    reader.readAsText(file, 'utf-8');
  };
  input.click();
}

window.triggerImport = triggerImport;

function renderRecommendations() {
  const categoriesContainer = document.getElementById('popular-rec-categories');
  const cardsContainer = document.getElementById('popular-rec-cards');
  if (!categoriesContainer || !cardsContainer) return;

  if (state.recommendations.length === 0) {
    categoriesContainer.innerHTML = '';
    cardsContainer.innerHTML = `
      <div class="import-container" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; padding: 40px 20px; text-align: center; border: 2px dashed var(--glass-border); border-radius: var(--radius-md); background: rgba(255, 255, 255, 0.02); margin: 16px;">
        <i class="fa-solid fa-file-import" style="font-size: 36px; color: var(--text-muted); margin-bottom: 4px;"></i>
        <div>
          <h4 style="margin: 0 0 6px 0; font-size: 14px; color: var(--text-primary);">匯入自訂景點檔案</h4>
          <p style="margin: 0; font-size: 11px; color: var(--text-muted); line-height: 1.4; max-width: 220px;">請選擇 CSV/TXT 檔案，首行為標題列，內容格式為「分類,名稱,介紹」</p>
        </div>
        <button class="btn btn-primary btn-sm" onclick="triggerImport('recommendation')" style="display: inline-flex; align-items: center; gap: 6px;">
          <i class="fa-solid fa-folder-open"></i> 選擇檔案
        </button>
      </div>
    `;
    return;
  }

  // 1. Gather all unique categories
  const categories = ['全部', ...new Set(state.recommendations.map(r => r.category))];

  // 2. Render category filter tags
  categoriesContainer.innerHTML = '';
  categories.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = `filter-tag ${state.selectedRecCategory === cat ? 'active' : ''}`;
    let label = cat;
    if (cat.includes('：')) {
      label = cat.split('：')[0];
    }
    btn.textContent = label;
    btn.title = cat;
    btn.addEventListener('click', () => {
      state.selectedRecCategory = cat;
      renderRecommendations();
    });
    categoriesContainer.appendChild(btn);
  });

  // Append Re-import action button at the end of categories list
  const reimportBtn = document.createElement('button');
  reimportBtn.className = 'filter-tag btn-outline';
  reimportBtn.style.border = '1px dashed var(--accent-primary)';
  reimportBtn.style.color = 'var(--accent-primary)';
  reimportBtn.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> 重新匯入';
  reimportBtn.addEventListener('click', () => triggerImport('recommendation'));
  categoriesContainer.appendChild(reimportBtn);

  // 3. Filter spots based on category
  const filteredSpots = state.selectedRecCategory === '全部'
    ? state.recommendations
    : state.recommendations.filter(r => r.category === state.selectedRecCategory);

  // 4. Render cards
  cardsContainer.innerHTML = '';
  filteredSpots.forEach(spot => {
    const card = document.createElement('div');
    card.className = 'rec-spot-card';
    card.innerHTML = `
      <div class="rec-spot-card-cat"><i class="fa-solid fa-hashtag"></i> ${spot.category}</div>
      <h4 class="rec-spot-card-title">${spot.name}</h4>
      <p class="rec-spot-card-desc">${spot.description}</p>
      <div class="rec-spot-card-actions">
        <button class="btn btn-primary btn-sm" onclick="importPopularSpotToForm('${encodeURIComponent(spot.name)}', '${encodeURIComponent(spot.description)}')" style="padding: 4px 8px; font-size: 11px; display: flex; align-items: center; gap: 4px;">
          <i class="fa-solid fa-plus"></i> 加入行程
        </button>
        <button class="btn btn-outline btn-sm" onclick="previewPopularSpotOnMap('${encodeURIComponent(spot.name)}')" style="padding: 4px 8px; font-size: 11px; display: flex; align-items: center; gap: 4px;">
          <i class="fa-solid fa-map"></i> 地圖預覽
        </button>
      </div>
    `;
    cardsContainer.appendChild(card);
  });
}

function renderRestaurants() {
  const categoriesContainer = document.getElementById('popular-rest-categories');
  const cardsContainer = document.getElementById('popular-rest-cards');
  if (!categoriesContainer || !cardsContainer) return;

  if (state.restaurants.length === 0) {
    categoriesContainer.innerHTML = '';
    cardsContainer.innerHTML = `
      <div class="import-container" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; padding: 40px 20px; text-align: center; border: 2px dashed var(--glass-border); border-radius: var(--radius-md); background: rgba(255, 255, 255, 0.02); margin: 16px;">
        <i class="fa-solid fa-file-import" style="font-size: 36px; color: var(--text-muted); margin-bottom: 4px;"></i>
        <div>
          <h4 style="margin: 0 0 6px 0; font-size: 14px; color: var(--text-primary);">匯入自訂餐廳檔案</h4>
          <p style="margin: 0; font-size: 11px; color: var(--text-muted); line-height: 1.4; max-width: 220px;">請選擇 CSV/TXT 檔案，首行為標題列，內容格式為「分類,名稱,介紹」</p>
        </div>
        <button class="btn btn-primary btn-sm" onclick="triggerImport('restaurant')" style="display: inline-flex; align-items: center; gap: 6px;">
          <i class="fa-solid fa-folder-open"></i> 選擇檔案
        </button>
      </div>
    `;
    return;
  }

  // 1. Gather all unique categories
  const categories = ['全部', ...new Set(state.restaurants.map(r => r.category))];

  // 2. Render category filter tags
  categoriesContainer.innerHTML = '';
  categories.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = `filter-tag ${state.selectedRestCategory === cat ? 'active' : ''}`;
    btn.textContent = cat;
    btn.title = cat;
    btn.addEventListener('click', () => {
      state.selectedRestCategory = cat;
      renderRestaurants();
    });
    categoriesContainer.appendChild(btn);
  });

  // Append Re-import action button at the end of categories list
  const reimportBtn = document.createElement('button');
  reimportBtn.className = 'filter-tag btn-outline';
  reimportBtn.style.border = '1px dashed var(--accent-primary)';
  reimportBtn.style.color = 'var(--accent-primary)';
  reimportBtn.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> 重新匯入';
  reimportBtn.addEventListener('click', () => triggerImport('restaurant'));
  categoriesContainer.appendChild(reimportBtn);

  // 3. Filter restaurants based on category
  const filteredRest = state.selectedRestCategory === '全部'
    ? state.restaurants
    : state.restaurants.filter(r => r.category === state.selectedRestCategory);

  // 4. Render cards
  cardsContainer.innerHTML = '';
  filteredRest.forEach(restaurant => {
    const card = document.createElement('div');
    card.className = 'rec-spot-card';
    card.innerHTML = `
      <div class="rec-spot-card-cat"><i class="fa-solid fa-utensils"></i> ${restaurant.category}</div>
      <h4 class="rec-spot-card-title">${restaurant.name}</h4>
      <p class="rec-spot-card-desc">${restaurant.description}</p>
      <div class="rec-spot-card-actions">
        <button class="btn btn-primary btn-sm" onclick="importRestaurantToForm('${encodeURIComponent(restaurant.name)}', '${encodeURIComponent(restaurant.description)}')" style="padding: 4px 8px; font-size: 11px; display: flex; align-items: center; gap: 4px;">
          <i class="fa-solid fa-plus"></i> 加入行程
        </button>
        <button class="btn btn-outline btn-sm" onclick="previewPopularSpotOnMap('${encodeURIComponent(restaurant.name)}')" style="padding: 4px 8px; font-size: 11px; display: flex; align-items: center; gap: 4px;">
          <i class="fa-solid fa-map"></i> 地圖預覽
        </button>
      </div>
    `;
    cardsContainer.appendChild(card);
  });
}

window.importPopularSpotToForm = function(encodedName, encodedDesc) {
  const name = decodeURIComponent(encodedName);
  const desc = decodeURIComponent(encodedDesc);

  // Pre-fill schedule modal fields
  document.getElementById('schedule-modal-title').textContent = '匯入推薦景點';
  document.getElementById('sched-item-id').value = '';
  document.getElementById('sched-title-input').value = name;
  document.getElementById('sched-time-start-input').value = '12:00';
  document.getElementById('sched-time-end-input').value = '13:00';
  document.getElementById('sched-category-input').value = 'Attraction'; // Defaults to Attraction
  document.getElementById('sched-location-input').value = name;
  document.getElementById('sched-cost-input').value = 0;
  document.getElementById('sched-image-input').value = '';
  document.getElementById('sched-notes-input').value = desc;

  openModal('schedule-item-modal');
};

window.importRestaurantToForm = function(encodedName, encodedDesc) {
  const name = decodeURIComponent(encodedName);
  const desc = decodeURIComponent(encodedDesc);

  // Pre-fill schedule modal fields
  document.getElementById('schedule-modal-title').textContent = '匯入推薦餐廳';
  document.getElementById('sched-item-id').value = '';
  document.getElementById('sched-title-input').value = name;
  document.getElementById('sched-time-start-input').value = '12:00';
  document.getElementById('sched-time-end-input').value = '13:00';
  document.getElementById('sched-category-input').value = 'Food'; // Defaults to Food
  document.getElementById('sched-location-input').value = name;
  document.getElementById('sched-cost-input').value = 0;
  document.getElementById('sched-image-input').value = '';
  document.getElementById('sched-notes-input').value = desc;

  openModal('schedule-item-modal');
};

window.previewPopularSpotOnMap = function(encodedName) {
  const name = decodeURIComponent(encodedName);
  
  // Switch to the map search tab
  document.querySelectorAll('.sidebar-subtab').forEach(btn => {
    btn.classList.toggle('active', btn.id === 'sidebar-tab-search-btn');
  });
  document.querySelectorAll('.sidebar-tab-content').forEach(content => {
    content.style.display = content.id === 'sidebar-content-search' ? 'flex' : 'none';
  });

  // Pre-fill search input and search
  const spotSearchInput = document.getElementById('spot-search-input');
  if (spotSearchInput) {
    spotSearchInput.value = name;
    handleSpotSearch();
  }
};
