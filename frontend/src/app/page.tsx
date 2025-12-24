'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Sidebar from '@/components/Sidebar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { campaignAPI, contactAPI, sessionAPI } from '@/lib/api-client';
import { 
  Users, 
  MessageSquare, 
  Send, 
  CheckCircle, 
  XCircle,
  Activity,
  TrendingUp,
  Clock,
  ArrowRight
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

  const fetchStats = async () => {
    try {
      // Contacts: use pagination.total to avoid fetching everything
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
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    router.push('/login');
  };

  if (isLoading) {
    return (
      <div className="flex h-screen">
        <Sidebar user={user} />
        <div className="flex-1 lg:ml-64 flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      </div>
    );
  }

  const statCards = [
    {
      title: 'Total Contacts',
      value: stats.totalContacts.toLocaleString(),
      icon: Users,
      colors: { bg: 'bg-blue-100', icon: 'text-blue-600' },
      change: '+12%',
      href: '/contacts',
    },
    {
      title: 'Total Campaigns',
      value: stats.totalCampaigns.toLocaleString(),
      icon: MessageSquare,
      colors: { bg: 'bg-purple-100', icon: 'text-purple-600' },
      change: '+8%',
      href: '/campaigns',
    },
    {
      title: 'Messages Sent',
      value: stats.sentMessages.toLocaleString(),
      icon: Send,
      colors: { bg: 'bg-green-100', icon: 'text-green-600' },
      change: '+23%',
      href: '/messages',
    },
    {
      title: 'Active Sessions',
      value: stats.activeSessions.toLocaleString(),
      icon: Activity,
      colors: { bg: 'bg-orange-100', icon: 'text-orange-600' },
      change: stats.activeSessions > 0 ? 'Online' : 'Offline',
      href: '/sessions',
    },
  ];

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar user={user} />
      
      <div className="flex-1 lg:ml-64 overflow-auto">
        {/* Header */}
        <header className="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-10">
          <div className="px-4 sm:px-6 lg:px-8 py-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
              <p className="text-sm text-gray-500">Welcome back, {user?.name}! Here&apos;s what&apos;s happening today.</p>
            </div>
          </div>
        </header>

        <main className="px-4 sm:px-6 lg:px-8 py-8">
          {/* Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            {statCards.map((stat, index) => {
              const Icon = stat.icon;
              return (
                <Link key={index} href={stat.href}>
                  <Card variant="elevated" className="hover:shadow-xl transition-all cursor-pointer group">
                    <CardContent className="p-6">
                      <div className="flex items-start justify-between mb-4">
                        <div className={`p-3 rounded-xl ${stat.colors.bg}`}>
                          <Icon className={`w-6 h-6 ${stat.colors.icon}`} />
                        </div>
                        <ArrowRight className="w-5 h-5 text-gray-400 group-hover:text-blue-600 transition-colors" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-600 mb-1">{stat.title}</p>
                        <p className="text-3xl font-bold text-gray-900 mb-2">{stat.value}</p>
                        <div className="flex items-center gap-2">
                          <TrendingUp className="w-4 h-4 text-green-600" />
                          <span className="text-sm text-green-600 font-medium">{stat.change}</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>

          {/* Quick Actions */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card variant="bordered">
              <CardHeader>
                <CardTitle>Quick Actions</CardTitle>
                <CardDescription>Common tasks to get you started</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Link href="/sessions">
                  <Button variant="outline" className="w-full justify-start" size="lg">
                    <Activity className="w-5 h-5 mr-2" />
                    Manage WhatsApp Sessions
                  </Button>
                </Link>
                <Link href="/contacts">
                  <Button variant="outline" className="w-full justify-start" size="lg">
                    <Users className="w-5 h-5 mr-2" />
                    Upload Contacts
                  </Button>
                </Link>
                <Link href="/campaigns">
                  <Button variant="primary" className="w-full justify-start" size="lg">
                    <MessageSquare className="w-5 h-5 mr-2" />
                    Create New Campaign
                  </Button>
                </Link>
              </CardContent>
            </Card>

            <Card variant="bordered">
              <CardHeader>
                <CardTitle>Recent Activity</CardTitle>
                <CardDescription>Latest campaign updates</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {stats.totalCampaigns === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                      <Clock className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                      <p>No campaigns yet</p>
                      <p className="text-sm">Create your first campaign to get started</p>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-3 p-3 bg-green-50 rounded-lg">
                        <CheckCircle className="w-5 h-5 text-green-600" />
                        <div className="flex-1">
                          <p className="text-sm font-medium text-gray-900">Messages Sent</p>
                          <p className="text-xs text-gray-600">{stats.sentMessages} messages delivered successfully</p>
                        </div>
                      </div>
                      {stats.failedMessages > 0 && (
                        <div className="flex items-center gap-3 p-3 bg-red-50 rounded-lg">
                          <XCircle className="w-5 h-5 text-red-600" />
                          <div className="flex-1">
                            <p className="text-sm font-medium text-gray-900">Failed Messages</p>
                            <p className="text-xs text-gray-600">{stats.failedMessages} messages failed to send</p>
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
