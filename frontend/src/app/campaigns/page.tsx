'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus } from 'lucide-react';
import api from '@/lib/api';
import toast from 'react-hot-toast';

interface Campaign {
  id: string;
  name: string;
  message: string;
  imageUrl: string | null;
  status: string;
  totalContacts: number;
  sentCount: number;
  failedCount: number;
  buttons: Array<{ id: string; label: string; url: string; order: number }>;
  session: { name: string; status: string };
  createdAt: string;
}

interface Session {
  id: string;
  name: string;
  status: string;
}

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newCampaign, setNewCampaign] = useState({
    name: '',
    message: '',
    imageUrl: '',
    sessionId: '',
    button1Label: '',
    button1Url: '',
    button2Label: '',
    button2Url: '',
  });

  useEffect(() => {
    fetchCampaigns();
    fetchSessions();
  }, []);

  const fetchCampaigns = async () => {
    try {
      const { data } = await api.get('/api/campaigns');
      setCampaigns(data.data);
    } catch (error) {
      toast.error('Failed to load campaigns');
    } finally {
      setLoading(false);
    }
  };

  const fetchSessions = async () => {
    try {
      const { data } = await api.get('/api/sessions');
      setSessions(data.data);
    } catch (error) {
      console.error('Failed to load sessions');
    }
  };

  const createCampaign = async (e: React.FormEvent) => {
    e.preventDefault();

    const buttons = [];
    if (newCampaign.button1Label && newCampaign.button1Url) {
      buttons.push({ label: newCampaign.button1Label, url: newCampaign.button1Url });
    }
    if (newCampaign.button2Label && newCampaign.button2Url) {
      buttons.push({ label: newCampaign.button2Label, url: newCampaign.button2Url });
    }

    try {
      await api.post('/api/campaigns', {
        name: newCampaign.name,
        message: newCampaign.message,
        imageUrl: newCampaign.imageUrl || null,
        sessionId: newCampaign.sessionId,
        buttons,
      });
      toast.success('Campaign created successfully');
      setShowCreateForm(false);
      setNewCampaign({
        name: '',
        message: '',
        imageUrl: '',
        sessionId: '',
        button1Label: '',
        button1Url: '',
        button2Label: '',
        button2Url: '',
      });
      fetchCampaigns();
    } catch (error) {
      toast.error('Failed to create campaign');
    }
  };

  const sendCampaign = async (campaignId: string) => {
    if (!confirm('Send this campaign to all contacts?')) return;
    try {
      const { data } = await api.post(`/api/campaigns/${campaignId}/send`, {});
      toast.success(data.message);
      fetchCampaigns();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to send campaign');
    }
  };

  const deleteCampaign = async (campaignId: string) => {
    if (!confirm('Are you sure you want to delete this campaign?')) return;
    try {
      await api.delete(`/api/campaigns/${campaignId}`);
      toast.success('Campaign deleted');
      fetchCampaigns();
    } catch (error) {
      toast.error('Failed to delete campaign');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'sent':
        return 'bg-green-100 text-green-800';
      case 'sending':
        return 'bg-yellow-100 text-yellow-800';
      case 'draft':
        return 'bg-gray-100 text-gray-800';
      case 'failed':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-gray-600 hover:text-gray-900">
              <ArrowLeft className="w-6 h-6" />
            </Link>
            <h1 className="text-3xl font-bold text-gray-900">Campaigns</h1>
          </div>
          <button
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700"
          >
            <Plus className="w-5 h-5" />
            Create Campaign
          </button>
        </div>

        {/* Create Campaign Form */}
        {showCreateForm && (
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <h2 className="text-xl font-semibold mb-4">Create New Campaign</h2>
            <form onSubmit={createCampaign} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Campaign Name</label>
                <input
                  type="text"
                  value={newCampaign.name}
                  onChange={(e) => setNewCampaign({ ...newCampaign, name: e.target.value })}
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-green-600"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Session</label>
                <select
                  value={newCampaign.sessionId}
                  onChange={(e) => setNewCampaign({ ...newCampaign, sessionId: e.target.value })}
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-green-600"
                  required
                >
                  <option value="">Select a session</option>
                  {sessions.map((session) => (
                    <option key={session.id} value={session.id}>
                      {session.name} ({session.status})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Message</label>
                <textarea
                  value={newCampaign.message}
                  onChange={(e) => setNewCampaign({ ...newCampaign, message: e.target.value })}
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-green-600"
                  rows={4}
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Image URL (Optional)</label>
                <input
                  type="url"
                  value={newCampaign.imageUrl}
                  onChange={(e) => setNewCampaign({ ...newCampaign, imageUrl: e.target.value })}
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-green-600"
                  placeholder="https://example.com/image.jpg"
                />
              </div>

              <div className="border-t pt-4">
                <h3 className="font-semibold mb-3">Buttons (Max 2)</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">Button 1 Label</label>
                    <input
                      type="text"
                      value={newCampaign.button1Label}
                      onChange={(e) => setNewCampaign({ ...newCampaign, button1Label: e.target.value })}
                      className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-green-600"
                      placeholder="Visit Website"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Button 1 URL</label>
                    <input
                      type="url"
                      value={newCampaign.button1Url}
                      onChange={(e) => setNewCampaign({ ...newCampaign, button1Url: e.target.value })}
                      className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-green-600"
                      placeholder="https://example.com"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Button 2 Label</label>
                    <input
                      type="text"
                      value={newCampaign.button2Label}
                      onChange={(e) => setNewCampaign({ ...newCampaign, button2Label: e.target.value })}
                      className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-green-600"
                      placeholder="Contact Us"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Button 2 URL</label>
                    <input
                      type="url"
                      value={newCampaign.button2Url}
                      onChange={(e) => setNewCampaign({ ...newCampaign, button2Url: e.target.value })}
                      className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-green-600"
                      placeholder="https://example.com/contact"
                    />
                  </div>
                </div>
              </div>

              <div className="flex gap-2 pt-4">
                <button
                  type="submit"
                  className="bg-green-600 text-white px-6 py-2 rounded-lg hover:bg-green-700"
                >
                  Create Campaign
                </button>
                <button
                  type="button"
                  onClick={() => setShowCreateForm(false)}
                  className="bg-gray-600 text-white px-6 py-2 rounded-lg hover:bg-gray-700"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Campaigns List */}
        <div className="space-y-6">
          {loading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600 mx-auto"></div>
            </div>
          ) : campaigns.length === 0 ? (
            <div className="bg-white rounded-lg shadow p-12 text-center">
              <p className="text-gray-600">No campaigns found. Create one to get started.</p>
            </div>
          ) : (
            campaigns.map((campaign) => (
              <div key={campaign.id} className="bg-white rounded-lg shadow p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-xl font-semibold">{campaign.name}</h3>
                      <span className={`px-3 py-1 rounded-full text-sm ${getStatusColor(campaign.status)}`}>
                        {campaign.status}
                      </span>
                    </div>
                    <p className="text-gray-600 text-sm mb-2">Session: {campaign.session.name}</p>
                    <p className="text-gray-700 mb-3">{campaign.message}</p>

                    {campaign.imageUrl && (
                      <div className="mb-3">
                        <span className="text-sm text-gray-600">Image: </span>
                        <a
                          href={campaign.imageUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-blue-600 hover:underline"
                        >
                          {campaign.imageUrl}
                        </a>
                      </div>
                    )}

                    {campaign.buttons.length > 0 && (
                      <div className="mb-3">
                        <p className="text-sm font-medium mb-1">Buttons:</p>
                        <div className="space-y-1">
                          {campaign.buttons.map((btn) => (
                            <div key={btn.id} className="text-sm text-gray-600">
                              {btn.order}. {btn.label} → {btn.url}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="flex gap-4 text-sm text-gray-600">
                      <span>Total: {campaign.totalContacts}</span>
                      <span className="text-green-600">Sent: {campaign.sentCount}</span>
                      <span className="text-red-600">Failed: {campaign.failedCount}</span>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    {campaign.status === 'draft' && (
                      <button
                        onClick={() => sendCampaign(campaign.id)}
                        className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700"
                      >
                        Send Campaign
                      </button>
                    )}
                    <button
                      onClick={() => deleteCampaign(campaign.id)}
                      className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700"
                    >
                      Delete
                    </button>
                  </div>
                </div>
                <p className="text-gray-500 text-xs">
                  Created: {new Date(campaign.createdAt).toLocaleString()}
                </p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
