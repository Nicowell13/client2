'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Sidebar from '@/components/Sidebar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { campaignAPI, contactAPI, sessionAPI } from '@/lib/api-client';
import { useWebSocket, useWebSocketEvent } from '@/lib/useWebSocket';
import {
  Users,
  MessageSquare,
  Send,
  CheckCircle,
  XCircle,
  Activity,
  TrendingUp,
  Clock,
  ArrowRight,
  Zap,
  BarChart3,
  Wifi,
  WifiOff,
} from 'lucide-react';

interface Stats {
  totalContacts: number;
  totalCampaigns: number;
  sentMessages: number;
  failedMessages: number;
  activeSessions: number;
}

export default function Home() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [stats, setStats] = useState<Stats>({
    totalContacts: 0,
    totalCampaigns: 0,
    sentMessages: 0,
    failedMessages: 0,
    activeSessions: 0,
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    const userData = localStorage.getItem('user');

    if (!token || !userData) {
      router.push('/login');
      return;
    }

    setUser(JSON.parse(userData));
    fetchStats();
  }, []);

  // Initialize WebSocket connection
  const { socket, isConnected } = useWebSocket({ autoConnect: true });

  // Fetch stats from API (initial load)
  const fetchStats = useCallback(async () => {
    try {
      const contactsResp = await contactAPI.getAll({ page: 1, limit: 1 });
      const contactsPayload = contactsResp.data;
      const totalContacts =
        Number(contactsPayload?.pagination?.total) ||
        (Array.isArray(contactsPayload?.data) ? contactsPayload.data.length : 0);

      const campaignsResp = await campaignAPI.getAll();
      const campaignsPayload = campaignsResp.data;
      const campaignsList = Array.isArray(campaignsPayload)
        ? campaignsPayload
        : Array.isArray(campaignsPayload?.data)
          ? campaignsPayload.data
          : [];

      const sessionsResp = await sessionAPI.getAll();
      const sessionsPayload = sessionsResp.data;
      const sessionsList = Array.isArray(sessionsPayload)
        ? sessionsPayload
        : Array.isArray(sessionsPayload?.data)
          ? sessionsPayload.data
          : [];

      const connectedStatuses = new Set(['working', 'ready', 'authenticated']);
      const activeSessions = sessionsList.filter((s: any) =>
        connectedStatuses.has(String(s?.status || '').toLowerCase())
      ).length;

      const sentMessages = campaignsList.reduce(
        (sum: number, c: any) => sum + Number(c?.sentCount || 0),
        0
      );
      const failedMessages = campaignsList.reduce(
        (sum: number, c: any) => sum + Number(c?.failedCount || 0),
        0
      );

      setStats({
        totalContacts,
        totalCampaigns: campaignsList.length,
        sentMessages,
        failedMessages,
        activeSessions,
      });
    } catch (error) {
      console.error('Failed to fetch stats:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // WebSocket event listeners for real-time updates
  useWebSocketEvent(socket, 'stats:update', (data: Partial<Stats>) => {
    console.log('📊 [Dashboard] Stats update received:', data);
    setStats((prev) => ({ ...prev, ...data }));
  });

  useWebSocketEvent(socket, 'campaign:update', (data: any) => {
    console.log('📢 [Dashboard] Campaign update received:', data);
    // Refresh stats to get updated campaign counts
    fetchStats();
  });

  useWebSocketEvent(socket, 'message:update', (data: any) => {
    console.log('💬 [Dashboard] Message update received:', data);
    // Refresh stats to get updated message counts
    fetchStats();
  });

  useWebSocketEvent(socket, 'session:update', (data: any) => {
    console.log('📱 [Dashboard] Session update received:', data);
    // Refresh stats to get updated session counts
    fetchStats();
  });

  if (isLoading) {
    return (
      <div className="flex h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
        <Sidebar user={user} />
        <div className="flex-1 lg:ml-64 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-16 w-16 border-4 border-blue-600 border-t-transparent mx-auto mb-4"></div>
            <p className="text-gray-600 font-medium">Loading dashboard...</p>
          </div>
        </div>
      </div>
    );
  }

  const successRate = stats.sentMessages + stats.failedMessages > 0
    ? ((stats.sentMessages / (stats.sentMessages + stats.failedMessages)) * 100).toFixed(1)
    : '0';

  const statCards = [
    {
      title: 'Contacts',
      value: stats.totalContacts.toLocaleString(),
      icon: Users,
      gradient: 'from-blue-500 to-blue-600',
      bgGradient: 'from-blue-50 to-blue-100',
      href: '/contacts',
    },
    {
      title: 'Campaigns',
      value: stats.totalCampaigns.toLocaleString(),
      icon: MessageSquare,
      gradient: 'from-purple-500 to-purple-600',
      bgGradient: 'from-purple-50 to-purple-100',
      href: '/campaigns',
    },
    {
      title: 'Messages Sent',
      value: stats.sentMessages.toLocaleString(),
      icon: Send,
      gradient: 'from-green-500 to-green-600',
      bgGradient: 'from-green-50 to-green-100',
      href: '/messages',
    },
    {
      title: 'Active Sessions',
      value: stats.activeSessions.toLocaleString(),
      icon: Activity,
      gradient: 'from-orange-500 to-orange-600',
      bgGradient: 'from-orange-50 to-orange-100',
      href: '/sessions',
      badge: stats.activeSessions > 0 ? 'Online' : 'Offline',
      badgeColor: stats.activeSessions > 0 ? 'bg-green-500' : 'bg-gray-400',
    },
  ];

  return (
    <div className="flex h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      <Sidebar user={user} />

      <div className="flex-1 lg:ml-64 overflow-auto">
        {/* Modern Header */}
        <header className="bg-white/80 backdrop-blur-lg border-b border-gray-200/50 sticky top-0 z-10 shadow-sm">
          <div className="px-4 sm:px-6 lg:px-8 py-6">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                  Dashboard
                </h1>
                <p className="text-sm text-gray-600 mt-1">Welcome back, {user?.name}!</p>
              </div>
              <div className="hidden md:flex items-center gap-4">
                {/* Real-time connection status indicator */}
                <div className={`flex items-center gap-2 px-4 py-2 rounded-full transition-all ${isConnected
                    ? 'bg-green-50 text-green-700'
                    : 'bg-gray-50 text-gray-500'
                  }`}>
                  {isConnected ? (
                    <>
                      <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                      <Wifi className="w-4 h-4" />
                      <span className="text-sm font-medium">Live</span>
                    </>
                  ) : (
                    <>
                      <WifiOff className="w-4 h-4" />
                      <span className="text-sm font-medium">Reconnecting...</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </header>

        <main className="px-4 sm:px-6 lg:px-8 py-8">
          {/* Stats Grid - Modern Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            {statCards.map((stat, index) => {
              const Icon = stat.icon;
              return (
                <Link key={index} href={stat.href}>
                  <div className="group relative overflow-hidden rounded-2xl bg-white shadow-lg hover:shadow-2xl transition-all duration-300 cursor-pointer border border-gray-100">
                    {/* Gradient Background */}
                    <div className={`absolute inset-0 bg-gradient-to-br ${stat.bgGradient} opacity-50 group-hover:opacity-70 transition-opacity`}></div>

                    {/* Content */}
                    <div className="relative p-6">
                      <div className="flex items-start justify-between mb-4">
                        <div className={`p-3 rounded-xl bg-gradient-to-br ${stat.gradient} shadow-lg`}>
                          <Icon className="w-6 h-6 text-white" />
                        </div>
                        {stat.badge && (
                          <span className={`px-3 py-1 ${stat.badgeColor} text-white text-xs font-semibold rounded-full`}>
                            {stat.badge}
                          </span>
                        )}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-600 mb-1">{stat.title}</p>
                        <p className="text-4xl font-bold text-gray-900">{stat.value}</p>
                      </div>

                      {/* Hover Arrow */}
                      <div className="absolute bottom-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
                        <ArrowRight className="w-5 h-5 text-gray-400" />
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>

          {/* Success Rate Card */}
          {(stats.sentMessages > 0 || stats.failedMessages > 0) && (
            <div className="mb-8">
              <div className="bg-gradient-to-r from-green-500 to-emerald-600 rounded-2xl p-6 text-white shadow-xl">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <BarChart3 className="w-5 h-5" />
                      <p className="text-sm font-medium opacity-90">Success Rate</p>
                    </div>
                    <p className="text-5xl font-bold">{successRate}%</p>
                    <p className="text-sm opacity-75 mt-2">
                      {stats.sentMessages} sent · {stats.failedMessages} failed
                    </p>
                  </div>
                  <div className="hidden md:block">
                    <div className="w-32 h-32 relative">
                      <svg className="transform -rotate-90 w-32 h-32">
                        <circle
                          cx="64"
                          cy="64"
                          r="56"
                          stroke="rgba(255,255,255,0.2)"
                          strokeWidth="12"
                          fill="none"
                        />
                        <circle
                          cx="64"
                          cy="64"
                          r="56"
                          stroke="white"
                          strokeWidth="12"
                          fill="none"
                          strokeDasharray={`${(parseFloat(successRate) / 100) * 351.86} 351.86`}
                          strokeLinecap="round"
                        />
                      </svg>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <TrendingUp className="w-8 h-8" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Quick Actions & Activity */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Quick Actions */}
            <Card variant="bordered" className="shadow-lg">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Zap className="w-5 h-5 text-blue-600" />
                  <CardTitle>Quick Actions</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <Link href="/sessions">
                  <Button variant="outline" className="w-full justify-start group hover:bg-blue-50 hover:border-blue-300 transition-all" size="lg">
                    <Activity className="w-5 h-5 mr-3 text-blue-600" />
                    <span className="flex-1 text-left">Manage Sessions</span>
                    <ArrowRight className="w-4 h-4 text-gray-400 group-hover:text-blue-600 group-hover:translate-x-1 transition-all" />
                  </Button>
                </Link>
                <Link href="/contacts">
                  <Button variant="outline" className="w-full justify-start group hover:bg-purple-50 hover:border-purple-300 transition-all" size="lg">
                    <Users className="w-5 h-5 mr-3 text-purple-600" />
                    <span className="flex-1 text-left">Upload Contacts</span>
                    <ArrowRight className="w-4 h-4 text-gray-400 group-hover:text-purple-600 group-hover:translate-x-1 transition-all" />
                  </Button>
                </Link>
                <Link href="/campaigns">
                  <Button className="w-full justify-start bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 group shadow-lg" size="lg">
                    <MessageSquare className="w-5 h-5 mr-3" />
                    <span className="flex-1 text-left">Create Campaign</span>
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-all" />
                  </Button>
                </Link>
              </CardContent>
            </Card>

            {/* Activity Summary */}
            <Card variant="bordered" className="shadow-lg">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Clock className="w-5 h-5 text-purple-600" />
                  <CardTitle>Activity</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {stats.totalCampaigns === 0 ? (
                    <div className="text-center py-12">
                      <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Clock className="w-8 h-8 text-gray-400" />
                      </div>
                      <p className="text-gray-600 font-medium mb-1">No campaigns yet</p>
                      <p className="text-sm text-gray-500">Create your first campaign to get started</p>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-4 p-4 bg-gradient-to-r from-green-50 to-emerald-50 rounded-xl border border-green-200">
                        <div className="p-2 bg-green-500 rounded-lg">
                          <CheckCircle className="w-5 h-5 text-white" />
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-semibold text-gray-900">Messages Delivered</p>
                          <p className="text-2xl font-bold text-green-600">{stats.sentMessages.toLocaleString()}</p>
                        </div>
                      </div>
                      {stats.failedMessages > 0 && (
                        <div className="flex items-center gap-4 p-4 bg-gradient-to-r from-red-50 to-rose-50 rounded-xl border border-red-200">
                          <div className="p-2 bg-red-500 rounded-lg">
                            <XCircle className="w-5 h-5 text-white" />
                          </div>
                          <div className="flex-1">
                            <p className="text-sm font-semibold text-gray-900">Failed Messages</p>
                            <p className="text-2xl font-bold text-red-600">{stats.failedMessages.toLocaleString()}</p>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </main>
      </div>
    </div>
  );
}
