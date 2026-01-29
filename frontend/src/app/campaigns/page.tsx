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

  // ⭐ NEW: Dynamic message variants
  const [messages, setMessages] = useState<string[]>([""]);

  const [newCampaign, setNewCampaign] = useState({
    name: "",
    imageUrl: "",
    sessionId: "",
  });

  // ⭐ NEW: Multi-session support
  const [selectedSessions, setSelectedSessions] = useState<string[]>([]);
  const [useAllSessions, setUseAllSessions] = useState(false);

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

    // ⭐ Determine which sessions to use
    let targetSessions: string[] = [];
    if (useAllSessions) {
      // Use all active sessions
      const activeSessions = sessions.filter((s) =>
        ['working', 'ready', 'authenticated'].includes(s.status.toLowerCase())
      );
      if (activeSessions.length === 0) {
        return toast.error("No active sessions available");
      }
      targetSessions = activeSessions.map((s) => s.id);
    } else if (selectedSessions.length > 0) {
      // Use selected sessions
      targetSessions = selectedSessions;
    } else if (newCampaign.sessionId) {
      // Fallback to single session (backward compatibility)
      targetSessions = [newCampaign.sessionId];
    } else {
      return toast.error("Please select at least one session");
    }

    try {
      // Create campaign for each selected session
      const createPromises = targetSessions.map((sessionId, index) =>
        campaignAPI.create({
          name: `${newCampaign.name}${targetSessions.length > 1 ? ` (${index + 1}/${targetSessions.length})` : ''}`,
          messages: filteredMessages,
          imageUrl: newCampaign.imageUrl || null,
          sessionId: sessionId,
          buttons: [], // Buttons disabled for safety
        })
      );

      await Promise.all(createPromises);

      toast.success(
        targetSessions.length > 1
          ? `${targetSessions.length} campaigns created for selected sessions`
          : "Campaign created"
      );

      // Reset UI
      setMessages([""]);
      setNewCampaign({
        name: "",
        imageUrl: "",
        sessionId: "",
      });
      setSelectedSessions([]);
      setUseAllSessions(false);
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
     AUTO EXECUTE CAMPAIGNS
  ======================================================= */
  const autoExecuteCampaigns = async () => {
    const draftCampaigns = campaigns.filter((c) => c.status === 'draft');

    if (draftCampaigns.length === 0) {
      toast.error('Tidak ada campaign draft untuk dieksekusi');
      return;
    }

    if (draftCampaigns.length > 10) {
      toast.error('Maksimal 10 campaign dapat dieksekusi secara otomatis');
      return;
    }

    const activeSessions = sessions.filter((s) =>
      ['working', 'ready', 'authenticated'].includes(s.status.toLowerCase())
    );

    if (activeSessions.length === 0) {
      toast.error('Tidak ada session aktif. Pastikan minimal 1 session aktif.');
      return;
    }

    if (!confirm(
      `Eksekusi ${draftCampaigns.length} campaign secara otomatis?\n` +
      `Delay antar campaign: ${delayBetweenCampaigns} detik\n` +
      `Session aktif: ${activeSessions.length}`
    )) return;

    setAutoExecuting(true);
    try {
      const delayMs = delayBetweenCampaigns * 1000;
      const res = await campaignAPI.autoExecute(delayMs);

      if (res.data?.success) {
        toast.success(
          `Berhasil memproses ${res.data.data?.campaignsProcessed || 0} campaign`
        );

        // Show results
        if (res.data.data?.results) {
          const results = res.data.data.results;
          const successCount = results.filter((r: any) => r.success).length;
          const failedCount = results.filter((r: any) => !r.success).length;

          if (failedCount > 0) {
            toast.error(`${failedCount} campaign gagal. ${successCount} berhasil.`);
          }
        }
      } else {
        toast.error(res.data?.message || 'Gagal mengeksekusi campaign');
      }

      fetchCampaigns();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Gagal mengeksekusi campaign');
      console.error(err);
    } finally {
      setAutoExecuting(false);
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

          {/* AUTO EXECUTE SECTION */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-600">Delay (detik):</label>
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

              {/* SESSION SELECTION - MULTI-SELECT */}
              <div>
                <label className="block mb-2 font-medium">Target Sessions</label>

                {/* All Sessions Toggle */}
                <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={useAllSessions}
                      onChange={(e) => {
                        setUseAllSessions(e.target.checked);
                        if (e.target.checked) {
                          setSelectedSessions([]);
                          setNewCampaign({ ...newCampaign, sessionId: "" });
                        }
                      }}
                      className="w-4 h-4"
                    />
                    <span className="font-medium text-blue-900">
                      🌐 Use All Active Sessions
                    </span>
                  </label>
                  <p className="text-xs text-blue-700 mt-1 ml-6">
                    Campaign akan dibuat untuk semua session yang aktif
                  </p>
                </div>

                {/* Manual Session Selection */}
                {!useAllSessions && (
                  <div className="space-y-2">
                    <p className="text-sm text-gray-600 mb-2">
                      Pilih session (bisa lebih dari 1):
                    </p>
                    <div className="max-h-48 overflow-y-auto border rounded-lg p-3 space-y-2">
                      {sessions.map((s) => (
                        <label
                          key={s.id}
                          className="flex items-center gap-2 p-2 hover:bg-gray-50 rounded cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={selectedSessions.includes(s.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedSessions([...selectedSessions, s.id]);
                              } else {
                                setSelectedSessions(
                                  selectedSessions.filter((id) => id !== s.id)
                                );
                              }
                            }}
                            className="w-4 h-4"
                          />
                          <span className="flex-1">
                            {s.name}
                            <span
                              className={`ml-2 text-xs px-2 py-0.5 rounded ${['working', 'ready', 'authenticated'].includes(
                                s.status.toLowerCase()
                              )
                                ? 'bg-green-100 text-green-800'
                                : 'bg-gray-100 text-gray-600'
                                }`}
                            >
                              {s.status}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                    {selectedSessions.length > 0 && (
                      <p className="text-sm text-green-600 mt-2">
                        ✓ {selectedSessions.length} session dipilih
                      </p>
                    )}
                  </div>
                )}

                {/* Active Sessions Count */}
                {useAllSessions && (
                  <p className="text-sm text-blue-600 mt-2">
                    ✓ Akan dibuat untuk{' '}
                    {sessions.filter((s) =>
                      ['working', 'ready', 'authenticated'].includes(
                        s.status.toLowerCase()
                      )
                    ).length}{' '}
                    session aktif
                  </p>
                )}
              </div>

              {/* Template Placeholder Info */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-sm font-medium text-blue-900 mb-2">💡 Template Placeholder</p>
                <p className="text-sm text-blue-700">
                  Gunakan <code className="bg-blue-100 px-1 rounded">{'{{nama}}'}</code> untuk menampilkan nama contact secara otomatis.
                </p>
                <p className="text-xs text-blue-600 mt-2">
                  Contoh: &quot;Halo {'{{nama}}'}, promo spesial untuk Anda!&quot;
                </p>
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
