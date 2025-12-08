'use client';

import { useState, useEffect } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { campaignAPI } from '@/lib/api-client';

interface Message {
  id: string;
  status: string;
  sentAt: string | null;
  deliveredAt: string | null;
  errorMsg: string | null;
  contact: {
    name: string;
    phoneNumber: string;
  };
  campaign: {
    name: string;
  };
}

export default function MessagesPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMessages();
    
    // Auto-refresh every 10 seconds
    const interval = setInterval(fetchMessages, 10000);
    return () => clearInterval(interval);
  }, []);

  const fetchMessages = async () => {
    try {
      const resp = await campaignAPI.getAll();
      const campaigns = Array.isArray(resp.data) ? resp.data : resp.data?.data || [];
      const allMessages: Message[] = [];
      
      for (const campaign of campaigns) {
        try {
          const { data: detail } = await campaignAPI.getAll(); // Ideally use a specific endpoint
          if (detail?.messages) {
            allMessages.push(...detail.messages);
          }
        } catch (err) {
          console.error('Error fetching campaign detail:', err);
        }
      }
      
      setMessages(allMessages);
    } catch (error) {
      console.error('Failed to load messages');
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'sent':
      case 'delivered':
        return 'bg-green-100 text-green-800';
      case 'pending':
        return 'bg-yellow-100 text-yellow-800';
      case 'failed':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <DashboardLayout title="Messages" description="View all sent messages and their status">
      <div className="bg-white rounded-lg shadow">
          <div className="p-6 border-b">
            <h2 className="text-xl font-semibold">All Messages ({messages.length})</h2>
          </div>

          {loading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600 mx-auto"></div>
            </div>
          ) : messages.length === 0 ? (
            <div className="p-12 text-center text-gray-600">
              No messages found. Send a campaign to see messages here.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Campaign</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Contact</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Phone</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Sent At</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Error</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {messages.map((message) => (
                    <tr key={message.id}>
                      <td className="px-6 py-4">{message.campaign.name}</td>
                      <td className="px-6 py-4">{message.contact.name}</td>
                      <td className="px-6 py-4">{message.contact.phoneNumber}</td>
                      <td className="px-6 py-4">
                        <span className={`px-3 py-1 rounded-full text-sm ${getStatusColor(message.status)}`}>
                          {message.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        {message.sentAt ? new Date(message.sentAt).toLocaleString() : '-'}
                      </td>
                      <td className="px-6 py-4 text-sm text-red-600">
                        {message.errorMsg || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </DashboardLayout>
  );
}
