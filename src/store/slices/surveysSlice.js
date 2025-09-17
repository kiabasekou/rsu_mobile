// ===== 2. SLICE ENQUÊTES OFFLINE =====
// store/slices/surveysSlice.js
import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { surveyAPI } from '../../services/api';
import { generateUUID } from '../../utils/uuid';

// Actions asynchrones
export const fetchSurveyTemplates = createAsyncThunk(
  'surveys/fetchTemplates',
  async (_, { rejectWithValue }) => {
    try {
      const response = await surveyAPI.getTemplates();
      return response.data;
    } catch (error) {
      return rejectWithValue(error.message);
    }
  }
);

export const startSurveySession = createAsyncThunk(
  'surveys/startSession',
  async ({ templateId, beneficiaryId }, { getState }) => {
    const state = getState();
    const template = state.surveys.templates.find(t => t.id === templateId);
    const surveyor = state.auth.user;
    
    const sessionId = generateUUID();
    const newSession = {
      id: sessionId,
      templateId,
      beneficiaryId,
      surveyorId: surveyor.id,
      status: 'IN_PROGRESS',
      startTime: new Date().toISOString(),
      responses: {},
      location: null,
      mediaFiles: [],
      localOnly: true, // Marquer comme local jusqu'à sync
      lastModified: new Date().toISOString()
    };
    
    return newSession;
  }
);

const surveysSlice = createSlice({
  name: 'surveys',
  initialState: {
    templates: [],
    activeSessions: [],
    completedSessions: [],
    currentSession: null,
    isOnline: false,
    syncQueue: [],
    loading: false,
    error: null
  },
  reducers: {
    setCurrentSession: (state, action) => {
      state.currentSession = action.payload;
    },
    
    updateSessionResponse: (state, action) => {
      const { sessionId, questionId, response } = action.payload;
      const session = state.activeSessions.find(s => s.id === sessionId) || 
                    state.currentSession;
      
      if (session && session.id === sessionId) {
        session.responses[questionId] = {
          ...response,
          timestamp: new Date().toISOString(),
          modified: true
        };
        session.lastModified = new Date().toISOString();
        
        // Ajouter à la queue de sync
        if (!state.syncQueue.includes(sessionId)) {
          state.syncQueue.push(sessionId);
        }
      }
    },
    
    completeSession: (state, action) => {
      const sessionId = action.payload;
      const sessionIndex = state.activeSessions.findIndex(s => s.id === sessionId);
      
      if (sessionIndex !== -1) {
        const session = state.activeSessions[sessionIndex];
        session.status = 'COMPLETED';
        session.endTime = new Date().toISOString();
        session.duration = calculateDuration(session.startTime, session.endTime);
        
        // Déplacer vers sessions complétées
        state.completedSessions.push(session);
        state.activeSessions.splice(sessionIndex, 1);
        
        // Reset session courante
        if (state.currentSession?.id === sessionId) {
          state.currentSession = null;
        }
        
        // Ajouter à la queue de sync prioritaire
        state.syncQueue.unshift(sessionId);
      }
    },
    
    addMediaFile: (state, action) => {
      const { sessionId, mediaFile } = action.payload;
      const session = findSessionById(state, sessionId);
      
      if (session) {
        session.mediaFiles.push({
          ...mediaFile,
          id: generateUUID(),
          localPath: mediaFile.uri,
          uploadStatus: 'PENDING',
          timestamp: new Date().toISOString()
        });
        session.lastModified = new Date().toISOString();
      }
    },
    
    setOnlineStatus: (state, action) => {
      state.isOnline = action.payload;
    },
    
    markSynced: (state, action) => {
      const sessionId = action.payload;
      const session = findSessionById(state, sessionId);
      
      if (session) {
        session.localOnly = false;
        session.synced = true;
        session.syncedAt = new Date().toISOString();
      }
      
      // Retirer de la queue
      state.syncQueue = state.syncQueue.filter(id => id !== sessionId);
    }
  },
  
  extraReducers: (builder) => {
    builder
      .addCase(fetchSurveyTemplates.fulfilled, (state, action) => {
        state.templates = action.payload;
        state.loading = false;
      })
      .addCase(startSurveySession.fulfilled, (state, action) => {
        state.activeSessions.push(action.payload);
        state.currentSession = action.payload;
      });
  }
});

// Utilitaires
function calculateDuration(startTime, endTime) {
  const start = new Date(startTime);
  const end = new Date(endTime);
  return Math.round((end - start) / 1000 / 60); // durée en minutes
}

function findSessionById(state, sessionId) {
  return state.activeSessions.find(s => s.id === sessionId) ||
         state.completedSessions.find(s => s.id === sessionId) ||
         (state.currentSession?.id === sessionId ? state.currentSession : null);
}

export const {
  setCurrentSession,
  updateSessionResponse,
  completeSession,
  addMediaFile,
  setOnlineStatus,
  markSynced
} = surveysSlice.actions;

export default surveysSlice.reducer;