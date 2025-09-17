// ===== 3. SERVICE SYNCHRONISATION INTELLIGENT =====
// services/syncService.js
import NetInfo from '@react-native-netinfo/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { surveyAPI } from './api';
import { store } from '../store';
import { markSynced, setOnlineStatus } from '../store/slices/surveysSlice';

class SyncService {
  constructor() {
    this.isOnline = false;
    this.syncInProgress = false;
    this.retryAttempts = {};
    this.maxRetries = 3;
    this.syncQueue = [];
    
    this.initNetworkListener();
  }
  
  initNetworkListener() {
    NetInfo.addEventListener(state => {
      const wasOnline = this.isOnline;
      this.isOnline = state.isConnected && state.isInternetReachable;
      
      store.dispatch(setOnlineStatus(this.isOnline));
      
      // Si connexion rétablie, démarrer sync auto
      if (!wasOnline && this.isOnline) {
        this.syncPendingData();
      }
    });
  }
  
  async syncPendingData() {
    if (this.syncInProgress || !this.isOnline) {
      return;
    }
    
    this.syncInProgress = true;
    console.log('🔄 Début synchronisation...');
    
    try {
      const state = store.getState();
      const { syncQueue, completedSessions, activeSessions } = state.surveys;
      
      // Synchroniser par priorité: sessions complétées d'abord
      const sessionsToSync = [
        ...completedSessions.filter(s => s.localOnly),
        ...activeSessions.filter(s => s.localOnly && s.responses)
      ];
      
      for (const session of sessionsToSync) {
        await this.syncSession(session);
      }
      
      // Synchroniser médias
      await this.syncMediaFiles();
      
      console.log('✅ Synchronisation terminée');
      
    } catch (error) {
      console.error('❌ Erreur synchronisation:', error);
    } finally {
      this.syncInProgress = false;
    }
  }
  
  async syncSession(session) {
    const sessionId = session.id;
    
    try {
      // Préparer données pour API
      const syncData = {
        session: {
          id: session.id,
          templateId: session.templateId,
          beneficiaryId: session.beneficiaryId,
          surveyorId: session.surveyorId,
          status: session.status,
          startTime: session.startTime,
          endTime: session.endTime,
          duration: session.duration,
          location: session.location
        },
        responses: Object.entries(session.responses).map(([questionId, response]) => ({
          questionId,
          ...response
        })),
        mediaFiles: session.mediaFiles.filter(m => m.uploadStatus === 'COMPLETED')
      };
      
      // Envoi vers API Django
      const response = await surveyAPI.syncSession(syncData);
      
      if (response.success) {
        store.dispatch(markSynced(sessionId));
        console.log(`✅ Session ${sessionId} synchronisée`);
        
        // Reset retry count
        delete this.retryAttempts[sessionId];
      }
      
    } catch (error) {
      console.error(`❌ Erreur sync session ${sessionId}:`, error);
      
      // Gestion retry
      this.retryAttempts[sessionId] = (this.retryAttempts[sessionId] || 0) + 1;
      
      if (this.retryAttempts[sessionId] < this.maxRetries) {
        console.log(`🔄 Retry ${this.retryAttempts[sessionId]}/${this.maxRetries} pour ${sessionId}`);
        setTimeout(() => this.syncSession(session), 5000 * this.retryAttempts[sessionId]);
      } else {
        console.error(`🔴 Échec définitif sync session ${sessionId}`);
        // Marquer comme échec pour intervention manuelle
        await this.markSyncFailed(sessionId, error);
      }
    }
  }
  
  async syncMediaFiles() {
    const state = store.getState();
    const allSessions = [...state.surveys.completedSessions, ...state.surveys.activeSessions];
    
    for (const session of allSessions) {
      const pendingMedia = session.mediaFiles.filter(m => 
        m.uploadStatus === 'PENDING' && m.localPath
      );
      
      for (const mediaFile of pendingMedia) {
        await this.uploadMediaFile(session.id, mediaFile);
      }
    }
  }
  
  async uploadMediaFile(sessionId, mediaFile) {
    try {
      mediaFile.uploadStatus = 'UPLOADING';
      
      const formData = new FormData();
      formData.append('file', {
        uri: mediaFile.localPath,
        type: mediaFile.mimeType,
        name: mediaFile.originalFilename
      });
      formData.append('sessionId', sessionId);
      formData.append('questionId', mediaFile.questionId);
      formData.append('mediaType', mediaFile.mediaType);
      
      const response = await surveyAPI.uploadMedia(formData);
      
      if (response.success) {
        mediaFile.uploadStatus = 'COMPLETED';
        mediaFile.cloudUrl = response.data.url;
        console.log(`✅ Média ${mediaFile.id} uploadé`);
      }
      
    } catch (error) {
      mediaFile.uploadStatus = 'FAILED';
      console.error(`❌ Erreur upload média ${mediaFile.id}:`, error);
    }
  }
  
  async markSyncFailed(sessionId, error) {
    const failureRecord = {
      sessionId,
      error: error.message,
      timestamp: new Date().toISOString(),
      retryCount: this.retryAttempts[sessionId]
    };
    
    // Sauvegarder les échecs pour analyse
    const existingFailures = await AsyncStorage.getItem('sync_failures') || '[]';
    const failures = JSON.parse(existingFailures);
    failures.push(failureRecord);
    await AsyncStorage.setItem('sync_failures', JSON.stringify(failures));
  }
  
  // Force sync manuelle
  async forceSyncSession(sessionId) {
    const state = store.getState();
    const session = findSessionById(state.surveys, sessionId);
    
    if (session && this.isOnline) {
      delete this.retryAttempts[sessionId]; // Reset retry count
      await this.syncSession(session);
    }
  }
  
  // Statistiques de sync
  getSyncStats() {
    const state = store.getState();
    const { completedSessions, activeSessions, syncQueue } = state.surveys;
    
    const totalSessions = completedSessions.length + activeSessions.length;
    const syncedSessions = completedSessions.filter(s => !s.localOnly).length + 
                          activeSessions.filter(s => !s.localOnly).length;
    const pendingSessions = syncQueue.length;
    
    return {
      total: totalSessions,
      synced: syncedSessions,
      pending: pendingSessions,
      syncRate: totalSessions > 0 ? (syncedSessions / totalSessions * 100).toFixed(1) : 0
    };
  }
}

export const syncService = new SyncService();