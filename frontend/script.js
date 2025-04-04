document.addEventListener('DOMContentLoaded', () => {
  console.log("DOM loaded - initializing application...");
  
  // DOM Elements
  const scrapeForm = document.getElementById('scrapeForm');
  const scrapeButton = document.getElementById('scrapeButton');
  const currentTaskStatus = document.getElementById('currentTaskStatus');
  const loadingOverlay = document.getElementById('loadingOverlay');
  const businessTable = document.getElementById('businessTable');
  const exportButton = document.getElementById('exportButton');
  const searchFilter = document.getElementById('searchFilter');
  const findEmailsBtn = document.getElementById('findEmailsBtn');
  const emailFinderStatus = document.getElementById('emailFinderStatus');
  const emailFinderStats = document.getElementById('emailFinderStats');
  const refreshDataBtn = document.getElementById('refreshDataBtn');
  
  // Export elements
  const exportAllBtn = document.getElementById('exportAllBtn');
  const stateSelect = document.getElementById('stateSelect');
  const searchSelect = document.getElementById('searchSelect');
  const exportStateBtn = document.getElementById('exportStateBtn');
  const exportSearchBtn = document.getElementById('exportSearchBtn');
  const businessType = document.getElementById('businessType');
  const cityPresets = document.getElementById('cityPresets');
  const batchStates = document.getElementById('batchStates');
  const startBatchBtn = document.getElementById('startBatchBtn');
  
  // Stats elements
  const totalBusinessesEl = document.getElementById('totalBusinesses');
  const totalEmailsEl = document.getElementById('totalEmails');
  const totalWebsitesEl = document.getElementById('totalWebsites');
  const totalSearchesEl = document.getElementById('totalSearches');
  
  // State variables
  let currentTaskId = null;
  let currentSearchTerm = null;
  let statusCheckInterval = null;
  let dataTable = null;
  let emailFinderCheckInterval = null;
  
  // Initialize DataTable
  initializeDataTable();
  
  // Initialize page
  setupNavigation(); // Ensure this runs first to show the default tab
  loadStatistics();
  loadSearchTerms();
  loadTasks();
  loadStates(); // Ensure we load state data
  checkEmailFinderStatus();
  
  // Initialize Select2 for better dropdown UX
  try {
    $('#stateSelect, #searchSelect, #batchStates').select2({
      theme: 'bootstrap-5'
    });
    console.log("Select2 initialized");
  } catch(e) {
    console.error("Error initializing Select2:", e);
  }
  
  // Event listeners
  scrapeForm.addEventListener('submit', startScraping);
  exportButton.addEventListener('click', exportCurrentView);
  searchFilter.addEventListener('change', () => loadBusinesses(searchFilter.value));
  findEmailsBtn.addEventListener('click', startEmailFinder);
  refreshDataBtn.addEventListener('click', () => loadBusinesses(searchFilter.value));
  
  // Add event listeners for export functions
  exportAllBtn.addEventListener('click', exportAllData);
  stateSelect.addEventListener('change', updateStateExportButton);
  searchSelect.addEventListener('change', updateSearchExportButton);
  exportStateBtn.addEventListener('click', () => exportStateData(stateSelect.value));
  exportSearchBtn.addEventListener('click', () => exportTaskBySearchTerm(searchSelect.value));
  startBatchBtn.addEventListener('click', startBatchProcess);
  
  // Handle city preset selection
  cityPresets.addEventListener('click', function(e) {
    if (e.target.classList.contains('dropdown-item')) {
      e.preventDefault();
      document.getElementById('searchTerm').value = e.target.textContent;
    }
  });
  
  // Set up navigation highlighting
  setupNavigation();
  
  // Functions
  
  function setupNavigation() {
    console.log("Setting up navigation...");
    const navLinks = document.querySelectorAll('.nav-link');
    const sections = document.querySelectorAll('section');
    
    navLinks.forEach(link => {
      link.addEventListener('click', function(e) {
        console.log(`Clicked on nav link to ${this.getAttribute('href')}`);
        e.preventDefault();
        const target = this.getAttribute('href').substring(1);
        
        // Hide all sections and remove active class
        sections.forEach(section => {
          section.style.display = 'none';
          section.classList.remove('active');
        });
        
        // Show the target section
        const targetSection = document.getElementById(target);
        if (targetSection) {
          targetSection.style.display = 'block';
          targetSection.classList.add('active');
          console.log(`Showing section ${target}`);
          
          // If switching to data tab, redraw the table to fix layout issues
          if (target === 'data' && dataTable) {
            setTimeout(() => dataTable.columns.adjust().draw(), 10);
          }
        } else {
          console.error(`Target section ${target} not found`);
        }
        
        // Update active link
        navLinks.forEach(link => link.classList.remove('active'));
        this.classList.add('active');
      });
    });
    
    // Show dashboard by default
    console.log("Setting dashboard as default active section");
    sections.forEach(section => {
      section.style.display = 'none';
      section.classList.remove('active');
    });
    
    const dashboard = document.getElementById('dashboard');
    if (dashboard) {
      dashboard.style.display = 'block';
      dashboard.classList.add('active');
    } else {
      console.error("Dashboard section not found!");
    }
    
    document.querySelector('a[href="#dashboard"]').classList.add('active');
  }
  
  async function loadStatistics() {
    try {
      // First try to get detailed stats from the API
      const statsResponse = await fetch('/api/stats');
      
      if (statsResponse.ok) {
        const stats = await statsResponse.json();
        
        // Update the UI with detailed statistics
        totalBusinessesEl.textContent = stats.totalBusinesses.toLocaleString();
        totalEmailsEl.textContent = stats.totalEmails.toLocaleString();
        totalWebsitesEl.textContent = stats.totalWebsites.toLocaleString();
        totalSearchesEl.textContent = stats.totalSearchTerms.toLocaleString();
        totalStates.textContent = stats.states.length;
        
        // Calculate and display percentages
        if (stats.totalBusinesses > 0) {
          const emailPercent = Math.round((stats.totalEmails / stats.totalBusinesses) * 100);
          const websitePercent = Math.round((stats.totalWebsites / stats.totalBusinesses) * 100);
          
          emailPercentage.textContent = `${emailPercent}%`;
          websitePercentage.textContent = `${websitePercent}%`;
        }
        
        return;
      } else {
        console.warn("Stats API returned an error. Creating fallback stats...");
        
        // Fallback to creating stats from businesses
        const response = await fetch('/api/businesses');
        if (!response.ok) {
          throw new Error('Failed to fetch businesses');
        }
        
        const businesses = await response.json();
        
        // Calculate statistics
        const totalBusinesses = businesses.length;
        const totalEmails = businesses.filter(b => b.email).length;
        const totalWebsites = businesses.filter(b => b.website).length;
        
        // Get unique search terms
        const searchTerms = [...new Set(businesses.map(b => b.search_term))].filter(Boolean);
        const totalSearches = searchTerms.length;
        
        // Get unique states from search terms
        const statesSet = new Set();
        searchTerms.forEach(term => {
          const parts = term.split('-');
          if (parts.length > 2) {
            const state = parts[2].trim();
            statesSet.add(state);
          }
        });
        
        // Update the UI
        totalBusinessesEl.textContent = totalBusinesses.toLocaleString();
        totalEmailsEl.textContent = totalEmails.toLocaleString();
        totalWebsitesEl.textContent = totalWebsites.toLocaleString();
        totalSearchesEl.textContent = totalSearches.toLocaleString();
        
        // Update elements that might not exist in some versions
        const totalStatesEl = document.getElementById('totalStates');
        if (totalStatesEl) totalStatesEl.textContent = statesSet.size.toString();
        
        const emailPercentageEl = document.getElementById('emailPercentage');
        const websitePercentageEl = document.getElementById('websitePercentage');
        
        // Calculate and display percentages
        if (totalBusinesses > 0) {
          const emailPercent = Math.round((totalEmails / totalBusinesses) * 100);
          const websitePercent = Math.round((totalWebsites / totalBusinesses) * 100);
          
          if (emailPercentageEl) emailPercentageEl.textContent = `${emailPercent}%`;
          if (websitePercentageEl) websitePercentageEl.textContent = `${websitePercent}%`;
        }
      }
      
    } catch (error) {
      console.error('Error loading statistics:', error);
      showNotification('Error loading statistics', 'danger');
      
      // Ensure stats are initialized even on error
      totalBusinessesEl.textContent = '0';
      totalEmailsEl.textContent = '0';
      totalWebsitesEl.textContent = '0';
      totalSearchesEl.textContent = '0';
    }
  }
  
  function initializeDataTable() {
    try {
      console.log("Initializing DataTable...");
      dataTable = new DataTable('#businessTable', {
        columns: [
          { data: 'name' },
          { data: 'email' },
          { data: 'phone' },
          { data: 'city' },
          { data: 'country' },
          { data: 'website', render: function(data) {
            return data ? `<a href="${data}" target="_blank">${data}</a>` : 'N/A';
          }},
          { data: 'rating' },
          { data: 'search_term' }
        ],
        language: {
          emptyTable: "No data available"
        },
        pageLength: 25,
        lengthMenu: [ [10, 25, 50, 100, -1], [10, 25, 50, 100, "All"] ],
        // Using plain DataTables, no Bootstrap-specific options
        dom: 'lfrtip',
        // Using DataTables built-in styles
        autoWidth: true,
        responsive: true
      });
      
      // Add custom styling to DataTables elements
      $('#businessTable_wrapper').addClass('datatables-custom');
      
      console.log("DataTable initialized successfully");
    } catch (error) {
      console.error("Error initializing DataTable:", error);
    }
  }
  
  async function loadSearchTerms() {
    try {
      const response = await fetch('/api/tasks');
      const tasks = await response.json();
      
      if (tasks.length === 0) return;
      
      // Get unique search terms
      const searchTerms = [...new Set(tasks.map(task => task.search_term))];
      
      // Clear existing options
      searchFilter.innerHTML = '<option value="">All Search Terms</option>';
      
      // Add search term options
      searchTerms.forEach(term => {
        const option = document.createElement('option');
        option.value = term;
        option.textContent = term;
        searchFilter.appendChild(option);
      });
    } catch (error) {
      console.error('Error loading search terms:', error);
    }
  }
  
  async function loadTasks() {
    try {
      const response = await fetch('/api/tasks');
      
      if (!response.ok) {
        throw new Error('Failed to fetch tasks');
      }
      
      const tasks = await response.json();
      displayTasks(tasks);
      
      // Check if there's a running task
      const runningTask = tasks.find(task => task.status === 'running');
      if (runningTask) {
        currentTaskId = runningTask.id;
        currentSearchTerm = runningTask.search_term;
        startStatusCheck();
        updateTaskStatusDisplay(runningTask);
      }
    } catch (error) {
      console.error('Error loading tasks:', error);
      showNotification('Error loading tasks', 'danger');
    }
  }
  
  function displayTasks(tasks) {
    const taskList = document.getElementById('taskList');
    
    if (tasks.length === 0) {
      taskList.innerHTML = '<tr><td colspan="6" class="text-center">No tasks found</td></tr>';
      return;
    }
    
    taskList.innerHTML = '';
    
    tasks.forEach(task => {
      const createdDate = new Date(task.created_at).toLocaleString();
      const completedDate = task.completed_at ? new Date(task.completed_at).toLocaleString() : '-';
      const statusClass = getStatusClass(task.status);
      
      const row = document.createElement('tr');
      row.className = 'task-item';
      row.innerHTML = `
        <td>${task.search_term}</td>
        <td><span class="badge ${statusClass}">${task.status.toUpperCase()}</span></td>
        <td>${createdDate}</td>
        <td>${completedDate}</td>
        <td>${task.businesses_found}</td>
        <td>
          <div class="btn-group btn-group-sm">
            <button class="btn btn-outline-primary view-data-btn" data-search="${task.search_term}">
              <i class="fas fa-table"></i>
            </button>
            <button class="btn btn-outline-success export-btn" data-task-id="${task.id}">
              <i class="fas fa-file-excel"></i>
            </button>
          </div>
        </td>
      `;
      
      taskList.appendChild(row);
      
      // Add event listeners
      row.querySelector('.view-data-btn').addEventListener('click', () => {
        // Switch to data tab and filter by search term
        document.querySelector('a[href="#data"]').click();
        searchFilter.value = task.search_term;
        searchFilter.dispatchEvent(new Event('change'));
      });
      
      row.querySelector('.export-btn').addEventListener('click', () => {
        exportTaskData(task.id);
      });
    });
  }
  
  async function startScraping(e) {
    e.preventDefault();
    
    const searchTermInput = document.getElementById('searchTerm');
    const cityCountry = searchTermInput.value.trim();
    
    if (!cityCountry) {
      showNotification('Please enter a city and country', 'warning');
      return;
    }
    
    // Construct the full search term
    const searchTerm = `Digital Marketing Agency - ${cityCountry}`;
    currentSearchTerm = searchTerm;
    
    try {
      scrapeButton.disabled = true;
      loadingOverlay.classList.remove('d-none');
      
      const response = await fetch('/api/scrape', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ searchTerm })
      });
      
      if (!response.ok) {
        throw new Error('Failed to start scraping task');
      }
      
      const data = await response.json();
      currentTaskId = data.taskId;
      
      showNotification(`Scraping task started for "${searchTerm}" (Max: ${data.maxResults} businesses)`, 'success');
      startStatusCheck();
      
      // Show initial task status
      updateTaskStatusDisplay({
        id: currentTaskId,
        search_term: searchTerm,
        status: 'pending',
        created_at: new Date().toISOString(),
        businesses_found: 0
      });
      
      // Reload tasks list
      loadTasks();
      loadSearchTerms();
    } catch (error) {
      console.error('Error starting scraping task:', error);
      showNotification('Error starting scraping task', 'danger');
      scrapeButton.disabled = false;
      loadingOverlay.classList.add('d-none');
    }
  }
  
  function startStatusCheck() {
    if (statusCheckInterval) {
      clearInterval(statusCheckInterval);
    }
    
    statusCheckInterval = setInterval(async () => {
      if (!currentTaskId) return;
      
      try {
        const response = await fetch(`/api/task/${currentTaskId}`);
        
        if (!response.ok) {
          throw new Error('Failed to fetch task status');
        }
        
        const task = await response.json();
        updateTaskStatusDisplay(task);
        
        // Update loading overlay progress
        const progressBar = loadingOverlay.querySelector('.progress-bar');
        if (progressBar) {
          const percent = Math.min((task.businesses_found / 200) * 100, 100);
          progressBar.style.width = `${percent}%`;
          progressBar.setAttribute('aria-valuenow', task.businesses_found);
          progressBar.textContent = `${task.businesses_found}/200`;
        }
        
        if (task.status === 'completed' || task.status === 'failed') {
          clearInterval(statusCheckInterval);
          scrapeButton.disabled = false;
          loadingOverlay.classList.add('d-none');
          
          if (task.status === 'completed') {
            showNotification(`Scraping completed with ${task.businesses_found} businesses found`, 'success');
            
            // Reload data and stats
            loadSearchTerms();
            loadBusinesses(task.search_term);
            loadStatistics();
          } else {
            showNotification('Scraping task failed', 'danger');
          }
          
          // Reload tasks list
          loadTasks();
        }
      } catch (error) {
        console.error('Error checking task status:', error);
      }
    }, 3000);
  }
  
  function updateTaskStatusDisplay(task) {
    const statusClass = getStatusClass(task.status);
    let statusIcon = '';
    
    switch (task.status) {
      case 'pending':
        statusIcon = '<i class="fas fa-clock me-2"></i>';
        break;
      case 'running':
        statusIcon = '<i class="fas fa-spinner fa-spin me-2"></i>';
        break;
      case 'completed':
        statusIcon = '<i class="fas fa-check-circle me-2"></i>';
        break;
      case 'failed':
        statusIcon = '<i class="fas fa-exclamation-circle me-2"></i>';
        break;
    }
    
    currentTaskStatus.innerHTML = `
      <div class="card border-0">
        <div class="card-body p-0">
          <div class="d-flex justify-content-between mb-3">
            <h5 class="card-title">${task.search_term}</h5>
            <span class="badge ${statusClass}">${statusIcon}${task.status.toUpperCase()}</span>
          </div>
          
          <div class="row mb-3">
            <div class="col-md-6">
              <div class="mb-2">
                <span class="fw-bold"><i class="far fa-calendar-alt me-1"></i> Started:</span> 
                ${new Date(task.created_at).toLocaleString()}
              </div>
              <div>
                <span class="fw-bold"><i class="fas fa-building me-1"></i> Businesses Found:</span> 
                <span class="badge bg-primary">${task.businesses_found}</span>
                <small class="text-muted">(Maximum: 200)</small>
              </div>
            </div>
            <div class="col-md-6">
              ${task.completed_at ? `
                <div>
                  <span class="fw-bold"><i class="far fa-check-circle me-1"></i> Completed:</span>
                  ${new Date(task.completed_at).toLocaleString()}
                </div>
                <div>
                  <span class="fw-bold"><i class="far fa-clock me-1"></i> Duration:</span>
                  ${formatDuration(new Date(task.completed_at) - new Date(task.created_at))}
                </div>
              ` : ''}
            </div>
          </div>
          
          ${task.status === 'running' ? `
            <div class="progress mt-2" style="height: 20px;">
              <div class="progress-bar progress-bar-striped progress-bar-animated" 
                   role="progressbar" 
                   style="width: ${Math.min(task.businesses_found / 200 * 100, 100)}%;" 
                   aria-valuenow="${task.businesses_found}" 
                   aria-valuemin="0" 
                   aria-valuemax="200">
                ${task.businesses_found}/200
              </div>
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }
  
  async function loadBusinesses(searchTerm) {
    try {
      const url = searchTerm 
        ? `/api/businesses?searchTerm=${encodeURIComponent(searchTerm)}`
        : '/api/businesses';
        
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error('Failed to fetch businesses');
      }
      
      const businesses = await response.json();
      
      // Clear existing table data and add new data
      dataTable.clear();
      dataTable.rows.add(businesses);
      dataTable.draw();
      
      // Update table header
      const tableTitle = document.querySelector('#data .card-title');
      tableTitle.innerHTML = `<i class="fas fa-database me-2"></i>Business Data (${businesses.length})`;
      if (searchTerm) {
        tableTitle.innerHTML += ` - ${searchTerm}`;
      }
      
      // Enable export button if we have data
      exportButton.disabled = businesses.length === 0;
      
    } catch (error) {
      console.error('Error loading businesses:', error);
      showNotification('Error loading business data', 'danger');
    }
  }
  
  async function exportCurrentView() {
    if (!searchFilter.value) {
      // If no search filter is selected, use the server-side export for all businesses
      await exportAllData();
    } else {
      // If a search term is selected, use the server-side export for that search term
      await exportTaskBySearchTerm(searchFilter.value);
    }
  }
  
  async function exportTaskData(taskId) {
    try {
      const response = await fetch(`/api/export/${taskId}`);
      
      if (!response.ok) {
        throw new Error('Failed to export data');
      }
      
      const data = await response.json();
      
      // Create and click download link
      const downloadLink = document.createElement('a');
      downloadLink.href = data.downloadUrl;
      downloadLink.download = '';
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);
      
      showNotification(`Exported ${data.count} businesses to Excel`, 'success');
    } catch (error) {
      console.error('Error exporting task data:', error);
      showNotification('Error exporting to Excel', 'danger');
    }
  }
  
  async function startEmailFinder() {
    try {
      findEmailsBtn.disabled = true;
      findEmailsBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i> Processing...';
      
      const response = await fetch('/api/find-emails', {
        method: 'POST'
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to start email finder');
      }
      
      const data = await response.json();
      showNotification(data.message, 'success');
      
      // Start checking email finder status
      startEmailFinderStatusCheck();
      
    } catch (error) {
      console.error('Error starting email finder:', error);
      showNotification(error.message || 'Error starting email finder', 'danger');
    } finally {
      findEmailsBtn.disabled = false;
      findEmailsBtn.innerHTML = '<i class="fas fa-play me-1"></i> Find Missing Emails';
    }
  }
  
  function startEmailFinderStatusCheck() {
    if (emailFinderCheckInterval) {
      clearInterval(emailFinderCheckInterval);
    }
    
    checkEmailFinderStatus();
    
    emailFinderCheckInterval = setInterval(() => {
      checkEmailFinderStatus();
    }, 3000);
  }
  
  async function checkEmailFinderStatus() {
    try {
      const response = await fetch('/api/find-emails/status');
      
      if (!response.ok) {
        throw new Error('Failed to get email finder status');
      }
      
      const data = await response.json();
      
      // Update status display
      const statusDiv = document.getElementById('emailFinderStatus');
      const progressBar = statusDiv.querySelector('.progress-bar');
      
      if (data.running) {
        const totalTasks = data.queue + data.activeTasks;
        const percent = totalTasks > 0 ? (data.activeTasks / totalTasks) * 100 : 100;
        
        statusDiv.querySelector('.badge').className = 'badge bg-info';
        statusDiv.querySelector('.badge').innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i> Running';
        statusDiv.querySelector('.ms-2').textContent = `Processing ${data.activeTasks} websites, ${data.queue} in queue`;
        
        progressBar.style.width = `${percent}%`;
        progressBar.classList.add('progress-bar-striped', 'progress-bar-animated');
        
        findEmailsBtn.disabled = true;
        emailFinderStats.textContent = `Active: ${data.activeTasks} | Queue: ${data.queue}`;
        
        // No need to check so frequently if queue is large
        if (data.queue > 100) {
          clearInterval(emailFinderCheckInterval);
          emailFinderCheckInterval = setInterval(() => {
            checkEmailFinderStatus();
          }, 10000);
        }
      } else {
        statusDiv.querySelector('.badge').className = 'badge bg-secondary';
        statusDiv.querySelector('.badge').innerHTML = 'Not Running';
        statusDiv.querySelector('.ms-2').textContent = 'Start the email finder to discover missing emails';
        
        progressBar.style.width = '0%';
        progressBar.classList.remove('progress-bar-striped', 'progress-bar-animated');
        
        findEmailsBtn.disabled = false;
        emailFinderStats.textContent = 'Queue: 0 | Active: 0';
        
        // If finder is not running, stop checking
        if (emailFinderCheckInterval) {
          clearInterval(emailFinderCheckInterval);
          emailFinderCheckInterval = null;
          
          // Reload data to get updated emails
          loadBusinesses(searchFilter.value);
          loadStatistics();
        }
      }
    } catch (error) {
      console.error('Error checking email finder status:', error);
    }
  }
  
  async function loadStates() {
    try {
      // Get states directly from businesses data as a fallback
      const response = await fetch('/api/businesses');
      if (!response.ok) {
        throw new Error('Failed to fetch businesses');
      }
      
      const businesses = await response.json();
      
      const states = [...new Set(
        businesses.map(b => {
          const parts = b.search_term?.split('-');
          return parts && parts.length > 2 ? parts[2].trim() : null;
        }).filter(Boolean)
      )];
      
      populateStateSelect(states);
    } catch (error) {
      console.error('Error loading states:', error);
    }
  }
  
  function populateStateSelect(states) {
    // For export select
    stateSelect.innerHTML = '<option value="" disabled selected>Select a state...</option>';
    states.sort().forEach(state => {
      const option = document.createElement('option');
      option.value = state;
      option.textContent = state;
      stateSelect.appendChild(option);
    });
    
    // For batch processing select
    batchStates.innerHTML = '';
    states.sort().forEach(state => {
      const option = document.createElement('option');
      option.value = state;
      option.textContent = state;
      batchStates.appendChild(option);
    });
  }
  
  function updateStateExportButton() {
    exportStateBtn.disabled = !stateSelect.value;
  }
  
  function updateSearchExportButton() {
    exportSearchBtn.disabled = !searchSelect.value;
  }
  
  // New export functions
  
  async function exportAllData() {
    try {
      showExportProgress('Preparing to export all business data...');
      
      const response = await fetch('/api/export-all');
      
      if (!response.ok) {
        throw new Error('Failed to export data');
      }
      
      const data = await response.json();
      
      // Update progress message
      document.getElementById('exportProgressMessage').textContent = 
        `Successfully exported ${data.count} businesses. Starting download...`;
      
      // Create and click download link
      const downloadLink = document.createElement('a');
      downloadLink.href = data.downloadUrl;
      downloadLink.download = '';
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);
      
      // Hide the modal after a short delay
      setTimeout(() => {
        hideExportProgress();
        showNotification(`Exported ${data.count} businesses to Excel`, 'success');
      }, 1500);
      
    } catch (error) {
      console.error('Error exporting all data:', error);
      hideExportProgress();
      showNotification('Error exporting data', 'danger');
    }
  }
  
  async function exportStateData(state) {
    if (!state) {
      showNotification('Please select a state to export', 'warning');
      return;
    }
    
    try {
      showExportProgress(`Preparing to export businesses in ${state}...`);
      
      const response = await fetch(`/api/export-state/${encodeURIComponent(state)}`);
      
      if (!response.ok) {
        throw new Error('Failed to export data');
      }
      
      const data = await response.json();
      
      // Update progress message
      document.getElementById('exportProgressMessage').textContent = 
        `Successfully exported ${data.count} businesses from ${state}. Starting download...`;
      
      // Create and click download link
      const downloadLink = document.createElement('a');
      downloadLink.href = data.downloadUrl;
      downloadLink.download = '';
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);
      
      // Hide the modal after a short delay
      setTimeout(() => {
        hideExportProgress();
        showNotification(`Exported ${data.count} businesses from ${state} to Excel`, 'success');
      }, 1500);
      
    } catch (error) {
      console.error(`Error exporting state data for ${state}:`, error);
      hideExportProgress();
      showNotification('Error exporting state data', 'danger');
    }
  }
  
  async function exportTaskBySearchTerm(searchTerm) {
    if (!searchTerm) {
      showNotification('Please select a search term to export', 'warning');
      return;
    }
    
    try {
      // First, get the task ID for the search term
      const tasksResponse = await fetch('/api/tasks');
      const tasks = await tasksResponse.json();
      
      const matchingTask = tasks.find(task => task.search_term === searchTerm);
      if (!matchingTask) {
        throw new Error('No task found for this search term');
      }
      
      await exportTaskData(matchingTask.id, searchTerm);
    } catch (error) {
      console.error(`Error exporting data for search term ${searchTerm}:`, error);
      showNotification('Error exporting search term data', 'danger');
    }
  }
  
  function showExportProgress(message) {
    const exportModal = new bootstrap.Modal(document.getElementById('exportProgressModal'));
    document.getElementById('exportProgressMessage').textContent = message;
    exportModal.show();
    return exportModal;
  }
  
  function hideExportProgress() {
    const exportModal = bootstrap.Modal.getInstance(document.getElementById('exportProgressModal'));
    if (exportModal) {
      exportModal.hide();
    }
  }
  
  // Batch processing function
  async function startBatchProcess() {
    const selectedStates = Array.from(batchStates.selectedOptions).map(option => option.value);
    const waitTime = parseInt(document.getElementById('batchWait').value, 10);
    
    if (waitTime < 30) {
      showNotification('Wait time should be at least 30 seconds', 'warning');
      return;
    }
    
    try {
      startBatchBtn.disabled = true;
      startBatchBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i> Starting batch...';
      
      const payload = {
        states: selectedStates.length > 0 ? selectedStates : null,
        waitBetweenTasks: waitTime * 1000
      };
      
      const response = await fetch('/api/batch/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to start batch operation');
      }
      
      const result = await response.json();
      
      showNotification(`Batch operation started with ID: ${result.batchId}. Processing ${result.totalCities} cities.`, 'success');
      
      // Start checking batch status
      startBatchStatusCheck();
      
    } catch (error) {
      showNotification(error.message || 'Error starting batch operation', 'danger');
    } finally {
      startBatchBtn.disabled = false;
      startBatchBtn.innerHTML = '<i class="fas fa-play me-1"></i> Start Batch';
    }
  }
  
  let batchStatusInterval = null;
  
  function startBatchStatusCheck() {
    if (batchStatusInterval) {
      clearInterval(batchStatusInterval);
    }
    
    batchStatusInterval = setInterval(async () => {
      try {
        const response = await fetch('/api/batch/status');
        
        if (!response.ok) {
          throw new Error('Failed to get batch status');
        }
        
        const status = await response.json();
        
        if (!status.isRunning) {
          clearInterval(batchStatusInterval);
          showNotification(`Batch operation completed: ${status.completedTasks}/${status.totalTasks} tasks completed`, 'info');
          return;
        }
        
        // Update batch status UI here if you add a status display element
        console.log(`Batch progress: ${Math.round(status.progress * 100)}% (${status.completedTasks}/${status.totalTasks})`);
        
      } catch (error) {
        console.error('Error getting batch status:', error);
      }
    }, 10000); // Check every 10 seconds
  }
  
  // Helper Functions
  
  function showNotification(message, type) {
    const toastContainer = document.querySelector('.toast-container') || createToastContainer();
    
    const toast = document.createElement('div');
    toast.className = `toast bg-${type} text-white`;
    toast.setAttribute('role', 'alert');
    toast.setAttribute('aria-live', 'assertive');
    toast.setAttribute('aria-atomic', 'true');
    
    toast.innerHTML = `
      <div class="toast-header bg-${type} text-white">
        <strong class="me-auto">Notification</strong>
        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="toast" aria-label="Close"></button>
      </div>
      <div class="toast-body">
        ${message}
      </div>
    `;
    
    toastContainer.appendChild(toast);
    
    const bsToast = new bootstrap.Toast(toast, {
      autohide: true,
      delay: 5000
    });
    
    bsToast.show();
    
    // Remove from DOM after hidden
    toast.addEventListener('hidden.bs.toast', () => {
      toast.remove();
    });
  }
  
  function createToastContainer() {
    const container = document.createElement('div');
    container.className = 'toast-container position-fixed top-0 end-0 p-3';
    container.style.zIndex = 1070;
    document.body.appendChild(container);
    return container;
  }
  
  function getStatusClass(status) {
    switch (status) {
      case 'pending': return 'bg-warning text-dark';
      case 'running': return 'bg-info';
      case 'completed': return 'bg-success';
      case 'failed': return 'bg-danger';
      default: return 'bg-secondary';
    }
  }
  
  function formatDuration(ms) {
    // Format duration in milliseconds to a readable string
    const seconds = Math.floor((ms / 1000) % 60);
    const minutes = Math.floor((ms / (1000 * 60)) % 60);
    const hours = Math.floor(ms / (1000 * 60 * 60));
    
    const parts = [];
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
    
    return parts.join(' ');
  }
});
