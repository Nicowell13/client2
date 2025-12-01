import axios from 'axios';
import toast from 'react-hot-toast';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

// Create axios instance
const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor - add token to headers
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor - handle errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Unauthorized - redirect to login
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

// Auth APIs
export const authAPI = {
  login: (email: string, password: string) =>
    api.post('/api/auth/login', { email, password }),
  
  getMe: () => api.get('/api/auth/me'),
  
  logout: () => api.post('/api/auth/logout'),
};

// Session APIs
export const sessionAPI = {
  getAll: () => api.get('/api/sessions'),
  
  create: (name: string) => api.post('/api/sessions', { name }),
  
  getQR: (sessionId: string) => api.get(`/api/sessions/${sessionId}/qr`),
  
  stop: (sessionId: string) => api.post(`/api/sessions/${sessionId}/stop`),
  
  delete: (sessionId: string) => api.delete(`/api/sessions/${sessionId}`),
};

// Contact APIs
export const contactAPI = {
  getAll: () => api.get('/api/contacts'),
  
  uploadCSV: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/api/contacts/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  
  create: (data: any) => api.post('/api/contacts', data),
  
  delete: (contactId: string) => api.delete(`/api/contacts/${contactId}`),
};

// Campaign APIs
export const campaignAPI = {
  getAll: () => api.get('/api/campaigns'),
  
  create: (data: any) => api.post('/api/campaigns', data),
  
  send: (campaignId: string, contactIds: string[]) =>
    api.post(`/api/campaigns/${campaignId}/send`, { contactIds }),
  
  delete: (campaignId: string) => api.delete(`/api/campaigns/${campaignId}`),
};

// Message APIs
export const messageAPI = {
  getByCampaign: (campaignId: string) =>
    api.get(`/api/campaigns/${campaignId}/messages`),
};
