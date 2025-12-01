'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
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
      const token = localStorage.getItem('token');
      
      // Fetch contacts count
      const contactsRes = await fetch('http://localhost:4000/api/contacts', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const contacts = await contactsRes.json();

      // Fetch campaigns count
      const campaignsRes = await fetch('http://localhost:4000/api/campaigns', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const campaigns = await campaignsRes.json();

      // Fetch sessions count
      const sessionsRes = await fetch('http://localhost:4000/api/sessions', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const sessions = await sessionsRes.json();

      setStats({
        totalContacts: contacts.length || 0,
        totalCampaigns: campaigns.length || 0,
        sentMessages: campaigns.reduce((sum: number, c: any) => sum + (c.sentCount || 0), 0),
        failedMessages: campaigns.reduce((sum: number, c: any) => sum + (c.failedCount || 0), 0),
        activeSessions: sessions.filter((s: any) => s.status === 'working').length || 0,
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
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
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
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center">
                <MessageSquare className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900">WhatsApp Campaign Manager</h1>
                <p className="text-sm text-gray-500">Manage your campaigns efficiently</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="text-sm font-medium text-gray-900">{user?.name}</p>
                <Badge variant={user?.role === 'admin' ? 'info' : 'default'} size="sm">
                  {user?.role}
                </Badge>
              </div>
              <Button variant="outline" size="sm" onClick={handleLogout}>
                Logout
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Welcome Section */}
        <div className="mb-8">
          <h2 className="text-3xl font-bold text-gray-900 mb-2">
            Welcome back, {user?.name}! 👋
          </h2>
          <p className="text-gray-600">Here's what's happening with your campaigns today.</p>
        </div>

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
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
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
  );
}
