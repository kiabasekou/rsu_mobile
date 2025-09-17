// ===== 5. SERVICE API AVEC RETRY INTELLIGENT =====
// services/api.js
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-netinfo/netinfo';

class APIService {
  constructor() {
    this.baseURL = __DEV__ ? 'http://10.0.2.2:8000/api/' : 'https://rsu.gov.ga/api/';
    this.timeout = 30000;
    this.retryAttempts = 3;
    this.retryDelay = 1000;
    
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: this.timeout,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });
    
    this.setupInterceptors();
  }
  
  setupInterceptors() {
    // Request interceptor - ajouter token auth
    this.client.interceptors.request.use(
      async (config) => {
        const token = await AsyncStorage.getItem('auth_token');
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        
        // Log pour debug
        console.log(`🌐 API ${config.method?.toUpperCase()} ${config.url}`);
        
        return config;
      },
      (error) => Promise.reject(error)
    );
    
    // Response interceptor - gestion erreurs
    this.client.interceptors.response.use(
      (response) => {
        console.log(`✅ API Success ${response.config.method?.toUpperCase()} ${response.config.url}`);
        return response;
      },
      async (error) => {
        console.error(`❌ API Error ${error.config?.method?.toUpperCase()} ${error.config?.url}:`, error.message);
        
        // Auto-retry sur erreurs réseau
        if (this.shouldRetry(error)) {
          return this.retryRequest(error.config);
        }
        
        // Gestion erreurs auth
        if (error.response?.status === 401) {
          await this.handleAuthError();
        }
        
        return Promise.reject(error);
      }
    );
  }
  
  shouldRetry(error) {
    // Retry sur erreurs réseau ou 5xx
    return !error.response || 
           error.code === 'NETWORK_ERROR' ||
           error.code === 'TIMEOUT' ||
           (error.response.status >= 500 && error.response.status < 600);
  }
  
  async retryRequest(originalConfig) {
    const maxRetries = originalConfig._retryCount || this.retryAttempts;
    originalConfig._retryCount = (originalConfig._retryCount || 0) + 1;
    
    if (originalConfig._retryCount > maxRetries) {
      throw new Error(`Échec après ${maxRetries} tentatives`);
    }
    
    // Vérifier connectivité avant retry
    const netInfo = await NetInfo.fetch();
    if (!netInfo.isConnected) {
      throw new Error('Pas de connexion réseau');
    }
    
    // Délai exponentiel
    const delay = this.retryDelay * Math.pow(2, originalConfig._retryCount - 1);
    await new Promise(resolve => setTimeout(resolve, delay));
    
    console.log(`🔄 Retry ${originalConfig._retryCount}/${maxRetries} pour ${originalConfig.url}`);
    
    return this.client.request(originalConfig);
  }
  
  async handleAuthError() {
    // Supprimer token invalide
    await AsyncStorage.removeItem('auth_token');
    
    // Rediriger vers login ou refresh token
    // NavigationService.navigate('Login');
  }
  
  // ===== ENDPOINTS ENQUÊTES =====
  
  async getTemplates() {
    const response = await this.client.get('surveys/templates/');
    return {
      success: true,
      data: response.data
    };
  }
  
  async syncSession(sessionData) {
    const response = await this.client.post('surveys/sync-session/', sessionData);
    return {
      success: true,
      data: response.data
    };
  }
  
  async uploadMedia(formData) {
    const response = await this.client.post('surveys/upload-media/', formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      },
      timeout: 60000 // 1 minute pour upload fichiers
    });
    
    return {
      success: true,
      data: response.data
    };
  }
  
  async getBeneficiaries(searchQuery, limit = 50) {
    const params = {
      search: searchQuery,
      limit
    };
    
    const response = await this.client.get('identity/persons/', { params });
    return {
      success: true,
      data: response.data
    };
  }
  
  async getAssignedRegions(surveyorId) {
    const response = await this.client.get(`surveys/surveyors/${surveyorId}/regions/`);
    return {
      success: true,
      data: response.data
    };
  }
  
  // ===== MÉTHODES OFFLINE-FIRST =====
  
  async syncWithRetry(endpoint, data, options = {}) {
    const cacheKey = `pending_sync_${Date.now()}`;
    
    try {
      // Tentative immédiate si en ligne
      const netInfo = await NetInfo.fetch();
      if (netInfo.isConnected) {
        return await this.client.post(endpoint, data, options);
      } else {
        // Sauvegarder pour sync ultérieure
        await this.cacheForLaterSync(cacheKey, endpoint, data, options);
        return { success: false, cached: true, cacheKey };
      }
    } catch (error) {
      // En cas d'erreur, mettre en cache aussi
      await this.cacheForLaterSync(cacheKey, endpoint, data, options);
      throw error;
    }
  }
  
  async cacheForLaterSync(cacheKey, endpoint, data, options) {
    const syncItem = {
      key: cacheKey,
      endpoint,
      data,
      options,
      timestamp: new Date().toISOString(),
      attempts: 0
    };
    
    const existingCache = await AsyncStorage.getItem('pending_syncs') || '[]';
    const pendingSyncs = JSON.parse(existingCache);
    pendingSyncs.push(syncItem);
    
    await AsyncStorage.setItem('pending_syncs', JSON.stringify(pendingSyncs));
  }
  
  async processPendingSyncs() {
    const cachedSyncs = await AsyncStorage.getItem('pending_syncs') || '[]';
    const pendingSyncs = JSON.parse(cachedSyncs);
    
    const remainingSyncs = [];
    
    for (const syncItem of pendingSyncs) {
      try {
        await this.client.post(syncItem.endpoint, syncItem.data, syncItem.options);
        console.log(`✅ Sync cached réussi: ${syncItem.key}`);
      } catch (error) {
        syncItem.attempts++;
        if (syncItem.attempts < 3) {
          remainingSyncs.push(syncItem);
        } else {
          console.error(`❌ Sync cached échoué définitivement: ${syncItem.key}`);
        }
      }
    }
    
    await AsyncStorage.setItem('pending_syncs', JSON.stringify(remainingSyncs));
  }
}

export const surveyAPI = new APIService();
