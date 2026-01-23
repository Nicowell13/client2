// src/lib/api-client.ts
import axios from 'axios';
import toast from 'react-hot-toast';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.watrix.online';

// Axios instance
const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add token to every request
api.interceptors.request.use(
  (config) => {
    const token = typeof window !== "undefined" ? localStorage.getItem('token') : null;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Global error handler
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
      toast.error('Session expired. Please login again.');
    } else if (error.response?.status === 403) {
      toast.error('Access denied');
    } else if (error.response?.data?.error) {
      toast.error(error.response.data.error);
    }
    return Promise.reject(error);
  }
);

export default api;

// =========================
// AUTH API
// =========================
export const authAPI = {
  login: (email: string, password: string) =>
    api.post('/api/auth/login', { email, password }),

  getMe: () => api.get('/api/auth/me'),

  logout: () => api.post('/api/auth/logout'),
};

// =========================
// SESSIONS API
// =========================
export const sessionAPI = {
  getAll: () => api.get('/api/sessions'),

  create: (name: string) => api.post('/api/sessions', { name }),

  start: (sessionId: string) => api.post(`/api/sessions/${sessionId}/start`),

  getQR: (sessionId: string) => api.get(`/api/sessions/${sessionId}/qr`),

  stop: (sessionId: string) => api.post(`/api/sessions/${sessionId}/stop`),

  delete: (sessionId: string) => api.delete(`/api/sessions/${sessionId}`),

  requestPairingCode: (sessionId: string, phoneNumber: string) =>
    api.post(`/api/sessions/${sessionId}/request-code`, { phoneNumber }),

  // Reset job count untuk session (mengembalikan session dari resting)
  resetJobs: (sessionId: string) =>
    api.post(`/api/sessions/${sessionId}/reset-jobs`),

  // Retry semua pesan dengan status 'waiting'
  retryWaiting: () => api.post('/api/sessions/retry-waiting'),
};

// =========================
// CONTACT API
// =========================
export const contactAPI = {
  getAll: (params?: { page?: number; limit?: number; search?: string; sessionId?: string }) =>
    api.get('/api/contacts', { params }),

  uploadCSV: (fileOrFiles: File | File[], sessionId?: string) => {
    const formData = new FormData();

    const files = Array.isArray(fileOrFiles) ? fileOrFiles : [fileOrFiles];
    files.forEach((f) => formData.append('files', f));
    if (files[0]) formData.append('file', files[0]);
    if (sessionId) formData.append('sessionId', sessionId);

    return api.post('/api/contacts/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  create: (data: any) => api.post('/api/contacts', data),

  bulkDelete: (payload: { ids?: string[]; all?: boolean }) =>
    api.post('/api/contacts/bulk-delete', payload),

  delete: (contactId: string) => api.delete(`/api/contacts/${contactId}`),
};

// =========================
// CAMPAIGN API (FIXED!)
// =========================
export const campaignAPI = {
  getAll: () => api.get('/api/campaigns'),

  create: (data: any) => {
    if (typeof window !== 'undefined' && data instanceof FormData) {
      return api.post('/api/campaigns', data, {
        headers: {}, // Let browser set Content-Type for FormData
      });
    }
    return api.post('/api/campaigns', data);
  },

  /** FIX UTAMA → sekarang mengirim sessionId */
  send: (campaignId: string, sessionId: string, contactIds: string[]) =>
    api.post(`/api/campaigns/${campaignId}/send`, {
      sessionId,
      contactIds,
    }),

  autoExecute: (delayBetweenCampaigns?: number) =>
    api.post('/api/campaigns/auto-execute', {
      delayBetweenCampaigns,
    }),

  delete: (campaignId: string) => api.delete(`/api/campaigns/${campaignId}`),
};

// =========================
// MESSAGES API
// =========================
export const messageAPI = {
  getAll: () => api.get('/api/campaigns/messages/all'),

  getByCampaign: (campaignId: string) =>
    api.get(`/api/campaigns/${campaignId}/messages`),
};

// =========================
// UPLOAD API
// =========================
export const uploadAPI = {
  uploadImage: (file: File) => {
    const formData = new FormData();
    formData.append('image', file);
    return api.post('/api/upload/image', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};