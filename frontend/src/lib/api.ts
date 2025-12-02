import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.watrix.online';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export default api;
