// mobile/src/config/api.js
const API_CONFIG = {
  // Android Emulator
  ANDROID_BASE_URL: 'http://10.0.2.2:8000/api/',
  
  // iOS Simulator / Physical devices
  IOS_BASE_URL: 'http://127.0.0.1:8000/api/',
  
  // Web
  WEB_BASE_URL: 'http://127.0.0.1:8000/api/',
  
  TIMEOUT: 30000,
  RETRY_ATTEMPTS: 3,
};

export default API_CONFIG;