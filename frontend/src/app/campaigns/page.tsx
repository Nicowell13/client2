'use client';

import { useState, useEffect } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { Plus } from 'lucide-react';
import { campaignAPI, sessionAPI, uploadAPI } from '@/lib/api-client';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';

interface Session {
  id: string;
  name: string;
  status: string;
}

export default function CampaignsPage() {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [autoExecuting, setAutoExecuting] = useState(false);
  const [delayBetweenCampaigns, setDelayBetweenCampaigns] = useState(60); // seconds

  // Dynamic message variants
  const [messages, setMessages] = useState<string[]>([""]);

  const [newCampaign, setNewCampaign] = useState({
    name: "",
    imageUrl: "",
  });

  // Image upload state
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadedImagePreview, setUploadedImagePreview] = useState<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) return router.push("/login");

    fetchCampaigns();
    fetchSessions();
  }, []);

  const fetchCampaigns = async () => {
    try {
      const res = await campaignAPI.getAll();
      setCampaigns(res.data?.data || []);
    } catch {
      toast.error("Failed to load campaigns");
    } finally {
      setLoading(false);
    }
  };

  const fetchSessions = async () => {
    try {
      const res = await sessionAPI.getAll();
      setSessions(res.data?.data || []);
    } catch {
      toast.error("Failed to load sessions");
    }
  };

  /* =======================================================
     HANDLE IMAGE UPLOAD
  ======================================================= */
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast.error('Image size must be less than 10MB');
      return;
    }

    setUploadingImage(true);
    try {
      const res = await uploadAPI.uploadImage(file);
      const imageUrl = res.data?.data?.url;

      if (imageUrl) {
        const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.watrix.online';
        const fullImageUrl = imageUrl.startsWith('http') ? imageUrl : `${API_BASE_URL}${imageUrl}`;

        setNewCampaign({ ...newCampaign, imageUrl: fullImageUrl });
        setUploadedImagePreview(fullImageUrl);
        toast.success('Image uploaded successfully');
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to upload image');
    } finally {
      setUploadingImage(false);
    }
  };

  /* =======================================================
     CREATE CAMPAIGN (Simplified Global)
  ======================================================= */
  const createCampaign = async (e: any) => {
    e.preventDefault();

    const filteredMessages = messages.filter((m) => m.trim() !== "");
    if (filteredMessages.length === 0)
      return toast.error("Please add at least 1 message variant");

    // Find first active session to act as owner
    // Note: Backend ignores this sessionId for sending, but requires it for DB ownership
    const activeSession = sessions.find(s =>
      ['working', 'ready', 'authenticated'].includes(s.status.toLowerCase())
    );

    // Fallback to ANY session if no active ones (unlikely in production but safe fallback)
    const targetSessionId = activeSession?.id || sessions[0]?.id;

    if (!targetSessionId) {
      return toast.error("No sessions available. Please create a session first.");
    }

    try {
      await campaignAPI.create({
        name: newCampaign.name,
        messages: filteredMessages,
        imageUrl: newCampaign.imageUrl || null,
        sessionId: targetSessionId,
        buttons: [],
      });

      toast.success("Campaign created! (Will be sent using GLOBAL contacts & ALL active sessions)");

      // Reset UI
      setMessages([""]);
      setNewCampaign({
        name: "",
        imageUrl: "",
      });
      setUploadedImagePreview(null);
      setShowCreateForm(false);
      fetchCampaigns();
    } catch (err) {
      toast.error("Failed to create campaign");
      console.error(err);
    }
  };

  const deleteCampaign = async (id: string) => {
    if (!confirm("Delete this campaign?")) return;

    try {
      await campaignAPI.delete(id);
      toast.success("Campaign deleted");
      fetchCampaigns();
    } catch {
      toast.error("Failed to delete campaign");
    }
  };

  const sendCampaign = async (campaign: any) => {
    const sessionId = campaign.session?.name;
    if (!confirm(`Send campaign "${campaign.name}"? This will use ALL active sessions.`)) return;

    try {
      // Pass the stored sessionId, but backend will load balance
      const res = await campaignAPI.send(campaign.id, sessionId, []);
      toast.success(res.data?.message || "Sent!");
      fetchCampaigns();
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to send");
    }
  };

  const autoExecuteCampaigns = async () => {
    const draftCampaigns = campaigns.filter((c) => c.status === 'draft');

    if (draftCampaigns.length === 0) {
      toast.error('No draft campaigns to executed');
      return;
    }

    const activeCount = sessions.filter((s) =>
      ['working', 'ready', 'authenticated'].includes(s.status.toLowerCase())
    ).length;

    if (activeCount === 0) {
      toast.error('No active sessions found. Start at least one session.');
      return;
    }

    if (!confirm(
      `Execute ${draftCampaigns.length} campaigns automatically?\n` +
      `Delay: ${delayBetweenCampaigns}s\n` +
      `Active Sessions: ${activeCount} (Round-Robin)\n` +
      `Contacts: Global List`
    )) return;

    setAutoExecuting(true);
    try {
      const delayMs = delayBetweenCampaigns * 1000;
      const res = await campaignAPI.autoExecute(delayMs);

      if (res.data?.success) {
        toast.success(
          `Processed ${res.data.data?.campaignsProcessed || 0} campaigns`
        );

        if (res.data.data?.results) {
          const results = res.data.data.results;
          const failedCount = results.filter((r: any) => !r.success).length;
          if (failedCount > 0) toast.error(`${failedCount} failed.`);
        }
      } else {
        toast.error(res.data?.message || 'Failed to execute campaigns');
      }

      fetchCampaigns();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to execute campaigns');
    } finally {
      setAutoExecuting(false);
    }
  };

  return (
    <DashboardLayout title="Campaigns" description="Create and manage your WhatsApp campaigns (Global Distribution)">
      <div>
        <div className="flex items-center justify-between mb-8">
          <button
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700"
          >
            <Plus className="w-5 h-5" /> New Campaign
          </button>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-600">Delay (s):</label>
              <input
                type="number"
                min="10"
                max="300"
                value={delayBetweenCampaigns}
                onChange={(e) => setDelayBetweenCampaigns(Number(e.target.value))}
                className="w-20 border px-2 py-1 rounded text-sm"
                disabled={autoExecuting}
              />
            </div>
            <button
              onClick={autoExecuteCampaigns}
              disabled={autoExecuting || campaigns.filter((c) => c.status === 'draft').length === 0}
              className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {autoExecuting ? (
                <>
                  <span className="animate-spin">⏳</span> Processing...
                </>
              ) : (
                <>
                  <span>🚀</span> Auto Execute Campaigns
                </>
              )}
            </button>
          </div>
        </div>

        {showCreateForm && (
          <div className="bg-white p-6 rounded-lg shadow mb-8">
            <h2 className="text-xl font-semibold mb-4">Create Global Campaign</h2>

            <form onSubmit={createCampaign} className="space-y-6">

              <div className="bg-blue-50 border border-blue-200 text-blue-800 px-4 py-3 rounded-lg text-sm">
                <strong>Targeting:</strong> This campaign will be sent to ALL contacts in the Global Contact List (Max 500),
                distributed evenly across all available active sessions.
              </div>

              <div>
                <label className="block mb-1 font-medium">Campaign Name</label>
                <input
                  type="text"
                  required
                  className="w-full border px-3 py-2 rounded-lg"
                  value={newCampaign.name}
                  onChange={(e) =>
                    setNewCampaign({ ...newCampaign, name: e.target.value })
                  }
                />
              </div>

              <div>
                <label className="block mb-1 font-medium">Message Variants</label>
                {messages.map((msg, idx) => (
                  <div key={idx} className="flex gap-2 mb-2 items-start">
                    <textarea
                      value={msg}
                      onChange={(e) => {
                        const arr = [...messages];
                        arr[idx] = e.target.value;
                        setMessages(arr);
                      }}
                      className="w-full border px-3 py-2 rounded-lg resize-y"
                      placeholder={`Message Variant #${idx + 1}`}
                      rows={4}
                    />
                    {messages.length > 1 && (
                      <button
                        type="button"
                        onClick={() => {
                          setMessages(messages.filter((_, i) => i !== idx));
                        }}
                        className="px-3 py-2 bg-red-500 text-white rounded self-start"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setMessages([...messages, ""])}
                  className="mt-2 px-4 py-1 bg-blue-500 text-white rounded"
                >
                  + Add Variant
                </button>
              </div>

              <div>
                <label className="block mb-1 font-medium">Image (optional)</label>
                <div className="mb-2">
                  <label className="inline-block px-4 py-2 bg-blue-600 text-white rounded-lg cursor-pointer hover:bg-blue-700">
                    {uploadingImage ? 'Uploading...' : 'Upload Image'}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleImageUpload}
                      disabled={uploadingImage}
                    />
                  </label>
                  <span className="ml-2 text-sm text-gray-500">or enter URL below</span>
                </div>

                {uploadedImagePreview && (
                  <div className="mb-2">
                    <img
                      src={uploadedImagePreview}
                      alt="Preview"
                      className="max-w-xs max-h-48 rounded-lg border"
                      onError={() => setUploadedImagePreview(null)}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setUploadedImagePreview(null);
                        setNewCampaign({ ...newCampaign, imageUrl: "" });
                      }}
                      className="mt-1 text-sm text-red-600 hover:text-red-800"
                    >
                      Remove Image
                    </button>
                  </div>
                )}

                <input
                  type="url"
                  className="w-full border px-3 py-2 rounded-lg"
                  placeholder="Or paste image URL here"
                  value={newCampaign.imageUrl}
                  onChange={(e) => {
                    setNewCampaign({ ...newCampaign, imageUrl: e.target.value });
                    if (e.target.value) {
                      setUploadedImagePreview(e.target.value);
                    } else {
                      setUploadedImagePreview(null);
                    }
                  }}
                />
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-sm font-medium text-blue-900 mb-2">💡 Template Placeholder</p>
                <p className="text-sm text-blue-700">
                  Use <code className="bg-blue-100 px-1 rounded">{'{{nama}}'}</code> to verify contact name automatically.
                </p>
              </div>

              <button
                type="submit"
                className="px-6 py-2 bg-green-600 text-white rounded hover:bg-green-700"
              >
                Create Global Campaign
              </button>
            </form>
          </div>
        )}

        {!loading &&
          campaigns.map((cp) => (
            <div key={cp.id} className="bg-white p-6 shadow rounded-lg mb-4">
              <h3 className="text-lg font-semibold">{cp.name}</h3>
              <p className="text-gray-500 text-sm mb-2">
                Global Campaign ({cp.status})
              </p>

              <p className="text-gray-700 mb-4">
                {Array.isArray(cp.messages)
                  ? `${cp.messages.length} message variants`
                  : cp.message}
              </p>

              <div className="flex gap-2">
                {cp.status === "draft" && (
                  <button
                    onClick={() => sendCampaign(cp)}
                    className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
                  >
                    Send (Global)
                  </button>
                )}

                <button
                  onClick={() => deleteCampaign(cp.id)}
                  className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
      </div>
    </DashboardLayout>
  );
}
