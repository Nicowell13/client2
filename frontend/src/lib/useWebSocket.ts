'use client';

import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

const SOCKET_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface UseWebSocketOptions {
    autoConnect?: boolean;
}

interface WebSocketHook {
    socket: Socket | null;
    isConnected: boolean;
    connect: () => void;
    disconnect: () => void;
}

/**
 * Custom hook for WebSocket connection management
 * Provides auto-reconnection and connection status
 */
export function useWebSocket(options: UseWebSocketOptions = {}): WebSocketHook {
    const { autoConnect = true } = options;
    const [isConnected, setIsConnected] = useState(false);
    const socketRef = useRef<Socket | null>(null);

    useEffect(() => {
        if (!autoConnect) return;

        // Initialize Socket.IO client
        const socket = io(SOCKET_URL, {
            reconnection: true,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            reconnectionAttempts: Infinity,
            transports: ['websocket', 'polling'],
        });

        socketRef.current = socket;

        // Connection event handlers
        socket.on('connect', () => {
            console.log('✅ [WebSocket] Connected to server');
            setIsConnected(true);
        });

        socket.on('disconnect', (reason) => {
            console.log('❌ [WebSocket] Disconnected:', reason);
            setIsConnected(false);
        });

        socket.on('connect_error', (error) => {
            console.error('⚠️ [WebSocket] Connection error:', error.message);
            setIsConnected(false);
        });

        socket.on('reconnect', (attemptNumber) => {
            console.log(`🔄 [WebSocket] Reconnected after ${attemptNumber} attempts`);
            setIsConnected(true);
        });

        socket.on('reconnect_attempt', (attemptNumber) => {
            console.log(`🔄 [WebSocket] Reconnection attempt ${attemptNumber}`);
        });

        socket.on('reconnect_error', (error) => {
            console.error('⚠️ [WebSocket] Reconnection error:', error.message);
        });

        socket.on('reconnect_failed', () => {
            console.error('❌ [WebSocket] Reconnection failed');
        });

        // Cleanup on unmount
        return () => {
            console.log('🔌 [WebSocket] Cleaning up connection');
            socket.disconnect();
            socketRef.current = null;
        };
    }, [autoConnect]);

    const connect = () => {
        if (socketRef.current && !socketRef.current.connected) {
            socketRef.current.connect();
        }
    };

    const disconnect = () => {
        if (socketRef.current && socketRef.current.connected) {
            socketRef.current.disconnect();
        }
    };

    return {
        socket: socketRef.current,
        isConnected,
        connect,
        disconnect,
    };
}

/**
 * Hook for subscribing to specific WebSocket events
 */
export function useWebSocketEvent<T = any>(
    socket: Socket | null,
    eventName: string,
    callback: (data: T) => void
) {
    useEffect(() => {
        if (!socket) return;

        socket.on(eventName, callback);

        return () => {
            socket.off(eventName, callback);
        };
    }, [socket, eventName, callback]);
}
