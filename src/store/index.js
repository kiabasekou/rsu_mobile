// ===== 1. STORE REDUX OFFLINE-FIRST =====
// store/index.js
import { configureStore } from '@reduxjs/toolkit';
import { persistStore, persistReducer } from 'redux-persist';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { combineReducers } from 'redux';
import createSagaMiddleware from 'redux-saga';

// Reducers
import authReducer from './slices/authSlice';
import surveysReducer from './slices/surveysSlice';
import responsesReducer from './slices/responsesSlice';
import syncReducer from './slices/syncSlice';
import locationReducer from './slices/locationSlice';
import mediaReducer from './slices/mediaSlice';

// Sagas
import rootSaga from './sagas';

// Configuration Redux-Persist
const persistConfig = {
  key: 'root',
  storage: AsyncStorage,
  whitelist: ['surveys', 'responses', 'auth', 'location'], // Persister offline
  blacklist: ['sync'] // Ne pas persister les données de sync
};

const rootReducer = combineReducers({
  auth: authReducer,
  surveys: surveysReducer,
  responses: responsesReducer,
  sync: syncReducer,
  location: locationReducer,
  media: mediaReducer
});

const persistedReducer = persistReducer(persistConfig, rootReducer);
const sagaMiddleware = createSagaMiddleware();

export const store = configureStore({
  reducer: persistedReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: ['persist/PERSIST', 'persist/REHYDRATE']
      }
    }).concat(sagaMiddleware)
});

sagaMiddleware.run(rootSaga);
export const persistor = persistStore(store);