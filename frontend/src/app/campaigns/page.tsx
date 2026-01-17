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

  // ⭐ NEW: Dynamic message variants
  const [messages, setMessages] = useState<string[]>([""]);

  const [newCampaign, setNewCampaign] = useState({
    name: "",
    imageUrl: "",
    sessionId: "",
    button1Label: "",
    button1Url: "",
    button2Label: "",
    button2Url: "",
  });

  // Image upload state
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadedImagePreview, setUploadedImagePreview] = useState<string | null>(null);

  /* =======================================================
     LOAD CAMPAIGNS + SESSIONS
  ======================================================= */
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

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }

    // Validate file size (10MB)
    if (file.size > 10 * 1024 * 1024) {
      toast.error('Image size must be less than 10MB');
      return;
    }

    setUploadingImage(true);
    try {
      const res = await uploadAPI.uploadImage(file);
      const imageUrl = res.data?.data?.url;
      
      if (imageUrl) {
        // Get full URL (relative path from backend)
        const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.watrix.online';
        const fullImageUrl = imageUrl.startsWith('http') ? imageUrl : `${API_BASE_URL}${imageUrl}`;
        
        setNewCampaign({ ...newCampaign, imageUrl: fullImageUrl });
        setUploadedImagePreview(fullImageUrl);
        toast.success('Image uploaded successfully');
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to upload image');
      console.error(err);
    } finally {
      setUploadingImage(false);
    }
  };

  /* =======================================================
     CREATE CAMPAIGN (Multi–Message Support)
  ======================================================= */
  const createCampaign = async (e: any) => {
    e.preventDefault();

    const filteredMessages = messages.filter((m) => m.trim() !== "");
    if (filteredMessages.length === 0)
      return toast.error("Please add at least 1 message variant");

    const buttons = [];
    if (newCampaign.button1Label && newCampaign.button1Url)
      buttons.push({ label: newCampaign.button1Label, url: newCampaign.button1Url });

    if (newCampaign.button2Label && newCampaign.button2Url)
      buttons.push({ label: newCampaign.button2Label, url: newCampaign.button2Url });

    try {
      await campaignAPI.create({
        name: newCampaign.name,
        messages: filteredMessages, // ⭐ NEW FIELD
        imageUrl: newCampaign.imageUrl || null,
        sessionId: newCampaign.sessionId,
        buttons,
      });

      toast.success("Campaign created");

      // Reset UI
      setMessages([""]);
      setNewCampaign({
        name: "",
        imageUrl: "",
        sessionId: "",
        button1Label: "",
        button1Url: "",
        button2Label: "",
        button2Url: "",
      });
      setUploadedImagePreview(null);
      setShowCreateForm(false);
      fetchCampaigns();
    } catch (err) {
      toast.error("Failed to create campaign");
      console.error(err);
    }
  };

  /* =======================================================
     DELETE CAMPAIGN
  ======================================================= */
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

  /* =======================================================
     SEND CAMPAIGN
  ======================================================= */
  const sendCampaign = async (campaign: any) => {
    const sessionId = campaign.session?.name;

    if (!confirm(`Send campaign "${campaign.name}"?`)) return;

    try {
      const res = await campaignAPI.send(campaign.id, sessionId, []);
      toast.success(res.data?.message || "Sent!");
      fetchCampaigns();
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to send");
    }
  };

  /* =======================================================
     RENDER UI
  ======================================================= */
  return (
    <DashboardLayout title="Campaigns" description="Create and manage your WhatsApp campaigns">
      <div>
        {/* HEADER */}
        <div className="flex items-center justify-between mb-8">
          <button
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700"
          >
            <Plus className="w-5 h-5" /> New Campaign
          </button>
        </div>

        {/* ================= CREATE CAMPAIGN FORM ================ */}
        {showCreateForm && (
          <div className="bg-white p-6 rounded-lg shadow mb-8">
            <h2 className="text-xl font-semibold mb-4">Create Campaign</h2>

            <form onSubmit={createCampaign} className="space-y-6">

              {/* Name */}
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

              {/* MULTI MESSAGE INPUT */}
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
                      placeholder={`Tulis/paste list di sini (Enter untuk baris baru) — Variant #${idx + 1}`}
                      rows={4}
                    />

                    {messages.length > 1 && (
                      <button
                        type="button"
                        onClick={() => {
                          setMessages(messages.filter((_, i) => i !== idx));
                        }}
                        className="px-3 py-2 bg-red-500 text-white rounded self-start"
                        aria-label={`Remove message variant ${idx + 1}`}
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

              {/* IMAGE UPLOAD / URL */}
              <div>
                <label className="block mb-1 font-medium">Image (optional)</label>
                
                {/* Upload Button */}
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

                {/* Image Preview */}
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

                {/* URL Input (fallback) */}
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

              {/* SESSION */}
              <div>
                <label className="block mb-1 font-medium">Session</label>
                <select
                  required
                  className="w-full border px-3 py-2 rounded-lg"
                  value={newCampaign.sessionId}
                  onChange={(e) =>
                    setNewCampaign({ ...newCampaign, sessionId: e.target.value })
                  }
                >
                  <option value="">Select Session</option>
                  {sessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.status})
                    </option>
                  ))}
                </select>
              </div>

              {/* BUTTONS */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block">Button 1 Label</label>
                  <input
                    type="text"
                    className="w-full border px-3 py-2 rounded-lg"
                    value={newCampaign.button1Label}
                    onChange={(e) =>
                      setNewCampaign({
                        ...newCampaign,
                        button1Label: e.target.value,
                      })
                    }
                  />
                </div>

                <div>
                  <label className="block">Button 1 URL</label>
                  <input
                    type="url"
                    className="w-full border px-3 py-2 rounded-lg"
                    value={newCampaign.button1Url}
                    onChange={(e) =>
                      setNewCampaign({
                        ...newCampaign,
                        button1Url: e.target.value,
                      })
                    }
                  />
                </div>

                <div>
                  <label className="block">Button 2 Label</label>
                  <input
                    type="text"
                    className="w-full border px-3 py-2 rounded-lg"
                    value={newCampaign.button2Label}
                    onChange={(e) =>
                      setNewCampaign({
                        ...newCampaign,
                        button2Label: e.target.value,
                      })
                    }
                  />
                </div>

                <div>
                  <label className="block">Button 2 URL</label>
                  <input
                    type="url"
                    className="w-full border px-3 py-2 rounded-lg"
                    value={newCampaign.button2Url}
                    onChange={(e) =>
                      setNewCampaign({
                        ...newCampaign,
                        button2Url: e.target.value,
                      })
                    }
                  />
                </div>
              </div>

              <button
                type="submit"
                className="px-6 py-2 bg-green-600 text-white rounded"
              >
                Create Campaign
              </button>
            </form>
          </div>
        )}

        {/* ====================== CAMPAIGN LIST ====================== */}
        {!loading &&
          campaigns.map((cp) => (
            <div key={cp.id} className="bg-white p-6 shadow rounded-lg mb-4">
              <h3 className="text-lg font-semibold">{cp.name}</h3>
              <p className="text-gray-500 text-sm mb-2">
                Session: {cp.session?.name} ({cp.session?.status})
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
                    className="px-4 py-2 bg-green-600 text-white rounded"
                  >
                    Send
                  </button>
                )}

                <button
                  onClick={() => deleteCampaign(cp.id)}
                  className="px-4 py-2 bg-red-600 text-white rounded"
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
