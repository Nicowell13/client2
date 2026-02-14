'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import DashboardLayout from '@/components/DashboardLayout';
import Link from 'next/link';
import { ArrowLeft, Upload, Plus, Trash2 } from 'lucide-react';
import { contactAPI, sessionAPI } from '@/lib/api-client';
import toast from 'react-hot-toast';
import { useDropzone } from 'react-dropzone';

interface Contact {
  id: string;
  name: string;
  phoneNumber: string;
  email: string | null;
  createdAt: string;
  sessionId: string;
  session?: { id: string; name: string };
}

interface Session {
  id: string;
  name: string;
  status: string;
}

interface ContactsPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export default function ContactsPage() {
  const router = useRouter();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSession, setSelectedSession] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newContact, setNewContact] = useState({ name: '', phoneNumber: '', email: '' });
  const [page, setPage] = useState(1);
  const [limit] = useState(50);
  const [pagination, setPagination] = useState<ContactsPagination | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      router.push('/login');
      return;
    }
    fetchSessions();
  }, []);

  useEffect(() => {
    if (sessions.length > 0 && !selectedSession) {
      setSelectedSession(sessions[0].id);
    }
  }, [sessions]);

  useEffect(() => {
    setPage(1);
    setSelectedIds(new Set());
  }, [selectedSession]);

  useEffect(() => {
    if (selectedSession) fetchContacts(page);
    setSelectedIds(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSession, page]);

  const fetchSessions = async () => {
    try {
      const res = await sessionAPI.getAll();
      setSessions(res.data?.data || []);
    } catch {
      toast.error("Failed to load sessions");
    }
  };

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;
    fetchContacts(page);
    setSelectedIds(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const isAllSelectedOnPage = contacts.length > 0 && selectedIds.size === contacts.length;

  const toggleSelectAllOnPage = () => {
    setSelectedIds((prev) => {
      if (contacts.length === 0) return new Set();
      if (prev.size === contacts.length) return new Set();
      return new Set(contacts.map((c) => c.id));
    });
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const fetchContacts = async (targetPage: number) => {
    if (!selectedSession) return;
    try {
      const resp = await contactAPI.getAll({ page: targetPage, limit, sessionId: selectedSession });
      const payload = resp.data;
      const data = Array.isArray(payload) ? payload : payload?.data || [];
      setContacts(data);
      if (payload?.pagination) {
        setPagination(payload.pagination);
      } else {
        setPagination(null);
      }
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'Failed to load contacts');
    } finally {
      setLoading(false);
    }
  };

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const files = acceptedFiles || [];
    if (files.length === 0 || !selectedSession) return;

    setUploading(true);
    try {
      const { data } = await contactAPI.uploadCSV(files, selectedSession);
      const imported = Number(data?.data?.imported);
      if (!Number.isNaN(imported) && imported === 0) {
        toast.error(data?.message || '0 contacts imported. Check CSV header/format.');
      } else {
        toast.success(data?.message || 'Contacts uploaded');
      }
      fetchContacts(page);
    } catch (error) {
      toast.error('Failed to upload contacts');
    } finally {
      setUploading(false);
    }
  }, [selectedSession, page]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'text/csv': ['.csv'] },
    multiple: true,
    maxFiles: 20,
  });

  const addContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSession) return toast.error('Please select a session');
    try {
      await contactAPI.create({ ...newContact, sessionId: selectedSession });
      toast.success('Contact added successfully');
      setNewContact({ name: '', phoneNumber: '', email: '' });
      setShowAddForm(false);
      fetchContacts(page);
    } catch (error) {
      toast.error('Failed to add contact');
    }
  };

  const deleteContact = async (id: string) => {
    if (!confirm('Are you sure you want to delete this contact?')) return;
    try {
      await contactAPI.delete(id);
      toast.success('Contact deleted');
      fetchContacts(page);
    } catch (error) {
      toast.error('Failed to delete contact');
    }
  };

  const bulkDeleteSelected = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const ok = confirm(`Delete ${ids.length} selected contact(s)?`);
    if (!ok) return;

    try {
      const resp = await contactAPI.bulkDelete({ ids });
      toast.success(resp.data?.message || 'Contacts deleted');
      setSelectedIds(new Set());
      setPage(1);
      fetchContacts(1);
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'Failed to delete contacts');
    }
  };

  const bulkDeleteAll = async () => {
    const ok = confirm('Delete ALL contacts? This cannot be undone.');
    if (!ok) return;

    try {
      const resp = await contactAPI.bulkDelete({ all: true });
      toast.success(resp.data?.message || 'All contacts deleted');
      setSelectedIds(new Set());
      setPage(1);
      fetchContacts(1);
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'Failed to delete all contacts');
    }
  };

  return (
    <DashboardLayout title="Contacts" description="Manage your contact list">
      <div>
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700"
            >
              <Plus className="w-5 h-5" />
              Add Contact
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={bulkDeleteSelected}
              disabled={selectedIds.size === 0}
              className="px-4 py-2 rounded-lg border border-red-600 text-red-600 text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-red-50"
            >
              Delete Selected ({selectedIds.size})
            </button>
            <button
              onClick={bulkDeleteAll}
              className="px-4 py-2 rounded-lg border border-red-600 text-red-600 text-sm hover:bg-red-50"
            >
              Delete All
            </button>
          </div>
        </div>

        {/* Session Selector */}
        <div className="mb-6">
          <label className="block mb-1 font-medium">Select Session</label>
          <select
            className="w-full border px-3 py-2 rounded-lg"
            value={selectedSession}
            onChange={e => setSelectedSession(e.target.value)}
          >
            {sessions.map(s => (
              <option key={s.id} value={s.id}>{s.name} ({s.status})</option>
            ))}
          </select>
        </div>

        {/* Upload CSV */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Upload CSV</h2>
          <div
            {...getRootProps()}
            className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${isDragActive ? 'border-green-600 bg-green-50' : 'border-gray-300 hover:border-green-600'
              }`}
          >
            <input {...getInputProps()} />
            <Upload className="w-12 h-12 mx-auto mb-4 text-gray-400" />
            {uploading ? (
              <p className="text-gray-600">Uploading...</p>
            ) : isDragActive ? (
              <p className="text-gray-600">Drop the CSV file(s) here...</p>
            ) : (
              <div>
                <p className="text-gray-600 mb-2">Drag & drop CSV file(s) here, or click to select</p>
                <p className="text-sm text-gray-500">Format: name, phoneNumber, email (optional)</p>
              </div>
            )}
          </div>
        </div>

        {/* Add Contact Form */}
        {showAddForm && (
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <h2 className="text-xl font-semibold mb-4">Add New Contact</h2>
            <form onSubmit={addContact} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Name</label>
                <input
                  type="text"
                  value={newContact.name}
                  onChange={(e) => setNewContact({ ...newContact, name: e.target.value })}
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-green-600"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Phone Number</label>
                <input
                  type="tel"
                  value={newContact.phoneNumber}
                  onChange={(e) => setNewContact({ ...newContact, phoneNumber: e.target.value })}
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-green-600"
                  placeholder="628123456789"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Email (Optional)</label>
                <input
                  type="email"
                  value={newContact.email}
                  onChange={(e) => setNewContact({ ...newContact, email: e.target.value })}
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-green-600"
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700"
                >
                  Save Contact
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-700"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Contacts List */}
        <div className="bg-white rounded-lg shadow">
          <div className="p-6 border-b">
            <h2 className="text-xl font-semibold">
              All Contacts ({pagination?.total ?? contacts.length}/50)
            </h2>
          </div>
          {loading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600 mx-auto"></div>
            </div>
          ) : contacts.length === 0 ? (
            <div className="p-12 text-center text-gray-600">
              No contacts found. Upload a CSV or add contacts manually.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      <input
                        type="checkbox"
                        checked={isAllSelectedOnPage}
                        onChange={toggleSelectAllOnPage}
                        aria-label="Select all contacts on this page"
                      />
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Phone</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Created</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {contacts.map((contact) => (
                    <tr key={contact.id}>
                      <td className="px-6 py-4">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(contact.id)}
                          onChange={() => toggleSelected(contact.id)}
                          aria-label={`Select ${contact.name}`}
                        />
                      </td>
                      <td className="px-6 py-4">{contact.name}</td>
                      <td className="px-6 py-4">{contact.phoneNumber}</td>
                      <td className="px-6 py-4">{contact.email || '-'}</td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        {new Date(contact.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4">
                        <button
                          onClick={() => deleteContact(contact.id)}
                          className="text-red-600 hover:text-red-800"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Pagination */}
              {pagination && pagination.totalPages > 1 && (
                <div className="flex items-center justify-between px-6 py-4 border-t bg-white">
                  <div className="text-sm text-gray-600">
                    Page {pagination.page} of {pagination.totalPages}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={pagination.page <= 1}
                      className="px-3 py-2 rounded-lg border text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                    >
                      Prev
                    </button>
                    <button
                      onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                      disabled={pagination.page >= pagination.totalPages}
                      className="px-3 py-2 rounded-lg border text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
