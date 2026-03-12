'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import DashboardLayout from '@/components/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { settingsAPI } from '@/lib/api-client';
import toast from 'react-hot-toast';
import { Shield, Wifi, WifiOff, TestTube, Save, Loader } from 'lucide-react';

interface ProxyConfig {
  enabled: boolean;
  type: 'socks5' | 'http' | 'https';
  host: string;
  port: number;
  username: string;
  password: string;
}

export default function SettingsPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [proxy, setProxy] = useState<ProxyConfig>({
    enabled: false,
    type: 'socks5',
    host: '',
    port: 1080,
    username: '',
    password: '',
  });

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      router.push('/login');
      return;
    }
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const response = await settingsAPI.getSettings();
      const data = response.data?.data || response.data;
      if (data?.proxy) {
        setProxy(data.proxy);
      }
    } catch (error: any) {
      console.error('Failed to fetch settings:', error);
      toast.error('Failed to load settings');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    if (proxy.enabled && (!proxy.host || !proxy.port)) {
      toast.error('Host dan Port wajib diisi jika proxy diaktifkan');
      return;
    }

    setIsSaving(true);
    try {
      const response = await settingsAPI.updateProxy(proxy);
      const msg = response.data?.message || 'Proxy settings saved!';
      toast.success(msg);
    } catch (error: any) {
      console.error('Failed to save proxy:', error);
      toast.error(error?.response?.data?.message || 'Failed to save proxy settings');
    } finally {
      setIsSaving(false);
    }
  };

  const handleTest = async () => {
    if (!proxy.host || !proxy.port) {
      toast.error('Isi Host dan Port dulu untuk testing');
      return;
    }

    setIsTesting(true);
    try {
      const response = await settingsAPI.testProxy({
        type: proxy.type,
        host: proxy.host,
        port: proxy.port,
        username: proxy.username,
        password: proxy.password,
      });
      if (response.data?.success) {
        toast.success(response.data.message);
      } else {
        toast.error(response.data?.message || 'Proxy test failed');
      }
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'Proxy test failed');
    } finally {
      setIsTesting(false);
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
    <DashboardLayout title="Settings" description="Configure proxy and application settings">
      <div className="max-w-2xl mx-auto space-y-6">

        {/* Proxy Configuration Card */}
        <Card variant="elevated">
          <CardHeader>
            <div className="flex items-center gap-3">
              <Shield className="w-6 h-6 text-blue-600" />
              <div>
                <CardTitle>Residential Proxy</CardTitle>
                <CardDescription className="mt-1">
                  Gunakan proxy residential agar koneksi WhatsApp tidak terdeteksi sebagai data center IP
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-5">

              {/* Enable/Disable Toggle */}
              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl border">
                <div className="flex items-center gap-3">
                  {proxy.enabled ? (
                    <Wifi className="w-5 h-5 text-green-600" />
                  ) : (
                    <WifiOff className="w-5 h-5 text-gray-400" />
                  )}
                  <div>
                    <p className="font-medium text-gray-900">
                      {proxy.enabled ? 'Proxy Aktif' : 'Proxy Nonaktif'}
                    </p>
                    <p className="text-sm text-gray-500">
                      {proxy.enabled
                        ? 'Semua koneksi WhatsApp melewati proxy'
                        : 'Koneksi langsung dari IP server (VPS)'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setProxy({ ...proxy, enabled: !proxy.enabled })}
                  className={`relative inline-flex h-7 w-14 items-center rounded-full transition-colors ${
                    proxy.enabled ? 'bg-blue-600' : 'bg-gray-300'
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform ${
                      proxy.enabled ? 'translate-x-8' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {/* Proxy Type */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Tipe Proxy</label>
                <select
                  value={proxy.type}
                  onChange={(e) => setProxy({ ...proxy, type: e.target.value as any })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                >
                  <option value="socks5">SOCKS5 (Recommended)</option>
                  <option value="http">HTTP</option>
                  <option value="https">HTTPS</option>
                </select>
              </div>

              {/* Host & Port */}
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Host / IP</label>
                  <Input
                    placeholder="proxy.example.com atau 1.2.3.4"
                    value={proxy.host}
                    onChange={(e) => setProxy({ ...proxy, host: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Port</label>
                  <Input
                    type="number"
                    placeholder="1080"
                    value={proxy.port || ''}
                    onChange={(e) => setProxy({ ...proxy, port: Number(e.target.value) })}
                  />
                </div>
              </div>

              {/* Username & Password */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Username (opsional)</label>
                  <Input
                    placeholder="user123"
                    value={proxy.username}
                    onChange={(e) => setProxy({ ...proxy, username: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Password (opsional)</label>
                  <Input
                    type="password"
                    placeholder="••••••••"
                    value={proxy.password}
                    onChange={(e) => setProxy({ ...proxy, password: e.target.value })}
                  />
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 pt-2">
                <Button onClick={handleTest} variant="secondary" isLoading={isTesting} className="flex-1">
                  <TestTube className="w-4 h-4 mr-2" />
                  Test Koneksi
                </Button>
                <Button onClick={handleSave} isLoading={isSaving} className="flex-1">
                  <Save className="w-4 h-4 mr-2" />
                  Simpan Proxy
                </Button>
              </div>

              {/* Info Box */}
              <div className="p-4 bg-blue-50 rounded-xl border border-blue-200">
                <p className="text-sm font-medium text-blue-800 mb-2">💡 Tips Proxy Residential</p>
                <ul className="text-xs text-blue-700 space-y-1">
                  <li>• Gunakan provider terpercaya seperti <strong>Bright Data, Smartproxy, atau IPRoyal</strong></li>
                  <li>• Pilih proxy <strong>SOCKS5 rotating residential</strong> untuk hasil terbaik</li>
                  <li>• Pastikan lokasi proxy <strong>sesuai negara</strong> nomor WhatsApp Anda</li>
                  <li>• Setelah simpan, <strong>restart semua session</strong> agar proxy diterapkan</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
