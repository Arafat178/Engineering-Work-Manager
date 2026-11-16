/**
 * Personal Engineering Work Manager - Complete Application Logic
 * Engineered for: Arafat Hossain | The IBN SINA Pharmaceutical Industry PLC
 * Storage: Firebase Firestore Cloud Database
 */

(function () {
  'use strict';

  const DEFAULT_CATEGORIES = [
    'Chiller & Cooling System',
    'RDS',
    'URS',
    'SOP',
    'HVAC',
    'Air Compressor',
    'Boiler',
    'Purified Water System',
    'Soft Water System',
    'Warehouse Monitoring',
    'Electrical & Utility',
    'Documentation',
    'Equipment Maintenance',
    'General Engineering Work'
  ];

  const DEFAULT_SETTINGS = {
    id: 'profile',
    company: 'The IBN SINA Pharmaceutical Industry PLC',
    department: 'Engineering Department',
    engineerName: 'Arafat Hossain',
    designation: 'Executive, Engineering',
    supervisor: 'Manager, Engineering',
    theme: 'light',
    categories: DEFAULT_CATEGORIES
  };

  // Application State
  const state = {
    tasks: [],
    monitoring: [],
    updates: [],
    settings: { ...DEFAULT_SETTINGS },
    currentView: 'dashboard',
    activeDashboardBucket: 'doFirst',
    deferredPwaPrompt: null
  };

  // ==================== UTILITY HELPERS ====================
  function todayISO() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function addDaysISO(dateStr, days) {
    const d = new Date((dateStr || todayISO()) + 'T00:00:00');
    d.setDate(d.getDate() + days);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function formatDateReadable(dateStr) {
    if (!dateStr) return 'N/A';
    const d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function daysDiffFromToday(dateStr) {
    if (!dateStr) return 999;
    const today = new Date(todayISO() + 'T00:00:00');
    const target = new Date(dateStr + 'T00:00:00');
    return Math.round((target - today) / (1000 * 60 * 60 * 24));
  }

  function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function uid(prefix = 'id') {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  }

  function showToast(message) {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.remove();
    }, 3200);
  }

  // ==================== FIREBASE STORAGE ENGINE ====================
  // Initialize your Firebase configuration here
  const firebaseConfig = {
    apiKey: "AIzaSyBiDUds9uvERN44vksMTVG03fKc7gYcYXg",
    authDomain: "engineering-work-manager-2eeea.firebaseapp.com",
    projectId: "engineering-work-manager-2eeea",
    storageBucket: "engineering-work-manager-2eeea.firebasestorage.app",
    messagingSenderId: "290019671850",
    appId: "1:290019671850:web:8ebc9785c9eadc16b6a853",
    measurementId: "G-RJ40NSPBM8"
  };

  // Start Firebase App
  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }
  const db = firebase.firestore();

  /**
   * Fetch all records from a specific collection in Firestore
   */
  async function dbGetAll(storeName) {
    try {
      const snapshot = await db.collection(storeName).get();
      const items = [];
      snapshot.forEach(doc => {
        items.push(doc.data());
      });
      return items;
    } catch (err) {
      console.error(`Error fetching ${storeName}:`, err);
      return [];
    }
  }

  /**
   * Add or update a record in Firestore
   */
  async function dbPut(storeName, item) {
    try {
      await db.collection(storeName).doc(item.id).set(item);
      return item;
    } catch (err) {
      console.error(`Error saving to ${storeName}:`, err);
    }
  }

  /**
   * Delete a specific record from Firestore
   */
  async function dbDelete(storeName, id) {
    try {
      await db.collection(storeName).doc(id).delete();
    } catch (err) {
      console.error(`Error deleting from ${storeName}:`, err);
    }
  }

  /**
   * Erase all engineering data from Firestore
   */
  async function dbClearAll() {
    const stores = ['tasks', 'monitoring', 'updates', 'settings'];
    
    for (const store of stores) {
      try {
        const snapshot = await db.collection(store).get();
        const batch = db.batch(); 
        snapshot.forEach(doc => {
          batch.delete(doc.ref);
        });
        await batch.commit();
      } catch (err) {
        console.error(`Error clearing ${store}:`, err);
      }
    }
  }

  // ==================== SMART PRIORITY ENGINE ====================
  /**
   * Categorizes a task into one of the 5 required buckets:
   * 1. doFirst - Critical or urgent / overdue direct tasks
   * 2. doToday - Important tasks due today
   * 3. upcoming - Tasks with future deadlines
   * 4. followup - Pending tasks waiting for someone else / material / approval
   * 5. monitoring - Tasks requiring observation rather than direct execution
   */
  function classifyTaskSmartBucket(task) {
    if (task.status === 'Completed') return 'completed';

    // 5. Monitoring tasks (do not treat every monitoring task as immediate execution)
    if (task.executionType === 'monitoring') {
      return 'monitoring';
    }

    // 4. Pending Follow-up tasks
    if (task.status === 'Pending' || task.status === 'On Hold' || task.executionType === 'followup') {
      return 'followup';
    }

    const diff = daysDiffFromToday(task.deadline);

    // 1. Do First: Overdue OR Critical priority OR (High priority due today & blocking)
    if (diff < 0 || task.priority === 'Critical' || (diff === 0 && task.isBlocking)) {
      return 'doFirst';
    }

    // 2. Do Today: Tasks due today (or High priority due tomorrow)
    if (diff === 0 || (diff === 1 && task.priority === 'High')) {
      return 'doToday';
    }

    // 3. Upcoming: Future deadlines
    return 'upcoming';
  }

  function calculateTaskPriorityScore(task) {
    if (task.status === 'Completed') return -1000;

    let score = 0;
    const priorityWeights = { Critical: 100, High: 70, Medium: 40, Low: 15 };
    score += priorityWeights[task.priority] || 30;

    const diff = daysDiffFromToday(task.deadline);
    if (diff < 0) {
      score += 90 + Math.min(Math.abs(diff) * 5, 40); // Overdue boost
    } else if (diff === 0) {
      score += 65; // Due today
    } else if (diff === 1) {
      score += 35; // Due tomorrow
    } else if (diff <= 3) {
      score += 15;
    }

    if (task.isBlocking) {
      score += 35; // Blocking dependency boost
    }

    if (task.status === 'In Progress') {
      score += 15; // Momentum bonus
    }

    // Do not treat passive monitoring tasks as immediate execution unless overdue follow-up
    if (task.executionType === 'monitoring') {
      score -= 80;
    }

    // Pending tasks need follow-up if their follow-up date is today or overdue
    if (task.status === 'Pending' || task.executionType === 'followup') {
      const fDiff = daysDiffFromToday(task.followupDate || task.deadline);
      if (fDiff <= 0) score += 20;
      else score -= 45;
    }

    return score;
  }

  function buildRecommendationReason(task) {
    const reasons = [];
    const diff = daysDiffFromToday(task.deadline);
    if (diff < 0) reasons.push(`Overdue by ${Math.abs(diff)} day(s)`);
    else if (diff === 0) reasons.push('Due Today');
    else if (diff === 1) reasons.push('Due Tomorrow');

    reasons.push(`${task.priority} Priority`);
    if (task.isBlocking) reasons.push('Blocks dependent plant activities');
    if (task.status === 'Pending') reasons.push('Requires immediate follow-up');
    return reasons.join(' • ');
  }

  // ==================== RENDERING ENGINE ====================
  async function loadAllState() {
    state.tasks = await dbGetAll('tasks');
    state.monitoring = await dbGetAll('monitoring');
    state.updates = await dbGetAll('updates');
    const savedSettings = await dbGetAll('settings');
    const profile = savedSettings.find((s) => s.id === 'profile');
    if (profile) {
      state.settings = { ...DEFAULT_SETTINGS, ...profile };
    }
    applyTheme(state.settings.theme || 'light');
    populateCategorySelects();
    updateProfileUI();
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    state.settings.theme = theme;
  }

  function updateProfileUI() {
    const s = state.settings;
    document.getElementById('sidebarEngineerName').textContent = s.engineerName;
    document.getElementById('sidebarDepartment').textContent = s.department;
    document.getElementById('settingCompany').value = s.company;
    document.getElementById('settingDepartment').value = s.department;
    document.getElementById('settingEngineerName').value = s.engineerName;
    document.getElementById('settingDesignation').value = s.designation;
    document.getElementById('settingSupervisor').value = s.supervisor;
  }

  function populateCategorySelects() {
    const cats = state.settings.categories || DEFAULT_CATEGORIES;
    const taskCatSelect = document.getElementById('taskCategory');
    const filterCatSelect = document.getElementById('taskFilterCategory');

    if (taskCatSelect) {
      taskCatSelect.innerHTML = cats
        .map((c) => `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`)
        .join('');
    }
    if (filterCatSelect) {
      const currentVal = filterCatSelect.value || 'all';
      filterCatSelect.innerHTML =
        `<option value="all">All Categories</option>` +
        cats.map((c) => `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join('');
      filterCatSelect.value = currentVal;
    }

    const tagsContainer = document.getElementById('categoriesTagsList');
    if (tagsContainer) {
      tagsContainer.innerHTML = cats
        .map(
          (c) => `
          <span class="cat-tag">
            ${escapeHTML(c)}
            <button type="button" data-del-cat="${escapeHTML(c)}" title="Remove Category">&times;</button>
          </span>`
        )
        .join('');
    }
  }

  function renderAll() {
    renderHeaderDate();
    renderDashboard();
    renderTasksList();
    renderMonitoringList();
    renderWorkUpdatesList();
    renderPendingList();
    renderReportPreview();
  }

  function renderHeaderDate() {
    const now = new Date();
    const formatted = now.toLocaleDateString('en-GB', {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      year: 'numeric'
    });
    document.getElementById('currentDateDisplay').textContent = formatted;
  }

  // -------------------- 1. DASHBOARD RENDER --------------------
  function renderDashboard() {
    const t = todayISO();
    const total = state.tasks.length;
    const completed = state.tasks.filter((x) => x.status === 'Completed').length;
    const completedToday = state.tasks.filter(
      (x) => x.status === 'Completed' && (x.completedDate === t || x.deadline === t)
    ).length;
    const inProgress = state.tasks.filter((x) => x.status === 'In Progress').length;
    const pending = state.tasks.filter((x) => x.status === 'Pending' || x.status === 'On Hold').length;
    const overdue = state.tasks.filter(
      (x) => x.status !== 'Completed' && daysDiffFromToday(x.deadline) < 0
    ).length;
    const monCount =
      state.monitoring.filter((m) => m.status !== 'Completed').length +
      state.tasks.filter((x) => x.executionType === 'monitoring' && x.status !== 'Completed').length;

    document.getElementById('statTotalTasks').textContent = total;
    document.getElementById('statCompletedTasks').textContent = completed;
    document.getElementById('statCompletedToday').textContent = completedToday;
    document.getElementById('statInProgressTasks').textContent = inProgress;
    document.getElementById('statPendingTasks').textContent = pending;
    document.getElementById('statOverdueTasks').textContent = overdue;
    document.getElementById('statMonitoringCount').textContent = monCount;
    document.getElementById('navPendingBadge').textContent = pending;

    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
    document.getElementById('completionRateBadge').textContent = `${pct}% Complete`;
    document.getElementById('overallProgressBar').style.width = `${pct}%`;

    // Priority Distribution Visual Chart
    const activeTasks = state.tasks.filter((x) => x.status !== 'Completed');
    const activeTotal = activeTasks.length || 1;
    const prioCounts = {
      Critical: activeTasks.filter((x) => x.priority === 'Critical').length,
      High: activeTasks.filter((x) => x.priority === 'High').length,
      Medium: activeTasks.filter((x) => x.priority === 'Medium').length,
      Low: activeTasks.filter((x) => x.priority === 'Low').length
    };
    const prioColors = {
      Critical: '#dc2626',
      High: '#d97706',
      Medium: '#4f46e5',
      Low: '#64748b'
    };

    document.getElementById('priorityDistributionChart').innerHTML = Object.keys(prioCounts)
      .map((p) => {
        const count = prioCounts[p];
        const widthPct = Math.round((count / activeTotal) * 100);
        return `
          <div class="p-bar-row">
            <span class="p-bar-label">${p}</span>
            <div class="p-bar-track">
              <div class="p-bar-fill" style="width:${widthPct}%; background:${prioColors[p]}"></div>
            </div>
            <span class="p-bar-count">${count}</span>
          </div>
        `;
      })
      .join('');

    // Smart Priority Recommendation Engine
    const executableCandidates = activeTasks
      .slice()
      .sort((a, b) => calculateTaskPriorityScore(b) - calculateTaskPriorityScore(a));

    const topTask = executableCandidates[0];
    const recTitleEl = document.getElementById('recTaskTitle');
    const recExpEl = document.getElementById('recTaskExplanation');
    const recTagEl = document.getElementById('recReasonTag');
    const recActionsEl = document.getElementById('recActionButtons');

    if (topTask) {
      recTitleEl.textContent = `Recommended Next Task: ${topTask.title}`;
      recTagEl.textContent = buildRecommendationReason(topTask);
      recExpEl.textContent = `Area: ${topTask.area} (${topTask.category}) • Status: ${topTask.status} • Deadline: ${formatDateReadable(topTask.deadline)}. ${topTask.remarks || ''}`;
      recActionsEl.innerHTML = `
        <button class="btn btn-sm" style="background:#ffffff;color:#0f4c81;" data-quick-complete="${escapeHTML(topTask.id)}">Mark Completed</button>
        <button class="btn btn-sm btn-outline" style="color:#ffffff;border-color:rgba(255,255,255,0.4);" data-edit-task="${escapeHTML(topTask.id)}">Open / Edit Task</button>
      `;
    } else {
      recTitleEl.textContent = 'All Engineering Tasks Completed!';
      recTagEl.textContent = 'Queue Clear';
      recExpEl.textContent = 'No pending or overdue direct execution tasks remaining. Review routine utility monitoring logs.';
      recActionsEl.innerHTML = '';
    }

    // Smart Priority Buckets
    const buckets = {
      doFirst: [],
      doToday: [],
      upcoming: [],
      followup: [],
      monitoring: []
    };

    activeTasks.forEach((task) => {
      const b = classifyTaskSmartBucket(task);
      if (buckets[b]) buckets[b].push(task);
    });

    Object.keys(buckets).forEach((k) => {
      buckets[k].sort((a, b) => calculateTaskPriorityScore(b) - calculateTaskPriorityScore(a));
    });

    document.getElementById('countDoFirst').textContent = buckets.doFirst.length;
    document.getElementById('countDoToday').textContent = buckets.doToday.length;
    document.getElementById('countUpcoming').textContent = buckets.upcoming.length;
    document.getElementById('countFollowup').textContent = buckets.followup.length;
    document.getElementById('countBucketMon').textContent =
      buckets.monitoring.length + state.monitoring.filter((m) => m.status !== 'Completed').length;

    const currentBucketItems = buckets[state.activeDashboardBucket] || [];
    const bucketListEl = document.getElementById('dashboardBucketList');

    if (state.activeDashboardBucket === 'monitoring' && currentBucketItems.length === 0 && state.monitoring.length > 0) {
      bucketListEl.innerHTML = state.monitoring
        .slice(0, 4)
        .map(
          (m) => `
          <div class="compact-item">
            <div class="compact-item-main">
              <strong>[Site Monitor] ${escapeHTML(m.projectName)}</strong>
              <span>${escapeHTML(m.location)} • ${escapeHTML(m.contractor)} • ${m.progress}% (${escapeHTML(m.status)})</span>
            </div>
            <span class="badge badge-teal">Follow-up: ${formatDateReadable(m.followupDate)}</span>
          </div>`
        )
        .join('');
    } else if (currentBucketItems.length === 0) {
      bucketListEl.innerHTML = `<div class="empty-state">No tasks in this smart priority bucket.</div>`;
    } else {
      bucketListEl.innerHTML = currentBucketItems
        .slice(0, 5)
        .map(
          (item) => `
          <div class="compact-item">
            <div class="compact-item-main">
              <strong>${escapeHTML(item.title)}</strong>
              <span>${escapeHTML(item.area)} • ${escapeHTML(item.category)} • Due: ${formatDateReadable(item.deadline)}</span>
            </div>
            <span class="badge badge-${item.priority.toLowerCase()}">${escapeHTML(item.priority)}</span>
          </div>`
        )
        .join('');
    }

    // Upcoming Deadlines
    const upcomingSorted = activeTasks
      .slice()
      .sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999'))
      .slice(0, 5);

    const deadlinesEl = document.getElementById('upcomingDeadlinesList');
    if (upcomingSorted.length === 0) {
      deadlinesEl.innerHTML = `<div class="empty-state">No upcoming deadlines.</div>`;
    } else {
      deadlinesEl.innerHTML = upcomingSorted
        .map((item) => {
          const diff = daysDiffFromToday(item.deadline);
          const tag =
            diff < 0
              ? `<span class="badge badge-critical">Overdue (${Math.abs(diff)}d)</span>`
              : diff === 0
              ? `<span class="badge badge-high">Due Today</span>`
              : `<span class="badge badge-primary">${formatDateReadable(item.deadline)}</span>`;
          return `
            <div class="compact-item">
              <div class="compact-item-main">
                <strong>${escapeHTML(item.title)}</strong>
                <span>${escapeHTML(item.area)} • ${escapeHTML(item.status)}</span>
              </div>
              ${tag}
            </div>`;
        })
        .join('');
    }

    // Today's Completed & Recently Updated
    const recentList = state.tasks
      .slice()
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
      .slice(0, 5);

    const recentEl = document.getElementById('recentUpdatedList');
    if (recentList.length === 0) {
      recentEl.innerHTML = `<div class="empty-state">No task activity recorded yet.</div>`;
    } else {
      recentEl.innerHTML = recentList
        .map(
          (item) => `
          <div class="compact-item">
            <div class="compact-item-main">
              <strong>${escapeHTML(item.title)}</strong>
              <span>${escapeHTML(item.category)} • ${escapeHTML(item.area)}</span>
            </div>
            <span class="badge ${item.status === 'Completed' ? 'badge-completed' : 'badge-progress'}">${escapeHTML(item.status)}</span>
          </div>`
        )
        .join('');
    }
  }

  // -------------------- 2. MY TASKS RENDER --------------------
  function renderTasksList() {
    const query = (document.getElementById('taskSearchInput').value || '').toLowerCase().trim();
    const bucketFilter = document.getElementById('taskFilterBucket').value;
    const statusFilter = document.getElementById('taskFilterStatus').value;
    const prioFilter = document.getElementById('taskFilterPriority').value;
    const catFilter = document.getElementById('taskFilterCategory').value;

    const filtered = state.tasks
      .filter((task) => {
        if (query) {
          const hay = `${task.title} ${task.description} ${task.area} ${task.category} ${task.assigned} ${task.remarks}`.toLowerCase();
          if (!hay.includes(query)) return false;
        }
        if (bucketFilter !== 'all' && classifyTaskSmartBucket(task) !== bucketFilter) {
          return false;
        }
        if (statusFilter === 'Overdue') {
          if (task.status === 'Completed' || daysDiffFromToday(task.deadline) >= 0) return false;
        } else if (statusFilter !== 'all' && task.status !== statusFilter) {
          return false;
        }
        if (prioFilter !== 'all' && task.priority !== prioFilter) return false;
        if (catFilter !== 'all' && task.category !== catFilter) return false;
        return true;
      })
      .sort((a, b) => calculateTaskPriorityScore(b) - calculateTaskPriorityScore(a));

    const container = document.getElementById('tasksContainer');
    if (filtered.length === 0) {
      container.innerHTML = `<div class="card empty-state">No matching engineering tasks found. Click "+ Add Task" to create one.</div>`;
      return;
    }

    const bucketLabels = {
      doFirst: '1. Do First',
      doToday: '2. Do Today',
      upcoming: '3. Upcoming',
      followup: '4. Pending Follow-up',
      monitoring: '5. Monitoring',
      completed: 'Completed'
    };

    container.innerHTML = filtered
      .map((task) => {
        const diff = daysDiffFromToday(task.deadline);
        const isOverdue = task.status !== 'Completed' && diff < 0;
        const smartBucket = classifyTaskSmartBucket(task);

        return `
          <article class="item-card ${isOverdue ? 'overdue-card' : ''}">
            <div class="item-card-top">
              <div>
                <h4 class="item-title">${escapeHTML(task.title)}</h4>
              </div>
              <span class="badge badge-primary">${escapeHTML(bucketLabels[smartBucket] || smartBucket)}</span>
            </div>
            <div class="badges-wrap">
              <span class="badge badge-${task.priority.toLowerCase()}">${escapeHTML(task.priority)} Priority</span>
              <span class="badge ${task.status === 'Completed' ? 'badge-completed' : task.status === 'Pending' ? 'badge-pending' : 'badge-progress'}">${escapeHTML(task.status)}</span>
              <span class="badge badge-teal">${escapeHTML(task.category)}</span>
              ${isOverdue ? `<span class="badge badge-critical">OVERDUE (${Math.abs(diff)}d)</span>` : ''}
              ${task.isBlocking ? `<span class="badge badge-high">Blocking Dependency</span>` : ''}
            </div>
            ${task.description ? `<p class="item-desc">${escapeHTML(task.description)}</p>` : ''}
            <div class="item-meta">
              <div><strong>Area:</strong> ${escapeHTML(task.area)}</div>
              <div><strong>Assigned:</strong> ${escapeHTML(task.assigned || 'Self')}</div>
              <div><strong>Created:</strong> ${formatDateReadable(task.createdDate)}</div>
              <div><strong>Deadline:</strong> ${formatDateReadable(task.deadline)}</div>
              ${task.pendingReason ? `<div><strong>Pending Reason:</strong> ${escapeHTML(task.pendingReason)}</div>` : ''}
              ${task.remarks ? `<div><strong>Remarks:</strong> ${escapeHTML(task.remarks)}</div>` : ''}
              ${task.attachmentName ? `<div><strong>Attachment:</strong> ${escapeHTML(task.attachmentName)}</div>` : ''}
            </div>
            <div class="item-actions">
              ${
                task.status !== 'Completed'
                  ? `<button class="btn btn-success btn-sm" data-quick-complete="${escapeHTML(task.id)}">✓ Complete</button>`
                  : `<button class="btn btn-outline btn-sm" data-reopen-task="${escapeHTML(task.id)}">Reopen</button>`
              }
              <button class="btn btn-outline btn-sm" data-edit-task="${escapeHTML(task.id)}">Edit</button>
              <button class="btn btn-danger btn-sm" data-delete-task="${escapeHTML(task.id)}">Delete</button>
            </div>
          </article>
        `;
      })
      .join('');
  }

  // -------------------- 3. WORK MONITORING RENDER --------------------
  function renderMonitoringList() {
    const query = (document.getElementById('monitoringSearchInput').value || '').toLowerCase().trim();
    const statusFilter = document.getElementById('monitoringFilterStatus').value;

    const filtered = state.monitoring.filter((m) => {
      if (query) {
        const hay = `${m.projectName} ${m.location} ${m.contractor} ${m.description} ${m.observation} ${m.problems}`.toLowerCase();
        if (!hay.includes(query)) return false;
      }
      if (statusFilter !== 'all' && m.status !== statusFilter) return false;
      return true;
    });

    const container = document.getElementById('monitoringContainer');
    if (filtered.length === 0) {
      container.innerHTML = `<div class="card empty-state">No work monitoring records found. Click "+ New Monitored Work" to log contractor or technician activities.</div>`;
      return;
    }

    container.innerHTML = filtered
      .map((m) => {
        const historyHTML =
          m.history && m.history.length > 0
            ? `<div class="mon-timeline">
                <strong>Previous Inspection Logs (${m.history.length}):</strong>
                ${m.history
                  .slice()
                  .reverse()
                  .map(
                    (h) => `
                    <div class="mon-timeline-item">
                      <strong>${formatDateReadable(h.date)} — ${h.progress}% (${escapeHTML(h.status)})</strong>: ${escapeHTML(h.observation)}
                      ${h.problems ? `<br><em>Issue:</em> ${escapeHTML(h.problems)}` : ''}
                      ${h.action ? ` | <em>Action:</em> ${escapeHTML(h.action)}` : ''}
                    </div>`
                  )
                  .join('')}
              </div>`
            : '';

        return `
          <article class="item-card">
            <div class="item-card-top">
              <div>
                <h4 class="item-title">${escapeHTML(m.projectName)}</h4>
                <small class="text-muted">${escapeHTML(m.location)} • Contractor/Resp: <strong>${escapeHTML(m.contractor)}</strong></small>
              </div>
              <span class="badge ${m.status === 'Completed' ? 'badge-completed' : m.status === 'Correction Required' ? 'badge-critical' : 'badge-teal'}">${escapeHTML(m.status)} (${m.progress}%)</span>
            </div>

            <div class="progress-bar-outer" style="height:8px;margin:8px 0;">
              <div class="progress-bar-inner" style="width:${m.progress}%"></div>
            </div>

            ${m.description ? `<p class="item-desc"><strong>Scope:</strong> ${escapeHTML(m.description)}</p>` : ''}
            <div class="item-meta">
              <div><strong>Last Inspected:</strong> ${formatDateReadable(m.monitoringDate)}</div>
              <div><strong>Next Follow-up:</strong> ${formatDateReadable(m.followupDate)}</div>
              <div><strong>Observation:</strong> ${escapeHTML(m.observation)}</div>
              ${m.problems ? `<div><strong>Problems/Issues:</strong> <span style="color:var(--danger)">${escapeHTML(m.problems)}</span></div>` : ''}
              ${m.action ? `<div><strong>Required Action:</strong> ${escapeHTML(m.action)}</div>` : ''}
              ${m.remarks ? `<div><strong>Remarks:</strong> ${escapeHTML(m.remarks)}</div>` : ''}
            </div>
            ${historyHTML}
            <div class="item-actions">
              <button class="btn btn-primary btn-sm" data-add-mon-log="${escapeHTML(m.id)}">+ Log Progress Update</button>
              <button class="btn btn-outline btn-sm" data-edit-mon="${escapeHTML(m.id)}">Edit</button>
              <button class="btn btn-danger btn-sm" data-delete-mon="${escapeHTML(m.id)}">Delete</button>
            </div>
          </article>
        `;
      })
      .join('');
  }

  // -------------------- 4. DAILY WORK UPDATES RENDER --------------------
  function renderWorkUpdatesList() {
    const filterDate = document.getElementById('filterUpdateDate').value;
    const list = state.updates
      .filter((u) => (!filterDate ? true : u.date === filterDate))
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    const container = document.getElementById('workUpdatesList');
    if (list.length === 0) {
      container.innerHTML = `<div class="empty-state">No daily work updates found for the selected filter.</div>`;
      return;
    }

    container.innerHTML = list
      .map(
        (u) => `
        <article class="item-card">
          <div class="item-card-top">
            <strong>${formatDateReadable(u.date)}</strong>
            <span class="badge badge-primary">${escapeHTML(u.shift || 'Daily Log')}</span>
          </div>
          <div class="item-meta" style="grid-template-columns:1fr;">
            <div><strong>Completed:</strong><br>${escapeHTML(u.completed).replace(/\n/g, '<br>')}</div>
            ${u.ongoing ? `<div><strong>Ongoing:</strong><br>${escapeHTML(u.ongoing).replace(/\n/g, '<br>')}</div>` : ''}
            ${u.monitoring ? `<div><strong>Monitoring:</strong><br>${escapeHTML(u.monitoring).replace(/\n/g, '<br>')}</div>` : ''}
            ${u.pending ? `<div><strong>Pending:</strong><br>${escapeHTML(u.pending).replace(/\n/g, '<br>')}</div>` : ''}
            ${u.problems ? `<div><strong>Problems/Observations:</strong><br>${escapeHTML(u.problems).replace(/\n/g, '<br>')}</div>` : ''}
            ${u.remarks ? `<div><strong>Remarks:</strong> ${escapeHTML(u.remarks)}</div>` : ''}
          </div>
          <div class="item-actions">
            <button class="btn btn-outline btn-sm" data-edit-update="${escapeHTML(u.id)}">Edit</button>
            <button class="btn btn-danger btn-sm" data-delete-update="${escapeHTML(u.id)}">Delete</button>
          </div>
        </article>`
      )
      .join('');
  }

  // -------------------- 5. PENDING WORK RENDER --------------------
  function renderPendingList() {
    const query = (document.getElementById('pendingSearchInput').value || '').toLowerCase().trim();
    const overdueOnly = document.getElementById('pendingFilterOverdue').value === 'overdue';

    // Combine Pending Tasks + Waiting Monitoring items
    const pendingTasks = state.tasks.filter(
      (t) => t.status === 'Pending' || t.status === 'On Hold' || t.executionType === 'followup'
    );

    const filtered = pendingTasks.filter((t) => {
      if (query) {
        const hay = `${t.title} ${t.pendingReason} ${t.assigned} ${t.area} ${t.category}`.toLowerCase();
        if (!hay.includes(query)) return false;
      }
      const fDate = t.followupDate || t.deadline;
      const isOverdue = daysDiffFromToday(fDate) < 0;
      if (overdueOnly && !isOverdue) return false;
      return true;
    });

    const container = document.getElementById('pendingListContainer');
    if (filtered.length === 0) {
      container.innerHTML = `<div class="card empty-state">No pending or blocked tasks found.</div>`;
      return;
    }

    container.innerHTML = filtered
      .map((t) => {
        const fDate = t.followupDate || t.deadline;
        const diff = daysDiffFromToday(fDate);
        const isOverdue = diff < 0;

        return `
          <article class="item-card ${isOverdue ? 'overdue-card' : ''}">
            <div class="item-card-top">
              <h4 class="item-title">${escapeHTML(t.title)}</h4>
              ${
                isOverdue
                  ? `<span class="badge badge-critical">Follow-up Overdue (${Math.abs(diff)}d)</span>`
                  : `<span class="badge badge-pending">${escapeHTML(t.status)}</span>`
              }
            </div>
            <div class="item-meta">
              <div><strong>Reason for Pending:</strong> ${escapeHTML(t.pendingReason || 'Awaiting clearance / spares')}</div>
              <div><strong>Responsible Person:</strong> ${escapeHTML(t.assigned || 'Unassigned')}</div>
              <div><strong>Pending Since:</strong> ${formatDateReadable(t.createdDate)}</div>
              <div><strong>Next Follow-up Date:</strong> ${formatDateReadable(fDate)}</div>
              <div><strong>Area / Category:</strong> ${escapeHTML(t.area)} (${escapeHTML(t.category)})</div>
              <div><strong>Current Status:</strong> ${escapeHTML(t.status)}</div>
            </div>
            <div class="item-actions">
              <button class="btn btn-primary btn-sm" data-activate-pending="${escapeHTML(t.id)}">Convert to Active (In Progress)</button>
              <button class="btn btn-success btn-sm" data-quick-complete="${escapeHTML(t.id)}">Mark Completed</button>
              <button class="btn btn-outline btn-sm" data-edit-task="${escapeHTML(t.id)}">Update Details</button>
            </div>
          </article>
        `;
      })
      .join('');
  }

  // -------------------- 6. PROFESSIONAL A4 REPORT GENERATOR --------------------
  function renderReportPreview() {
    const startStr = document.getElementById('reportStartDate').value || todayISO();
    const endStr = document.getElementById('reportEndDate').value || todayISO();
    const reportTitle =
      document.getElementById('reportCustomTitle').value || 'Engineering Work & Monitoring Report';
    const obsOverride = document.getElementById('reportObservationsInput').value.trim();
    const nextPlanOverride = document.getElementById('reportNextPlanInput').value.trim();

    const inRange = (dStr) => {
      if (!dStr) return true;
      return dStr >= startStr && dStr <= endStr;
    };

    const completedTasks = state.tasks.filter(
      (t) => t.status === 'Completed' && (inRange(t.completedDate) || inRange(t.deadline) || inRange(t.createdDate))
    );
    const ongoingTasks = state.tasks.filter((t) => t.status === 'In Progress' || t.status === 'Not Started');
    const pendingTasks = state.tasks.filter((t) => t.status === 'Pending' || t.status === 'On Hold');
    const periodUpdates = state.updates.filter((u) => inRange(u.date));
    const monitoringRecords = state.monitoring;

    // Synthesize Observations & Next Action Plan
    let observationsList = [];
    if (obsOverride) observationsList.push(obsOverride);
    periodUpdates.forEach((u) => {
      if (u.problems) observationsList.push(`[${formatDateReadable(u.date)}] ${u.problems}`);
    });
    monitoringRecords.forEach((m) => {
      if (m.problems) observationsList.push(`[${m.projectName}] ${m.problems}`);
    });

    let nextPlanList = [];
    if (nextPlanOverride) nextPlanList.push(nextPlanOverride);
    ongoingTasks.slice(0, 5).forEach((t) => {
      nextPlanList.push(`Complete ${t.title} (${t.area}) — Target: ${formatDateReadable(t.deadline)}`);
    });
    monitoringRecords
      .filter((m) => m.status !== 'Completed')
      .forEach((m) => {
        if (m.action) nextPlanList.push(`Follow up ${m.projectName}: ${m.action}`);
      });

    const periodLabel =
      startStr === endStr
        ? formatDateReadable(startStr)
        : `${formatDateReadable(startStr)} to ${formatDateReadable(endStr)}`;

    const s = state.settings;
    const sheet = document.getElementById('a4ReportSheet');

    sheet.innerHTML = `
      <div class="rep-header">
        <div class="rep-company">${escapeHTML(s.company)}</div>
        <div class="rep-dept">${escapeHTML(s.department)}</div>
        <div class="rep-title">${escapeHTML(reportTitle)}</div>
      </div>

      <table class="rep-meta-table">
        <tr>
          <td><strong>Prepared By:</strong> ${escapeHTML(s.engineerName)} (${escapeHTML(s.designation)})</td>
          <td><strong>Reporting Period:</strong> ${escapeHTML(periodLabel)}</td>
        </tr>
        <tr>
          <td><strong>Submitted To:</strong> ${escapeHTML(s.supervisor)}</td>
          <td><strong>Generation Date:</strong> ${formatDateReadable(todayISO())}</td>
        </tr>
      </table>

      <div class="rep-kpi-row">
        <div class="rep-kpi-box">
          <strong>${completedTasks.length}</strong>
          <span>Completed</span>
        </div>
        <div class="rep-kpi-box">
          <strong>${ongoingTasks.length}</strong>
          <span>Ongoing</span>
        </div>
        <div class="rep-kpi-box">
          <strong>${pendingTasks.length}</strong>
          <span>Pending</span>
        </div>
        <div class="rep-kpi-box">
          <strong>${monitoringRecords.length}</strong>
          <span>Monitored Projects</span>
        </div>
        <div class="rep-kpi-box">
          <strong>${periodUpdates.length}</strong>
          <span>Daily Logs</span>
        </div>
      </div>

      <div class="rep-section-title">1. Completed Engineering Works</div>
      <table class="rep-table">
        <thead>
          <tr>
            <th style="width:6%">SL</th>
            <th style="width:36%">Task / Activity Description</th>
            <th style="width:22%">Area / Category</th>
            <th style="width:16%">Date</th>
            <th style="width:20%">Remarks</th>
          </tr>
        </thead>
        <tbody>
          ${
            completedTasks.length === 0
              ? `<tr><td colspan="5">No completed tasks recorded in this date range.</td></tr>`
              : completedTasks
                  .map(
                    (t, i) => `
                  <tr>
                    <td>${i + 1}</td>
                    <td><strong>${escapeHTML(t.title)}</strong>${t.description ? `<br>${escapeHTML(t.description)}` : ''}</td>
                    <td>${escapeHTML(t.area)}<br><small>${escapeHTML(t.category)}</small></td>
                    <td>${formatDateReadable(t.completedDate || t.deadline)}</td>
                    <td>${escapeHTML(t.remarks || 'Completed satisfactorily')}</td>
                  </tr>`
                  )
                  .join('')
          }
        </tbody>
      </table>

      <div class="rep-section-title">2. Ongoing & Scheduled Engineering Tasks</div>
      <table class="rep-table">
        <thead>
          <tr>
            <th style="width:6%">SL</th>
            <th style="width:36%">Task Title</th>
            <th style="width:22%">Area / Category</th>
            <th style="width:16%">Priority & Target</th>
            <th style="width:20%">Current Status / Notes</th>
          </tr>
        </thead>
        <tbody>
          ${
            ongoingTasks.length === 0
              ? `<tr><td colspan="5">No active ongoing tasks at present.</td></tr>`
              : ongoingTasks
                  .map(
                    (t, i) => `
                  <tr>
                    <td>${i + 1}</td>
                    <td><strong>${escapeHTML(t.title)}</strong></td>
                    <td>${escapeHTML(t.area)} (${escapeHTML(t.category)})</td>
                    <td>${escapeHTML(t.priority)}<br>${formatDateReadable(t.deadline)}</td>
                    <td>${escapeHTML(t.status)}${t.remarks ? ` — ${escapeHTML(t.remarks)}` : ''}</td>
                  </tr>`
                  )
                  .join('')
          }
        </tbody>
      </table>

      <div class="rep-section-title">3. Work Monitoring & Contractor Supervision</div>
      <table class="rep-table">
        <thead>
          <tr>
            <th style="width:6%">SL</th>
            <th style="width:28%">Project / Work Name</th>
            <th style="width:20%">Location & Contractor</th>
            <th style="width:14%">Progress</th>
            <th style="width:32%">Observation & Action Required</th>
          </tr>
        </thead>
        <tbody>
          ${
            monitoringRecords.length === 0
              ? `<tr><td colspan="5">No active monitoring records.</td></tr>`
              : monitoringRecords
                  .map(
                    (m, i) => `
                  <tr>
                    <td>${i + 1}</td>
                    <td><strong>${escapeHTML(m.projectName)}</strong></td>
                    <td>${escapeHTML(m.location)}<br><small>${escapeHTML(m.contractor)}</small></td>
                    <td><strong>${m.progress}%</strong><br>${escapeHTML(m.status)}</td>
                    <td>${escapeHTML(m.observation)}${m.action ? `<br><strong>Action:</strong> ${escapeHTML(m.action)}` : ''}</td>
                  </tr>`
                  )
                  .join('')
          }
        </tbody>
      </table>

      <div class="rep-section-title">4. Pending Tasks & Follow-up Requirements</div>
      <table class="rep-table">
        <thead>
          <tr>
            <th style="width:6%">SL</th>
            <th style="width:32%">Pending Item</th>
            <th style="width:28%">Reason for Pending</th>
            <th style="width:18%">Responsible</th>
            <th style="width:16%">Follow-up Date</th>
          </tr>
        </thead>
        <tbody>
          ${
            pendingTasks.length === 0
              ? `<tr><td colspan="5">No pending tasks awaiting follow-up.</td></tr>`
              : pendingTasks
                  .map(
                    (p, i) => `
                  <tr>
                    <td>${i + 1}</td>
                    <td><strong>${escapeHTML(p.title)}</strong> (${escapeHTML(p.area)})</td>
                    <td>${escapeHTML(p.pendingReason || 'Awaiting material/clearance')}</td>
                    <td>${escapeHTML(p.assigned || 'N/A')}</td>
                    <td>${formatDateReadable(p.followupDate || p.deadline)}</td>
                  </tr>`
                  )
                  .join('')
          }
        </tbody>
      </table>

      <div class="rep-section-title">5. Important Technical Observations & Next Action Plan</div>
      <table class="rep-table">
        <thead>
          <tr>
            <th style="width:50%">Key Observations / Issues</th>
            <th style="width:50%">Next Action Plan</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              ${
                observationsList.length === 0
                  ? 'All monitored plant utility systems operating within normal parameters.'
                  : observationsList.map((o) => `• ${escapeHTML(o)}`).join('<br>')
              }
            </td>
            <td>
              ${
                nextPlanList.length === 0
                  ? 'Continue routine preventive maintenance and utility parameter monitoring.'
                  : nextPlanList.map((n) => `• ${escapeHTML(n)}`).join('<br>')
              }
            </td>
          </tr>
        </tbody>
      </table>

      <div class="rep-signatures">
        <div class="rep-sig-block">
          <strong>${escapeHTML(s.engineerName)}</strong><br>
          <span>Prepared By</span>
        </div>
        <div class="rep-sig-block">
          <strong>${escapeHTML(s.supervisor)}</strong><br>
          <span>Reviewed & Approved By</span>
        </div>
      </div>
    `;
  }

  // ==================== NAVIGATION & MODAL HANDLERS ====================
  function switchView(viewName) {
    state.currentView = viewName;
    document.querySelectorAll('.view-section').forEach((sec) => {
      sec.classList.toggle('active', sec.id === `view-${viewName}`);
    });
    document.querySelectorAll('[data-view]').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-view') === viewName);
    });

    const titles = {
      dashboard: 'Engineering Dashboard',
      tasks: 'My Engineering Tasks & Priorities',
      monitoring: 'Contractor & Site Work Monitoring',
      updates: 'Daily Engineering Work Log',
      pending: 'Pending Work & Follow-ups',
      reports: 'Official Work Report Generator',
      settings: 'Settings & Local Database Backup'
    };
    document.getElementById('pageTitle').textContent = titles[viewName] || 'Dashboard';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openModal(id) {
    document.getElementById(id).classList.remove('hidden');
  }

  function closeModal(id) {
    document.getElementById(id).classList.add('hidden');
  }

  function openTaskModalForCreate(defaultStatus = 'Not Started', defaultExec = 'direct') {
    document.getElementById('taskForm').reset();
    document.getElementById('taskId').value = '';
    document.getElementById('taskModalTitle').textContent = 'Add Engineering Task';
    document.getElementById('taskCreatedDate').value = todayISO();
    document.getElementById('taskDeadline').value = todayISO();
    document.getElementById('taskStatus').value = defaultStatus;
    document.getElementById('taskExecutionType').value = defaultExec;
    document.getElementById('taskAttachmentCurrent').textContent = '';
    openModal('taskModal');
  }

  function openTaskModalForEdit(taskId) {
    const task = state.tasks.find((t) => t.id === taskId);
    if (!task) return;
    document.getElementById('taskModalTitle').textContent = 'Edit Engineering Task';
    document.getElementById('taskId').value = task.id;
    document.getElementById('taskTitle').value = task.title;
    document.getElementById('taskCategory').value = task.category;
    document.getElementById('taskArea').value = task.area;
    document.getElementById('taskPriority').value = task.priority;
    document.getElementById('taskStatus').value = task.status;
    document.getElementById('taskExecutionType').value = task.executionType || 'direct';
    document.getElementById('taskCreatedDate').value = task.createdDate || todayISO();
    document.getElementById('taskDeadline').value = task.deadline || todayISO();
    document.getElementById('taskAssigned').value = task.assigned || '';
    document.getElementById('taskIsBlocking').checked = Boolean(task.isBlocking);
    document.getElementById('taskPendingReason').value = task.pendingReason || '';
    document.getElementById('taskFollowupDate').value = task.followupDate || '';
    document.getElementById('taskDescription').value = task.description || '';
    document.getElementById('taskRemarks').value = task.remarks || '';
    document.getElementById('taskAttachmentCurrent').textContent = task.attachmentName
      ? `Attached: ${task.attachmentName}`
      : '';
    openModal('taskModal');
  }

  // ==================== EXPORT PDF & PNG HANDLERS ====================
  async function exportReportAsImage() {
    const sheet = document.getElementById('a4ReportSheet');
    if (typeof window.html2canvas === 'undefined') {
      showToast('Offline or CDN unavailable: Using browser Print dialog instead.');
      window.print();
      return;
    }
    try {
      showToast('Generating high-resolution PNG report...');
      const canvas = await window.html2canvas(sheet, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
      const link = document.createElement('a');
      link.download = `IBN_SINA_Engineering_Report_${todayISO()}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
      showToast('PNG Report downloaded successfully.');
    } catch (err) {
      showToast('Error generating PNG. Try Print / Save as PDF.');
    }
  }

  async function exportReportAsPDF() {
    const sheet = document.getElementById('a4ReportSheet');
    if (typeof window.html2canvas === 'undefined' || typeof window.jspdf === 'undefined') {
      showToast('Using native Print-to-PDF dialog...');
      window.print();
      return;
    }
    try {
      showToast('Generating A4 PDF document...');
      const canvas = await window.html2canvas(sheet, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
      const imgData = canvas.toDataURL('image/jpeg', 0.95);
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageWidth = 210;
      const pageHeight = 297;
      const imgWidth = pageWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;

      let heightLeft = imgHeight;
      let position = 0;

      pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;

      while (heightLeft > 5) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }

      pdf.save(`IBN_SINA_Engineering_Report_${todayISO()}.pdf`);
      showToast('PDF Report downloaded successfully.');
    } catch (err) {
      showToast('PDF library fallback: Opening print dialog.');
      window.print();
    }
  }

  // ==================== EVENT LISTENERS INITIALIZATION ====================
  function bindEvents() {
    // Navigation clicks
    document.querySelectorAll('[data-view]').forEach((btn) => {
      btn.addEventListener('click', () => switchView(btn.getAttribute('data-view')));
    });

    // KPI Card clicks
    document.querySelectorAll('.kpi-card[data-goto]').forEach((card) => {
      card.addEventListener('click', () => {
        const target = card.getAttribute('data-goto');
        const filter = card.getAttribute('data-filter');
        if (target === 'tasks' && filter) {
          document.getElementById('taskFilterStatus').value = filter;
          document.getElementById('taskFilterBucket').value = 'all';
          renderTasksList();
        }
        switchView(target);
      });
    });

    // Smart Bucket Tabs on Dashboard
    document.querySelectorAll('#dashboardBucketTabs .bucket-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('#dashboardBucketTabs .bucket-tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        state.activeDashboardBucket = tab.getAttribute('data-bucket');
        renderDashboard();
      });
    });

    // Theme Toggle
    document.getElementById('themeToggleBtn').addEventListener('click', async () => {
      const next = state.settings.theme === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      await dbPut('settings', state.settings);
      showToast(`Switched to ${next} mode`);
    });

    // Modal Open/Close
    document.getElementById('quickAddTaskBtn').addEventListener('click', () => openTaskModalForCreate());
    document.getElementById('openNewTaskModalBtn').addEventListener('click', () => openTaskModalForCreate());
    document.getElementById('openNewPendingBtn').addEventListener('click', () =>
      openTaskModalForCreate('Pending', 'followup')
    );

    document.getElementById('openNewMonitoringBtn').addEventListener('click', () => {
      document.getElementById('monitoringForm').reset();
      document.getElementById('monId').value = '';
      document.getElementById('monitoringModalTitle').textContent = 'New Work Monitoring Record';
      document.getElementById('monDate').value = todayISO();
      document.getElementById('monFollowupDate').value = addDaysISO(todayISO(), 1);
      document.getElementById('monProgressVal').textContent = '50';
      openModal('monitoringModal');
    });

    document.querySelectorAll('[data-close-modal]').forEach((btn) => {
      btn.addEventListener('click', () => closeModal(btn.getAttribute('data-close-modal')));
    });

    // Range sliders display
    document.getElementById('monProgress').addEventListener('input', (e) => {
      document.getElementById('monProgressVal').textContent = e.target.value;
    });
    document.getElementById('monLogProgress').addEventListener('input', (e) => {
      document.getElementById('monLogProgressVal').textContent = e.target.value;
    });

    // Save Task Form
    document.getElementById('taskForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const existingId = document.getElementById('taskId').value;
      const existingTask = state.tasks.find((x) => x.id === existingId);
      const fileInput = document.getElementById('taskAttachment');
      const attachmentName =
        fileInput.files && fileInput.files[0]
          ? fileInput.files[0].name
          : existingTask
          ? existingTask.attachmentName
          : '';

      const statusVal = document.getElementById('taskStatus').value;
      const taskObj = {
        id: existingId || uid('task'),
        title: document.getElementById('taskTitle').value.trim(),
        category: document.getElementById('taskCategory').value,
        area: document.getElementById('taskArea').value.trim(),
        priority: document.getElementById('taskPriority').value,
        status: statusVal,
        executionType: document.getElementById('taskExecutionType').value,
        createdDate: document.getElementById('taskCreatedDate').value || todayISO(),
        deadline: document.getElementById('taskDeadline').value || todayISO(),
        assigned: document.getElementById('taskAssigned').value.trim(),
        isBlocking: document.getElementById('taskIsBlocking').checked,
        pendingReason: document.getElementById('taskPendingReason').value.trim(),
        followupDate: document.getElementById('taskFollowupDate').value,
        description: document.getElementById('taskDescription').value.trim(),
        remarks: document.getElementById('taskRemarks').value.trim(),
        completedDate: statusVal === 'Completed' ? todayISO() : existingTask?.completedDate || '',
        attachmentName,
        updatedAt: new Date().toISOString()
      };

      await dbPut('tasks', taskObj);
      await loadAllState();
      renderAll();
      closeModal('taskModal');
      showToast(existingId ? 'Task updated.' : 'New engineering task added.');
    });

    // Save Monitoring Form
    document.getElementById('monitoringForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const existingId = document.getElementById('monId').value;
      const existingMon = state.monitoring.find((x) => x.id === existingId);

      const monObj = {
        id: existingId || uid('mon'),
        projectName: document.getElementById('monProjectName').value.trim(),
        location: document.getElementById('monLocation').value.trim(),
        contractor: document.getElementById('monContractor').value.trim(),
        monitoringDate: document.getElementById('monDate').value || todayISO(),
        followupDate: document.getElementById('monFollowupDate').value || todayISO(),
        status: document.getElementById('monStatus').value,
        progress: Number(document.getElementById('monProgress').value),
        description: document.getElementById('monDescription').value.trim(),
        observation: document.getElementById('monObservation').value.trim(),
        problems: document.getElementById('monProblems').value.trim(),
        action: document.getElementById('monAction').value.trim(),
        remarks: document.getElementById('monRemarks').value.trim(),
        history: existingMon ? existingMon.history || [] : []
      };

      await dbPut('monitoring', monObj);
      await loadAllState();
      renderAll();
      closeModal('monitoringModal');
      showToast('Work monitoring record saved.');
    });

    // Append Monitoring Inspection Log
    document.getElementById('monitoringLogForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const parentId = document.getElementById('monLogParentId').value;
      const mon = state.monitoring.find((m) => m.id === parentId);
      if (!mon) return;

      mon.history = mon.history || [];
      mon.history.push({
        date: mon.monitoringDate,
        status: mon.status,
        progress: mon.progress,
        observation: mon.observation,
        problems: mon.problems,
        action: mon.action
      });

      mon.monitoringDate = document.getElementById('monLogDate').value;
      mon.status = document.getElementById('monLogStatus').value;
      mon.progress = Number(document.getElementById('monLogProgress').value);
      mon.observation = document.getElementById('monLogObservation').value.trim();
      mon.problems = document.getElementById('monLogProblems').value.trim();
      mon.action = document.getElementById('monLogAction').value.trim();
      mon.followupDate = document.getElementById('monLogNextDate').value;

      await dbPut('monitoring', mon);
      await loadAllState();
      renderAll();
      closeModal('monitoringLogModal');
      showToast('Inspection follow-up appended to project timeline.');
    });

    // Daily Work Update Form
    document.getElementById('workUpdateForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const existingId = document.getElementById('updateId').value;
      const updObj = {
        id: existingId || uid('upd'),
        date: document.getElementById('updateDate').value || todayISO(),
        shift: document.getElementById('updateShift').value.trim() || 'General Shift',
        completed: document.getElementById('updateCompleted').value.trim(),
        ongoing: document.getElementById('updateOngoing').value.trim(),
        monitoring: document.getElementById('updateMonitoring').value.trim(),
        pending: document.getElementById('updatePending').value.trim(),
        problems: document.getElementById('updateProblems').value.trim(),
        remarks: document.getElementById('updateRemarks').value.trim()
      };

      await dbPut('updates', updObj);
      document.getElementById('workUpdateForm').reset();
      document.getElementById('updateId').value = '';
      document.getElementById('updateDate').value = todayISO();
      document.getElementById('cancelUpdateEditBtn').classList.add('hidden');
      document.getElementById('workUpdateFormTitle').textContent = 'Log Daily Work Update';
      await loadAllState();
      renderAll();
      showToast('Daily work update saved.');
    });

    // Auto-pull Today's Data into Work Update Form
    document.getElementById('autoFillUpdateBtn').addEventListener('click', () => {
      const t = todayISO();
      const done = state.tasks
        .filter((x) => x.status === 'Completed' && (x.completedDate === t || x.deadline === t))
        .map((x) => `• ${x.title} (${x.area})`)
        .join('\n');
      const ongoing = state.tasks
        .filter((x) => x.status === 'In Progress')
        .map((x) => `• ${x.title} (${x.area})`)
        .join('\n');
      const mon = state.monitoring
        .filter((m) => m.status !== 'Completed')
        .map((m) => `• ${m.projectName} (${m.progress}% - ${m.status}): ${m.observation}`)
        .join('\n');
      const pend = state.tasks
        .filter((x) => x.status === 'Pending')
        .map((x) => `• ${x.title}: ${x.pendingReason || 'Pending'}`)
        .join('\n');

      if (done) document.getElementById('updateCompleted').value = done;
      if (ongoing) document.getElementById('updateOngoing').value = ongoing;
      if (mon) document.getElementById('updateMonitoring').value = mon;
      if (pend) document.getElementById('updatePending').value = pend;
      showToast("Pulled today's tasks & monitoring into form.");
    });

    // Delegated Action Buttons (Complete, Edit, Delete, Log, Activate)
    document.body.addEventListener('click', async (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;

      if (btn.hasAttribute('data-goto')) {
        switchView(btn.getAttribute('data-goto'));
        return;
      }

      // Quick Complete Task
      if (btn.hasAttribute('data-quick-complete')) {
        const id = btn.getAttribute('data-quick-complete');
        const task = state.tasks.find((x) => x.id === id);
        if (task) {
          task.status = 'Completed';
          task.completedDate = todayISO();
          task.updatedAt = new Date().toISOString();
          await dbPut('tasks', task);
          await loadAllState();
          renderAll();
          showToast(`Completed: ${task.title}`);
        }
      }

      // Reopen Task
      if (btn.hasAttribute('data-reopen-task')) {
        const id = btn.getAttribute('data-reopen-task');
        const task = state.tasks.find((x) => x.id === id);
        if (task) {
          task.status = 'In Progress';
          task.updatedAt = new Date().toISOString();
          await dbPut('tasks', task);
          await loadAllState();
          renderAll();
          showToast('Task reopened as In Progress.');
        }
      }

      // Convert Pending to Active
      if (btn.hasAttribute('data-activate-pending')) {
        const id = btn.getAttribute('data-activate-pending');
        const task = state.tasks.find((x) => x.id === id);
        if (task) {
          task.status = 'In Progress';
          task.executionType = 'direct';
          task.updatedAt = new Date().toISOString();
          await dbPut('tasks', task);
          await loadAllState();
          renderAll();
          showToast('Converted pending task into active In Progress task.');
        }
      }

      // Edit Task
      if (btn.hasAttribute('data-edit-task')) {
        openTaskModalForEdit(btn.getAttribute('data-edit-task'));
      }

      // Delete Task
      if (btn.hasAttribute('data-delete-task')) {
        const id = btn.getAttribute('data-delete-task');
        if (confirm('Are you sure you want to delete this engineering task?')) {
          await dbDelete('tasks', id);
          await loadAllState();
          renderAll();
          showToast('Task deleted.');
        }
      }

      // Edit Monitoring
      if (btn.hasAttribute('data-edit-mon')) {
        const id = btn.getAttribute('data-edit-mon');
        const m = state.monitoring.find((x) => x.id === id);
        if (m) {
          document.getElementById('monitoringModalTitle').textContent = 'Edit Monitoring Record';
          document.getElementById('monId').value = m.id;
          document.getElementById('monProjectName').value = m.projectName;
          document.getElementById('monLocation').value = m.location;
          document.getElementById('monContractor').value = m.contractor;
          document.getElementById('monDate').value = m.monitoringDate;
          document.getElementById('monFollowupDate').value = m.followupDate;
          document.getElementById('monStatus').value = m.status;
          document.getElementById('monProgress').value = m.progress;
          document.getElementById('monProgressVal').textContent = m.progress;
          document.getElementById('monDescription').value = m.description || '';
          document.getElementById('monObservation').value = m.observation || '';
          document.getElementById('monProblems').value = m.problems || '';
          document.getElementById('monAction').value = m.action || '';
          document.getElementById('monRemarks').value = m.remarks || '';
          openModal('monitoringModal');
        }
      }

      // Add Monitoring Log
      if (btn.hasAttribute('data-add-mon-log')) {
        const id = btn.getAttribute('data-add-mon-log');
        const m = state.monitoring.find((x) => x.id === id);
        if (m) {
          document.getElementById('monitoringLogForm').reset();
          document.getElementById('monLogParentId').value = m.id;
          document.getElementById('monLogModalTitle').textContent = `Update: ${m.projectName}`;
          document.getElementById('monLogDate').value = todayISO();
          document.getElementById('monLogStatus').value = m.status;
          document.getElementById('monLogProgress').value = Math.min(100, Number(m.progress) + 10);
          document.getElementById('monLogProgressVal').textContent = Math.min(100, Number(m.progress) + 10);
          document.getElementById('monLogNextDate').value = addDaysISO(todayISO(), 1);
          openModal('monitoringLogModal');
        }
      }

      // Delete Monitoring
      if (btn.hasAttribute('data-delete-mon')) {
        const id = btn.getAttribute('data-delete-mon');
        if (confirm('Delete this work monitoring record and its history?')) {
          await dbDelete('monitoring', id);
          await loadAllState();
          renderAll();
          showToast('Monitoring record deleted.');
        }
      }

      // Edit Daily Update
      if (btn.hasAttribute('data-edit-update')) {
        const id = btn.getAttribute('data-edit-update');
        const u = state.updates.find((x) => x.id === id);
        if (u) {
          document.getElementById('workUpdateFormTitle').textContent = 'Edit Daily Work Update';
          document.getElementById('updateId').value = u.id;
          document.getElementById('updateDate').value = u.date;
          document.getElementById('updateShift').value = u.shift || '';
          document.getElementById('updateCompleted').value = u.completed || '';
          document.getElementById('updateOngoing').value = u.ongoing || '';
          document.getElementById('updateMonitoring').value = u.monitoring || '';
          document.getElementById('updatePending').value = u.pending || '';
          document.getElementById('updateProblems').value = u.problems || '';
          document.getElementById('updateRemarks').value = u.remarks || '';
          document.getElementById('cancelUpdateEditBtn').classList.remove('hidden');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      }

      // Delete Daily Update
      if (btn.hasAttribute('data-delete-update')) {
        const id = btn.getAttribute('data-delete-update');
        if (confirm('Delete this daily work update?')) {
          await dbDelete('updates', id);
          await loadAllState();
          renderAll();
          showToast('Work update deleted.');
        }
      }

      // Remove Category
      if (btn.hasAttribute('data-del-cat')) {
        const cat = btn.getAttribute('data-del-cat');
        state.settings.categories = state.settings.categories.filter((c) => c !== cat);
        await dbPut('settings', state.settings);
        populateCategorySelects();
        showToast(`Removed category: ${cat}`);
      }
    });

    // Cancel Edit Update
    document.getElementById('cancelUpdateEditBtn').addEventListener('click', () => {
      document.getElementById('workUpdateForm').reset();
      document.getElementById('updateId').value = '';
      document.getElementById('updateDate').value = todayISO();
      document.getElementById('cancelUpdateEditBtn').classList.add('hidden');
      document.getElementById('workUpdateFormTitle').textContent = 'Log Daily Work Update';
    });

    // Search & Filters
    ['taskSearchInput', 'taskFilterBucket', 'taskFilterStatus', 'taskFilterPriority', 'taskFilterCategory'].forEach(
      (id) => {
        document.getElementById(id).addEventListener('input', renderTasksList);
        document.getElementById(id).addEventListener('change', renderTasksList);
      }
    );

    ['monitoringSearchInput', 'monitoringFilterStatus'].forEach((id) => {
      document.getElementById(id).addEventListener('input', renderMonitoringList);
      document.getElementById(id).addEventListener('change', renderMonitoringList);
    });

    document.getElementById('filterUpdateDate').addEventListener('change', renderWorkUpdatesList);
    ['pendingSearchInput', 'pendingFilterOverdue'].forEach((id) => {
      document.getElementById(id).addEventListener('input', renderPendingList);
      document.getElementById(id).addEventListener('change', renderPendingList);
    });

    // Report Controls
    document.getElementById('reportTypeSelect').addEventListener('change', (e) => {
      const type = e.target.value;
      const t = todayISO();
      if (type === 'daily') {
        document.getElementById('reportStartDate').value = t;
        document.getElementById('reportEndDate').value = t;
        document.getElementById('reportCustomTitle').value = 'Daily Engineering Work & Monitoring Report';
      } else if (type === 'weekly') {
        document.getElementById('reportStartDate').value = addDaysISO(t, -6);
        document.getElementById('reportEndDate').value = t;
        document.getElementById('reportCustomTitle').value = 'Weekly Engineering Department Work Report';
      } else if (type === 'monthly') {
        document.getElementById('reportStartDate').value = addDaysISO(t, -29);
        document.getElementById('reportEndDate').value = t;
        document.getElementById('reportCustomTitle').value = 'Monthly Engineering Operations & Maintenance Report';
      } else {
        document.getElementById('reportCustomTitle').value = 'Engineering Work Summary Report';
      }
      renderReportPreview();
    });

    ['reportStartDate', 'reportEndDate', 'reportCustomTitle', 'reportObservationsInput', 'reportNextPlanInput'].forEach(
      (id) => {
        document.getElementById(id).addEventListener('input', renderReportPreview);
      }
    );

    document.getElementById('generateReportPreviewBtn').addEventListener('click', () => {
      renderReportPreview();
      showToast('Report preview updated.');
    });

    document.getElementById('downloadPdfBtn').addEventListener('click', exportReportAsPDF);
    document.getElementById('downloadPngBtn').addEventListener('click', exportReportAsImage);
    document.getElementById('printReportBtn').addEventListener('click', () => window.print());

    // Settings & Profile
    document.getElementById('settingsProfileForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      state.settings.company = document.getElementById('settingCompany').value.trim();
      state.settings.department = document.getElementById('settingDepartment').value.trim();
      state.settings.engineerName = document.getElementById('settingEngineerName').value.trim();
      state.settings.designation = document.getElementById('settingDesignation').value.trim();
      state.settings.supervisor = document.getElementById('settingSupervisor').value.trim();
      await dbPut('settings', state.settings);
      updateProfileUI();
      renderReportPreview();
      showToast('Engineer profile settings saved.');
    });

    document.getElementById('addCategoryForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const val = document.getElementById('newCategoryInput').value.trim();
      if (val && !state.settings.categories.includes(val)) {
        state.settings.categories.push(val);
        await dbPut('settings', state.settings);
        populateCategorySelects();
        document.getElementById('newCategoryInput').value = '';
        showToast(`Added category: ${val}`);
      }
    });

    // Backup Export JSON
    document.getElementById('exportJsonBtn').addEventListener('click', () => {
      const payload = {
        app: 'IBN_SINA_Engineering_Work_Manager',
        exportedAt: new Date().toISOString(),
        settings: state.settings,
        tasks: state.tasks,
        monitoring: state.monitoring,
        updates: state.updates
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Engineering_Work_Manager_Backup_${todayISO()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Full JSON backup exported.');
    });

    // Backup Import JSON
    document.getElementById('importJsonInput').addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async (ev) => {
        try {
          const data = JSON.parse(ev.target.result);
          if (!data || (!Array.isArray(data.tasks) && !Array.isArray(data.monitoring))) {
            alert('Invalid backup JSON file format.');
            return;
          }
          if (!confirm('Importing this backup will merge/update your current records. Continue?')) return;
          if (data.settings) await dbPut('settings', { ...DEFAULT_SETTINGS, ...data.settings, id: 'profile' });
          if (Array.isArray(data.tasks)) {
            for (const t of data.tasks) await dbPut('tasks', t);
          }
          if (Array.isArray(data.monitoring)) {
            for (const m of data.monitoring) await dbPut('monitoring', m);
          }
          if (Array.isArray(data.updates)) {
            for (const u of data.updates) await dbPut('updates', u);
          }
          await loadAllState();
          renderAll();
          showToast('Backup restored successfully!');
        } catch (err) {
          alert('Failed to parse JSON backup file.');
        }
      };
      reader.readAsText(file);
    });

    // Erase All Data
    document.getElementById('clearAllDataBtn').addEventListener('click', async () => {
      if (confirm('WARNING: This will permanently erase all tasks, logs, and monitoring data from the Firebase database. Continue?')) {
        await dbClearAll();
        state.tasks = [];
        state.monitoring = [];
        state.updates = [];
        renderAll();
        showToast('All database records erased.');
      }
    });

    // PWA Install Prompt Handling
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      state.deferredPwaPrompt = e;
      document.getElementById('installPwaBtn').classList.remove('hidden');
    });

    document.getElementById('installPwaBtn').addEventListener('click', async () => {
      if (!state.deferredPwaPrompt) return;
      state.deferredPwaPrompt.prompt();
      await state.deferredPwaPrompt.userChoice;
      state.deferredPwaPrompt = null;
      document.getElementById('installPwaBtn').classList.add('hidden');
    });
  }

  // ==================== SERVICE WORKER REGISTRATION & BOOTSTRAP ====================
  async function initApp() {
    try {
      await loadAllState();
    } catch (err) {
      await loadAllState();
    }

    // Set default dates on forms
    const t = todayISO();
    document.getElementById('updateDate').value = t;
    document.getElementById('reportStartDate').value = t;
    document.getElementById('reportEndDate').value = t;

    bindEvents();
    renderAll();

    // Register Service Worker for Offline PWA Support
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
      navigator.serviceWorker.register('./sw.js').catch(() => {
        // Silently ignore SW registration errors on file:// protocol
      });
    }
  }

  document.addEventListener('DOMContentLoaded', initApp);
})();
