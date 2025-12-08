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
import { Plus, QrCode, Power, Trash2, Loader, CheckCircle, XCircle, Clock } from 'lucide-react';
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
}

export default function SessionsPage() {
  const router = useRouter();
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
  // WAHA free supports only 'default' session
  const [newSessionName] = useState('default');
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
    }
    return () => {
      if (qrWaitTimer) clearTimeout(qrWaitTimer);
      if (statusPollTimer) clearInterval(statusPollTimer);
    };
  }, [showQRModal]);

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
    // Allow only one session ('default') on WAHA free
    if (sessions.length >= 1) {
      toast.error('Silakan hubungi admin untuk menambah sesi.');
      setShowCreateModal(false);
      return;
    }

    setIsCreating(true);
    try {
      await sessionAPI.create('default');
      toast.success('Sesi default berhasil dibuat!');
      setShowCreateModal(false);
      fetchSessions();
    } catch (error) {
      console.error('Failed to create session:', error);
      toast.error('Gagal membuat sesi default');
    } finally {
      setIsCreating(false);
    }
  };

  const handleShowQR = async (session: Session) => {
    // If we already have a QR stored (from webhook), use it immediately
    if (session.qrCode) {
      setSelectedSession(session);
      setShowQRModal(true);
      return;
    }

    setSelectedSession(session);
    setShowQRModal(true);

    // Start a 5s timer; if QR still missing, show pairing modal
    if (qrWaitTimer) {
      clearTimeout(qrWaitTimer);
      setQrWaitTimer(null);
    }
    const timer = setTimeout(() => {
      const hasQr = !!(selectedSession?.qrCode || session.qrCode);
      if (!hasQr) {
        // Switch UI to pairing-only if QR didn't appear in 5s
        setShowPairingUI(true);
      }
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
        const updated = list.find((s: any) => s.id === session.id);
        if (updated?.status === 'working') {
          toast.success('Connected');
          setSelectedSession(updated);
          setShowQRModal(false);
          clearInterval(poll);
          setStatusPollTimer(null);
        }
      } catch (e) {}
    }, 3000);
    setStatusPollTimer(poll as unknown as NodeJS.Timeout);

    try {
      const response = await sessionAPI.getQR(session.id);
      const payload = response.data;
      const qr = payload?.data?.qr || payload?.qr || payload?.qrCode || payload?.dataUrl || payload?.data;
      if (qr) {
        setSelectedSession({ ...session, qrCode: qr });
        // If QR arrives, ensure pairing modal is closed and timer cleared
        if (qrWaitTimer) {
          clearTimeout(qrWaitTimer);
          setQrWaitTimer(null);
        }
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
    } catch (error) {
      console.error('Failed to stop session:', error);
    }
  };

  const handleDeleteSession = async (sessionId: string) => {
    if (!confirm('Are you sure you want to delete this session?')) return;

    try {
      await sessionAPI.delete(sessionId);
      toast.success('Session deleted');
      fetchSessions();
    } catch (error) {
      console.error('Failed to delete session:', error);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'working':
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
                    <div className="flex gap-2">
                      {session.status !== 'working' && (
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
                      {session.status === 'working' && (
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
        title="Buat Sesi Default"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowCreateModal(false)}>
              Tutup
            </Button>
            <Button onClick={handleCreateSession} isLoading={isCreating}>
              Buat Sesi
            </Button>
          </>
        }
      >
        <div className="space-y-2">
          
          <p className="text-gray-600">Jika Anda membutuhkan lebih dari satu sesi, silakan hubungi admin untuk peningkatan paket.</p>
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
                <QRCode value={selectedSession.qrCode} size={256} />
              </div>
              <div className="mt-6 space-y-2">
                <p className="text-lg font-semibold text-gray-900">Scan with WhatsApp</p>
                <ol className="text-sm text-gray-600 text-left space-y-1 max-w-md mx-auto">
                  <li>1. Open WhatsApp on your phone</li>
                  <li>2. Tap Menu or Settings → Linked Devices</li>
                  <li>3. Tap "Link a Device"</li>
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
              <p className="text-xs text-gray-500">Format: Awali dengan kode negara tanpa tanda '+', misal Indonesia 62, lalu nomor. Contoh: 6281234567890.</p>
              <p className="text-xs text-gray-500">Dialog akan tetap terbuka sampai status terhubung.</p>
            </div>
          )}
        </div>
      </Modal>
    </DashboardLayout>
  );
}
