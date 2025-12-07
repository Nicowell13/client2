'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus } from 'lucide-react';
import { campaignAPI, sessionAPI } from '@/lib/api-client';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';

interface CampaignButton {
  id: string;
  label: string;
  url: string;
  order: number;
}

interface Campaign {
  id: string;
  name: string;
  message: string;
  imageUrl: string | null;
  status: string;
  totalContacts: number;
  sentCount: number;
  failedCount: number;
  buttons: CampaignButton[];
  session: { name: string; status: string };
  createdAt: string;
}

interface Session {
  id: string;
  name: string;
  status: string;
}

export default function CampaignsPage() {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [refreshingSessions, setRefreshingSessions] = useState(false);

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

  // =========================
  // LOAD CAMPAIGNS + SESSIONS
  // =========================
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      router.push('/login');
      return;
    }

    fetchCampaigns();
    fetchSessions();
  }, []);

  const fetchCampaigns = async () => {
    try {
      const res = await campaignAPI.getAll();
      setCampaigns(Array.isArray(res.data) ? res.data : res.data?.data || []);
    } catch (err) {
      toast.error('Failed to load campaigns');
    } finally {
      setLoading(false);
    }
  };

  const fetchSessions = async () => {
    try {
      setRefreshingSessions(true);
      const res = await sessionAPI.getAll();
      setSessions(Array.isArray(res.data) ? res.data : res.data?.data || []);
    } catch (err) {
      toast.error('Failed to load sessions');
    } finally {
      setRefreshingSessions(false);
    }
  };

  // =========================
  // CREATE CAMPAIGN
  // =========================
  const createCampaign = async (e: any) => {
    e.preventDefault();

    const buttons = [];
    if (newCampaign.button1Label && newCampaign.button1Url)
      buttons.push({ label: newCampaign.button1Label, url: newCampaign.button1Url });

    if (newCampaign.button2Label && newCampaign.button2Url)
      buttons.push({ label: newCampaign.button2Label, url: newCampaign.button2Url });

    try {
      await campaignAPI.create({
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
    } catch {
      toast.error('Failed to create campaign');
    }
  };

  // =========================
  // SEND CAMPAIGN (FIXED!)
  // =========================
  const sendCampaign = async (campaign: Campaign) => {
    const sessionId = campaign.session.name; // FIX INTI

    if (!sessionId) {
      toast.error("This campaign has no session ID!");
      return;
    }

    if (!confirm(`Send campaign "${campaign.name}" via session "${sessionId}"?`))
      return;

    await fetchSessions();

    try {
      const res = await campaignAPI.send(
        campaign.id,
        sessionId,
        [] // contactIds if needed
      );

      toast.success(res.data?.message || 'Campaign sent');
      fetchCampaigns();
    } catch (err: any) {
      console.error(err);
      toast.error(err.response?.data?.message || 'Failed to send campaign');
    }
  };

  // =========================
  // DELETE CAMPAIGN
  // =========================
  const deleteCampaign = async (campaignId: string) => {
    if (!confirm('Are you sure you want to delete this campaign?')) return;

    try {
      await campaignAPI.delete(campaignId);
      toast.success('Campaign deleted');
      fetchCampaigns();
    } catch {
      toast.error('Failed to delete campaign');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8">

        {/* HEADER */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-gray-600 hover:text-gray-900">
              <ArrowLeft className="w-6 h-6" />
            </Link>
            <h1 className="text-3xl font-bold text-gray-900">Campaigns</h1>
          </div>

          <button
            onClick={async () => {
              if (!showCreateForm) await fetchSessions();
              setShowCreateForm(!showCreateForm);
            }}
            className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700"
          >
            <Plus className="w-5 h-5" />
            Create Campaign
          </button>
        </div>

        {/* CREATE FORM */}
        {showCreateForm && (
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <h2 className="text-xl font-semibold mb-4">Create New Campaign</h2>
            <form onSubmit={createCampaign} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Campaign Name
                </label>
                <input
                  type="text"
                  required
                  value={newCampaign.name}
                  onChange={(e) => setNewCampaign({ ...newCampaign, name: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Message
                </label>
                <textarea
                  required
                  rows={4}
                  value={newCampaign.message}
                  onChange={(e) => setNewCampaign({ ...newCampaign, message: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Image URL (optional)
                </label>
                <input
                  type="url"
                  value={newCampaign.imageUrl}
                  onChange={(e) => setNewCampaign({ ...newCampaign, imageUrl: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Session
                </label>
                <select
                  required
                  value={newCampaign.sessionId}
                  onChange={(e) => setNewCampaign({ ...newCampaign, sessionId: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                >
                  <option value="">Select a session</option>
                  {sessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.status})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Button 1 Label
                  </label>
                  <input
                    type="text"
                    value={newCampaign.button1Label}
                    onChange={(e) => setNewCampaign({ ...newCampaign, button1Label: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Button 1 URL
                  </label>
                  <input
                    type="url"
                    value={newCampaign.button1Url}
                    onChange={(e) => setNewCampaign({ ...newCampaign, button1Url: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Button 2 Label
                  </label>
                  <input
                    type="text"
                    value={newCampaign.button2Label}
                    onChange={(e) => setNewCampaign({ ...newCampaign, button2Label: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Button 2 URL
                  </label>
                  <input
                    type="url"
                    value={newCampaign.button2Url}
                    onChange={(e) => setNewCampaign({ ...newCampaign, button2Url: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="submit"
                  className="bg-green-600 text-white px-6 py-2 rounded-lg hover:bg-green-700"
                >
                  Create Campaign
                </button>
                <button
                  type="button"
                  onClick={() => setShowCreateForm(false)}
                  className="bg-gray-500 text-white px-6 py-2 rounded-lg hover:bg-gray-600"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* LIST / UI BELOW — SAME UI, NO CHANGES */}
        {loading ? (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600 mx-auto"></div>
          </div>
        ) : campaigns.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <p className="text-gray-600">No campaigns found. Create one to get started.</p>
          </div>
        ) : (
          campaigns.map((cp) => (
            <div key={cp.id} className="bg-white rounded-lg shadow p-6 mb-6">

              <div className="flex justify-between">
                <div>
                  <h3 className="text-xl font-semibold">{cp.name}</h3>
                  <p className="text-gray-600 text-sm mb-2">
                    Session: {cp.session?.name} ({cp.session?.status})
                  </p>
                  <p className="text-gray-700 mb-3">{cp.message}</p>
                </div>

                <div className="flex gap-2">
                  {cp.status === "draft" && (
                    <button
                      onClick={() => sendCampaign(cp)}
                      className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700"
                    >
                      Send
                    </button>
                  )}
                  <button
                    onClick={() => deleteCampaign(cp.id)}
                    className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700"
                  >
                    Delete
                  </button>
                </div>
              </div>

              <p className="text-gray-500 text-xs mt-3">
                Created: {new Date(cp.createdAt).toLocaleString()}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
