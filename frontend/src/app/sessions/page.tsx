'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
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
  const [newSessionName, setNewSessionName] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    checkAuth();
    fetchSessions();
  }, []);

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
    if (!newSessionName.trim()) {
      toast.error('Session name is required');
      return;
    }

    setIsCreating(true);
    try {
      await sessionAPI.create(newSessionName);
      toast.success('Session created successfully!');
      setShowCreateModal(false);
      setNewSessionName('');
      fetchSessions();
    } catch (error) {
      console.error('Failed to create session:', error);
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

    try {
      const response = await sessionAPI.getQR(session.id);
      const qr = response.data?.data?.qr || response.data?.qr || response.data?.qrCode;
      if (qr) {
        setSelectedSession({ ...session, qrCode: qr });
      } else {
        toast.error('QR code not available yet. Please wait a moment.');
      }
    } catch (error: any) {
      console.error('Failed to get QR code:', error);
      toast.error(error.response?.data?.message || 'Failed to fetch QR code');
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
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">WhatsApp Sessions</h1>
              <p className="text-gray-600 mt-1">Manage your WhatsApp connections</p>
            </div>
            <Button onClick={() => setShowCreateModal(true)} size="lg">
              <Plus className="w-5 h-5 mr-2" />
              New Session
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
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
      </main>

      {/* Create Session Modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Create New Session"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowCreateModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateSession} isLoading={isCreating}>
              Create Session
            </Button>
          </>
        }
      >
        <Input
          label="Session Name"
          placeholder="e.g., Main Account, Marketing, Support"
          value={newSessionName}
          onChange={(e) => setNewSessionName(e.target.value)}
          required
        />
      </Modal>

      {/* QR Code Modal */}
      <Modal
        isOpen={showQRModal}
        onClose={() => setShowQRModal(false)}
        title="Scan QR Code"
        size="md"
      >
        <div className="text-center">
          {selectedSession?.qrCode ? (
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
          ) : (
            <div className="py-12">
              <Loader className="w-12 h-12 animate-spin text-blue-600 mx-auto" />
              <p className="mt-4 text-gray-600">Loading QR Code...</p>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
