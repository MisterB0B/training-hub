/**
 * Supabase Sync Module for Light Park Apps
 * Handles real-time sync across all devices with localStorage fallback
 */

const SUPABASE_URL = 'https://gwjtfcrgpxclixonogpe.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd3anRmY3JncHhjbGl4b25vZ3BlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAzMzQzOTUsImV4cCI6MjA4NTkxMDM5NX0.qM1-_VA1Dsx_nsWkeoAJvNWNgSuuwApPBGoJU32X3-I';

class SupabaseSync {
  constructor(appName) {
    this.appName = appName;
    this.listeners = {};
    this.online = navigator.onLine;
    this.pendingSync = [];
    
    // Track online/offline status
    window.addEventListener('online', () => {
      this.online = true;
      this.flushPendingSync();
    });
    window.addEventListener('offline', () => {
      this.online = false;
    });
  }

  // Make API request to Supabase
  async request(method, endpoint, body = null) {
    const options = {
      method,
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      }
    };
    if (body) options.body = JSON.stringify(body);
    
    const response = await fetch(`${SUPABASE_URL}${endpoint}`, options);
    if (!response.ok) {
      throw new Error(`Supabase error: ${response.status}`);
    }
    return response.json();
  }

  // Save data to Supabase
  async save(dataKey, data) {
    // Always save to localStorage first (instant, works offline)
    const localKey = `${this.appName}_${dataKey}`;
    localStorage.setItem(localKey, JSON.stringify(data));
    
    if (!this.online) {
      // Queue for later sync
      this.pendingSync.push({ dataKey, data, timestamp: Date.now() });
      console.log(`[Sync] Offline - queued ${dataKey} for later`);
      return { synced: false, local: true };
    }

    try {
      // Check if record exists
      const existing = await this.request(
        'GET', 
        `/rest/v1/app_data?app_name=eq.${this.appName}&data_key=eq.${dataKey}&select=id`
      );

      if (existing.length > 0) {
        // Update existing record
        await this.request(
          'PATCH',
          `/rest/v1/app_data?id=eq.${existing[0].id}`,
          { data, updated_at: new Date().toISOString() }
        );
      } else {
        // Insert new record
        await this.request(
          'POST',
          '/rest/v1/app_data',
          { app_name: this.appName, data_key: dataKey, data }
        );
      }
      
      console.log(`[Sync] Saved ${dataKey} to cloud`);
      return { synced: true, local: true };
    } catch (err) {
      console.error(`[Sync] Cloud save failed for ${dataKey}:`, err);
      this.pendingSync.push({ dataKey, data, timestamp: Date.now() });
      return { synced: false, local: true, error: err.message };
    }
  }

  // Load data from Supabase (with localStorage fallback)
  async load(dataKey) {
    const localKey = `${this.appName}_${dataKey}`;
    const localData = localStorage.getItem(localKey);
    
    if (!this.online) {
      console.log(`[Sync] Offline - using local data for ${dataKey}`);
      return localData ? JSON.parse(localData) : null;
    }

    try {
      const result = await this.request(
        'GET',
        `/rest/v1/app_data?app_name=eq.${this.appName}&data_key=eq.${dataKey}&select=data,updated_at&order=updated_at.desc&limit=1`
      );

      if (result.length > 0) {
        const cloudData = result[0].data;
        // Update localStorage with cloud data
        localStorage.setItem(localKey, JSON.stringify(cloudData));
        console.log(`[Sync] Loaded ${dataKey} from cloud`);
        return cloudData;
      } else if (localData) {
        // No cloud data, but we have local - push it up
        console.log(`[Sync] No cloud data for ${dataKey}, using local and syncing up`);
        await this.save(dataKey, JSON.parse(localData));
        return JSON.parse(localData);
      }
      
      return null;
    } catch (err) {
      console.error(`[Sync] Cloud load failed for ${dataKey}:`, err);
      return localData ? JSON.parse(localData) : null;
    }
  }

  // Subscribe to real-time changes
  subscribe(dataKey, callback) {
    // For now, poll every 30 seconds for changes
    // TODO: Implement proper WebSocket subscription when needed
    const pollInterval = setInterval(async () => {
      if (this.online) {
        try {
          const data = await this.load(dataKey);
          if (data) callback(data);
        } catch (err) {
          console.error(`[Sync] Poll failed for ${dataKey}:`, err);
        }
      }
    }, 30000);

    this.listeners[dataKey] = pollInterval;
    return () => clearInterval(pollInterval);
  }

  // Flush pending syncs when back online
  async flushPendingSync() {
    if (this.pendingSync.length === 0) return;
    
    console.log(`[Sync] Back online - syncing ${this.pendingSync.length} pending items`);
    
    const pending = [...this.pendingSync];
    this.pendingSync = [];
    
    for (const item of pending) {
      try {
        await this.save(item.dataKey, item.data);
      } catch (err) {
        console.error(`[Sync] Failed to sync pending ${item.dataKey}:`, err);
      }
    }
  }

  // Check sync status
  getStatus() {
    return {
      online: this.online,
      pendingCount: this.pendingSync.length,
      appName: this.appName
    };
  }
}

// Export for use in apps
window.SupabaseSync = SupabaseSync;
