document.addEventListener('DOMContentLoaded', () => {
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
  loadStatistics();
  loadSearchTerms();
  loadTasks();
  checkEmailFinderStatus();
  
  // Event listeners
  scrapeForm.addEventListener('submit', startScraping);
  exportButton.addEventListener('click', exportToExcel);
  searchFilter.addEventListener('change', () => loadBusinesses(searchFilter.value));
  findEmailsBtn.addEventListener('click', startEmailFinder);
  refreshDataBtn.addEventListener('click', () => loadBusinesses(searchFilter.value));
  
  // Set up navigation highlighting
  setupNavigation();
  
  // Functions
  
  function setupNavigation() {
    const navLinks = document.querySelectorAll('.nav-link');
    const sections = document.querySelectorAll('section');
    
    navLinks.forEach(link => {
      link.addEventListener('click', function(e) {
        e.preventDefault();
        const target = this.getAttribute('href').substring(1);
        
        // Hide all sections
        sections.forEach(section => {
          section.style.display = 'none';
        });
        
        // Show the target section
        document.getElementById(target).style.display = 'block';
        
        // Update active link
        navLinks.forEach(link => link.classList.remove('active'));
        this.classList.add('active');
      });
    });
    
    // Show dashboard by default
    sections.forEach(section => {
      if (section.id !== 'dashboard') {
        section.style.display = 'none';
      }
    });
    
    document.querySelector('a[href="#dashboard"]').classList.add('active');
  }
  
  async function loadStatistics() {
    try {
      // Load total businesses count
      const response = await fetch('/api/businesses');
      const businesses = await response.json();
      
      // Calculate statistics
      const totalBusinesses = businesses.length;
      const totalEmails = businesses.filter(b => b.email).length;
      const totalWebsites = businesses.filter(b => b.website).length;
      
      // Get unique search terms
      const searchTerms = [...new Set(businesses.map(b => b.search_term))].filter(Boolean);
      const totalSearches = searchTerms.length;
      
      // Update the UI
      totalBusinessesEl.textContent = totalBusinesses;
      totalEmailsEl.textContent = totalEmails;
      totalWebsitesEl.textContent = totalWebsites;
      totalSearchesEl.textContent = totalSearches;
      
    } catch (error) {
      console.error('Error loading statistics:', error);
      showNotification('Error loading statistics', 'danger');
    }
  }
  
  function initializeDataTable() {
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
        { data: 'rating' }
      ],
      language: {
        emptyTable: "No data available"
      },
      pageLength: 25,
      lengthMenu: [ [10, 25, 50, 100, -1], [10, 25, 50, 100, "All"] ]
    });
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
  
  async function exportToExcel() {
    if (!currentTaskId && !searchFilter.value) {
      showNotification('Please select a search term to export', 'warning');
      return;
    }
    
    const taskId = currentTaskId;
    const searchTermToExport = searchFilter.value;
    
    try {
      exportButton.disabled = true;
      exportButton.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Exporting...';
      
      // Get the first task ID for this search term if we don't have one
      if (!taskId && searchTermToExport) {
        const tasksResponse = await fetch('/api/tasks');
        const tasks = await tasksResponse.json();
        
        const matchingTask = tasks.find(task => task.search_term === searchTermToExport);
        if (!matchingTask) {
          throw new Error('No task found for this search term');
        }
        
        await exportTaskData(matchingTask.id);
      } else if (taskId) {
        await exportTaskData(taskId);
      }
    } catch (error) {
      console.error('Error exporting to Excel:', error);
      showNotification('Error exporting to Excel', 'danger');
    } finally {
      exportButton.disabled = false;
      exportButton.innerHTML = '<i class="fas fa-file-excel me-2"></i>Export to Excel';
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
