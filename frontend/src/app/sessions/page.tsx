'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import DashboardLayout from '@/components/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { sessionAPI } from '@/lib/api-client';
import toast from 'react-hot-toast';
import { Plus, QrCode, Power, Trash2, Loader, CheckCircle, XCircle, Clock, RotateCcw, Coffee } from 'lucide-react';
import QRCode from 'qrcode.react';

interface Session {
  id: string;
  name: string;
  sessionId: string;
  status: string;
  qrCode?: string;
  phoneNumber?: string;
  isDefault: boolean;
  createdAt: string;
  // Job tracking fields
  jobCount?: number;
  jobLimitReached?: boolean;
  restingUntil?: string;
}

export default function SessionsPage() {
  const router = useRouter();
  const MAX_SESSIONS = 10;
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showQRModal, setShowQRModal] = useState(false);
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [phoneInput, setPhoneInput] = useState('');
  const [requestingCode, setRequestingCode] = useState(false);
  const [qrWaitTimer, setQrWaitTimer] = useState<NodeJS.Timeout | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [statusPollTimer, setStatusPollTimer] = useState<NodeJS.Timeout | null>(null);
  const [showPairingUI, setShowPairingUI] = useState(false);
  // WAHA Plus: allow up to 5 sessions with custom names
  const [newSessionName, setNewSessionName] = useState('default');
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    checkAuth();
    fetchSessions();
  }, []);

  // Cleanup timers when QR modal closed or component unmounts
  useEffect(() => {
    if (!showQRModal) {
      if (qrWaitTimer) {
        clearTimeout(qrWaitTimer);
        setQrWaitTimer(null);
      }
      if (statusPollTimer) {
        clearInterval(statusPollTimer);
        setStatusPollTimer(null);
      }
      setPairingCode(null);
      setPhoneInput('');
      setShowPairingUI(false);
    }
    return () => {
      if (qrWaitTimer) clearTimeout(qrWaitTimer);
      if (statusPollTimer) clearInterval(statusPollTimer);
    };
  }, [showQRModal]);

  const isConnectedStatus = (status: string | undefined | null) => {
    const normalized = String(status || '').toLowerCase();
    return ['working', 'ready', 'authenticated'].includes(normalized);
  };

  const isImageDataUrl = (value: string | undefined | null) => {
    return typeof value === 'string' && value.startsWith('data:image/');
  };

  const checkAuth = () => {
    const token = localStorage.getItem('token');
    if (!token) {
      router.push('/login');
    }
  };

  const fetchSessions = async () => {
    try {
      const response = await sessionAPI.getAll();
      const data = response.data;

      // Ensure sessions is always an array
      if (Array.isArray(data)) {
        setSessions(data);
      } else if (data && Array.isArray(data.data)) {
        setSessions(data.data);
      } else if (data && data.success && Array.isArray(data.data)) {
        setSessions(data.data);
      } else {
        console.warn('Unexpected sessions response format:', data);
        setSessions([]);
      }
    } catch (error: any) {
      console.error('Failed to fetch sessions:', error);
      toast.error(error.response?.data?.message || 'Failed to load sessions');
      setSessions([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateSession = async () => {
    // WAHA Plus: limit max sessions
    if (sessions.length >= MAX_SESSIONS) {
      toast.error(`Maksimal ${MAX_SESSIONS} sesi aktif. Silakan hubungi admin untuk menambah sesi.`);
      setShowCreateModal(false);
      return;
    }

    const name = (newSessionName || '').trim();
    if (!name) return toast.error('Nama sesi wajib diisi');

    setIsCreating(true);
    try {
      await sessionAPI.create(name);
      toast.success(`Sesi "${name}" berhasil dibuat!`);
      setShowCreateModal(false);
      setNewSessionName('');
      fetchSessions();
    } catch (error: any) {
      console.error('Failed to create session:', error);
      toast.error(error?.response?.data?.message || 'Gagal membuat sesi');
    } finally {
      setIsCreating(false);
    }
  };

  const handleShowQR = async (session: Session) => {
    setShowPairingUI(false);
    setPairingCode(null);
    setPhoneInput('');

    setSelectedSession(session);
    setShowQRModal(true);

    // Start a 5s timer; if QR still missing, show pairing UI
    if (qrWaitTimer) {
      clearTimeout(qrWaitTimer);
      setQrWaitTimer(null);
    }
    const timer = setTimeout(() => {
      setShowPairingUI(true);
    }, 5000);
    setQrWaitTimer(timer);

    // Begin status polling until connected
    if (statusPollTimer) {
      clearInterval(statusPollTimer);
      setStatusPollTimer(null);
    }
    const poll = setInterval(async () => {
      try {
        const resp = await sessionAPI.getAll();
        const list = Array.isArray(resp.data) ? resp.data : resp.data?.data || [];
        setSessions(list);
        const updated = list.find((s: any) => s.id === session.id);
        if (isConnectedStatus(updated?.status)) {
          toast.success('Connected');
          setSelectedSession(updated);
          setShowQRModal(false);
          setShowPairingUI(false);
          clearInterval(poll);
          setStatusPollTimer(null);
          fetchSessions();
        }
      } catch (e) { }
    }, 3000);
    setStatusPollTimer(poll as unknown as NodeJS.Timeout);

    try {
      // If session is stopped/failed/etc, try (re)starting it so WAHA can generate QR
      if (!isConnectedStatus(session.status) && ['stopped', 'failed'].includes(String(session.status || '').toLowerCase())) {
        try {
          await sessionAPI.start(session.id);
        } catch (e: any) {
          // Don't hard-fail; QR endpoint may still work if WAHA is already running
          console.warn('Failed to start session (continuing):', e?.message || e);
        }
      }

      const response = await sessionAPI.getQR(session.id);
      const payload = response.data;
      const qr = payload?.data?.qr || payload?.qr || payload?.qrCode || payload?.dataUrl || payload?.data;
      if (qr) {
        setSelectedSession({ ...session, qrCode: qr });
        // If QR arrives, ensure pairing modal is closed and timer cleared
        clearTimeout(timer);
        setQrWaitTimer(null);
        setShowPairingUI(false);
        // pairing input remains available; no separate modal to close
      } else {
        toast.error('QR code not available yet. Please wait a moment.');
      }
    } catch (error: any) {
      console.error('Failed to get QR code:', error);
      toast.error(error.response?.data?.message || 'Failed to fetch QR code');
    }
  };

  const handleRequestPairingCode = async () => {
    if (!selectedSession?.id) return;
    const phoneNumber = phoneInput.trim();
    if (!phoneNumber) {
      toast.error('Masukkan nomor telepon dulu.');
      return;
    }
    setRequestingCode(true);
    try {
      const resp = await sessionAPI.requestPairingCode(selectedSession.id, phoneNumber);
      const code = resp?.data?.data?.code || resp?.data?.code;
      if (code) {
        setPairingCode(code);
      } else {
        // no toast; client will read code in modal or receive SMS
      }
      // Do not auto-close; wait until connected
    } catch (error: any) {
      console.error('Failed to request pairing code:', error);
      toast.error(error.response?.data?.message || 'Gagal meminta pairing code');
    } finally {
      setRequestingCode(false);
    }
  };

  const handleStopSession = async (sessionId: string) => {
    try {
      await sessionAPI.stop(sessionId);
      toast.success('Session stopped');
      fetchSessions();
    } catch (error: any) {
      console.error('Failed to stop session:', error);
      toast.error(error?.response?.data?.message || 'Failed to stop session');
    }
  };

  const handleDeleteSession = async (sessionId: string) => {
    if (!confirm('Are you sure you want to delete this session?')) return;

    try {
      await sessionAPI.delete(sessionId);
      toast.success('Session deleted');
      fetchSessions();
    } catch (error: any) {
      console.error('Failed to delete session:', error);
      toast.error(error?.response?.data?.message || 'Failed to delete session');
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'working':
      case 'ready':
      case 'authenticated':
        return <Badge variant="success">Connected</Badge>;
      case 'starting':
        return <Badge variant="warning">Starting</Badge>;
      case 'failed':
        return <Badge variant="error">Failed</Badge>;
      default:
        return <Badge variant="default">Stopped</Badge>;
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'working':
      case 'ready':
      case 'authenticated':
        return <CheckCircle className="w-5 h-5 text-green-600" />;
      case 'starting':
        return <Clock className="w-5 h-5 text-yellow-600" />;
      case 'failed':
        return <XCircle className="w-5 h-5 text-red-600" />;
      default:
        return <Power className="w-5 h-5 text-gray-400" />;
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <DashboardLayout title="WhatsApp Sessions" description="Manage your WhatsApp connections">
      <div>
        {/* Header Button */}
        <div className="flex items-center justify-between mb-8">
          <Button onClick={() => setShowCreateModal(true)} size="lg">
            <Plus className="w-5 h-5 mr-2" />
            New Session
          </Button>
        </div>

        {/* Sessions Grid */}
        {sessions.length === 0 ? (
          <Card variant="bordered" className="text-center py-16">
            <CardContent>
              <Power className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-gray-900 mb-2">No Sessions Yet</h3>
              <p className="text-gray-600 mb-6">Create your first WhatsApp session to get started</p>
              <Button onClick={() => setShowCreateModal(true)}>
                <Plus className="w-5 h-5 mr-2" />
                Create Session
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {sessions.map((session) => (
              <Card key={session.id} variant="elevated" className="hover:shadow-xl transition-all">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      {getStatusIcon(session.status)}
                      <div>
                        <CardTitle>{session.name}</CardTitle>
                        <CardDescription className="mt-1">
                          {session.phoneNumber || 'Not connected'}
                        </CardDescription>
                      </div>
                    </div>
                    {getStatusBadge(session.status)}
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="text-sm text-gray-600">
                      <span className="font-medium">Session ID:</span> {session.sessionId}
                    </div>
                    {/* Job Count Display */}
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-600">
                        <span className="font-medium">Jobs:</span> {(session as any).jobCount || 0}/50
                      </span>
                      {(session as any).jobLimitReached && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                          <Coffee className="w-3 h-3" />
                          Resting
                        </span>
                      )}
                    </div>
                    {/* Progress Bar */}
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full transition-all ${(session as any).jobLimitReached ? 'bg-yellow-500' : 'bg-blue-600'
                          }`}
                        style={{ width: `${Math.min(((session as any).jobCount || 0) / 50 * 100, 100)}%` }}
                      ></div>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      {!isConnectedStatus(session.status) && (
                        <Button
                          variant="primary"
                          size="sm"
                          className="flex-1"
                          onClick={() => handleShowQR(session)}
                        >
                          <QrCode className="w-4 h-4 mr-1" />
                          Scan QR
                        </Button>
                      )}
                      {isConnectedStatus(session.status) && (
                        <Button
                          variant="secondary"
                          size="sm"
                          className="flex-1"
                          onClick={() => handleStopSession(session.id)}
                        >
                          <Power className="w-4 h-4 mr-1" />
                          Stop
                        </Button>
                      )}
                      {(session as any).jobLimitReached && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={async () => {
                            try {
                              await sessionAPI.resetJobs(session.id);
                              toast.success(`Job count reset untuk ${session.name}`);
                              fetchSessions();
                            } catch (error: any) {
                              toast.error(error?.response?.data?.message || 'Gagal reset jobs');
                            }
                          }}
                        >
                          <RotateCcw className="w-4 h-4 mr-1" />
                          Reset
                        </Button>
                      )}
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => handleDeleteSession(session.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Create Session Modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title={`Buat Sesi Baru (maks. ${MAX_SESSIONS})`}
        footer={
          <>
            <Button variant="outline" onClick={() => setShowCreateModal(false)}>
              Tutup
            </Button>
            <Button onClick={handleCreateSession} isLoading={isCreating}>
              Buat Sesions
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <label className="text-sm font-medium text-gray-700">Nama Sesi</label>
          <Input
            placeholder="Contoh: marketing-1"
            value={newSessionName}
            onChange={(e) => setNewSessionName(e.target.value)}
          />
          <p className="text-xs text-gray-500">Anda dapat membuat hingga {MAX_SESSIONS} sesi aktif. Jika butuh lebih, silakan hubungi admin.</p>
        </div>
      </Modal>

      {/* QR Code Modal */}
      <Modal
        isOpen={showQRModal}
        onClose={() => setShowQRModal(false)}
        title={showPairingUI ? 'Pairing Code' : 'Scan QR Code atau Minta Pairing Code'}
        size="md"
      >
        <div className="text-center">
          {!showPairingUI && selectedSession?.qrCode ? (
            <>
              <div className="bg-white p-6 rounded-2xl inline-block border-4 border-blue-600">
                {isImageDataUrl(selectedSession.qrCode) ? (
                  // Backend can return a PNG/JPEG data URL (already an image of the QR)
                  // In that case we must render it as an image, not re-encode it into another QR.
                  <img
                    src={selectedSession.qrCode}
                    alt="WhatsApp QR"
                    width={256}
                    height={256}
                    className="block"
                  />
                ) : (
                  // Raw QR string -> generate QR on the client
                  <QRCode value={String(selectedSession.qrCode)} size={256} />
                )}
              </div>
              <div className="mt-6 space-y-2">
                <p className="text-lg font-semibold text-gray-900">Scan with WhatsApp</p>
                <ol className="text-sm text-gray-600 text-left space-y-1 max-w-md mx-auto">
                  <li>1. Open WhatsApp on your phone</li>
                  <li>2. Tap Menu or Settings → Linked Devices</li>
                  <li>3. Tap &quot;Link a Device&quot;</li>
                  <li>4. Point your phone at this QR code</li>
                </ol>
              </div>
            </>
          ) : !showPairingUI ? (
            <div className="py-12">
              <Loader className="w-12 h-12 animate-spin text-blue-600 mx-auto" />
              <p className="mt-4 text-gray-600">Loading QR Code...</p>
            </div>
          ) : null}
          {showPairingUI && (
            <div className="mt-2 text-left max-w-md mx-auto space-y-4">
              <p className="text-sm text-gray-700">QR gagal muncul. Silakan lakukan pairing menggunakan kode.</p>
              <label className="text-sm font-medium text-gray-700">Nomor Telepon (contoh: 6281234567890)</label>
              <Input
                placeholder="Contoh: 6281234567890"
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)}
              />
              <div className="flex items-center gap-2">
                <Button onClick={handleRequestPairingCode} isLoading={requestingCode}>Minta Kode Pairing</Button>
              </div>
              {pairingCode && (
                <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                  <p className="text-sm text-gray-700 mb-2">Kode Pairing Anda:</p>
                  <p className="text-2xl font-bold tracking-widest text-blue-700">{pairingCode}</p>
                </div>
              )}
              <p className="text-xs text-gray-500">Format: Awali dengan kode negara tanpa tanda &apos;+&apos;, misal Indonesia 62, lalu nomor. Contoh: 6281234567890.</p>
              <p className="text-xs text-gray-500">Dialog akan tetap terbuka sampai status terhubung.</p>
            </div>
          )}
        </div>
      </Modal>
    </DashboardLayout>
  );
}
