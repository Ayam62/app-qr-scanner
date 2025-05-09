import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Switch, TouchableOpacity, View, ScrollView } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { AppState } from 'react-native';
import BackgroundService from 'react-native-background-actions';

import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import ParallaxScrollView from '@/components/ParallaxScrollView';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';

// Get the WebSocket URL from the saved connection
const SOCKET_URL = 'ws://192.168.1.74:8000/ws/clipboard-sync';  // Updated port and added client-id

const sleep = (time: number) => new Promise(resolve => setTimeout(resolve, time));

const backgroundClipboardTask = async (taskData: any) => {
  const { socket } = taskData;
  let lastContent = '';

  while (await BackgroundService.isRunning()) {
    try {
      const currentContent = await Clipboard.getStringAsync();

      if (currentContent && currentContent !== lastContent) {
        console.log('[BACKGROUND] New clipboard:', currentContent);

        // Reconnect WebSocket if closed
        if (!socket || socket.readyState !== WebSocket.OPEN) {
          console.log('[BACKGROUND] Reconnecting WebSocket...');
          taskData.socket = new WebSocket(SOCKET_URL);
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        }

        // Send to backend
        socket.send(JSON.stringify({
          type: 'clipboard_update',
          text: currentContent,
          timestamp: Date.now()
        }));

        lastContent = currentContent;
      }
    } catch (error) {
      console.error('[BACKGROUND ERROR]', error);
    }
    await sleep(1000); // Check every 1 second
  }
};

export default function ClipboardScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const [isEnabled, setIsEnabled] = useState(true);
  const [lastClipboardContent, setLastClipboardContent] = useState('');
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected'>('disconnected');
  const [syncHistory, setSyncHistory] = useState<{text: string, timestamp: number, direction: 'sent' | 'received'}[]>([]);
  
  const socketRef = useRef<WebSocket | null>(null);
  const appState = useRef(AppState.currentState);

  // Connect to WebSocket when component mounts
  useEffect(() => {
    connectWebSocket();
    return () => {
      if (socketRef.current) {
        socketRef.current.close();
      }
    };
  }, []);

  // Handle app state changes (foreground/background)
  useEffect(() => {
    const handleAppStateChange = async (nextAppState: string) => {
      if (nextAppState === 'background' && socketRef.current && isEnabled) {
        console.log('Starting background clipboard service...');
        await BackgroundService.start(backgroundClipboardTask, {
          taskName: 'Clipboard Sync',
          taskTitle: 'Syncing clipboard to PC',
          taskDesc: 'Watching for new copied items',
          taskIcon: {
            name: 'ic_notification',
            type: 'mipmap',
          },
          parameters: {
            socket: socketRef.current,
          },
        });
      } else if (nextAppState === 'active') {
        await BackgroundService.stop();
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => {
      subscription.remove();
      BackgroundService.stop();
    };
  }, [isEnabled]);

  // Periodically check clipboard in foreground
  useEffect(() => {
    if (!isEnabled) return;
    
    const intervalId = setInterval(async () => {
      try {
        const content = await Clipboard.getStringAsync();
        
        if (
          content &&
          content !== lastClipboardContent &&
          socketRef.current?.readyState === WebSocket.OPEN
        ) {
          console.log('[CLIPBOARD SEND]', content);
          socketRef.current.send(
            JSON.stringify({
              type: 'clipboard_update',
              text: content,
              timestamp: Date.now(),
            })
          );
          
          // Update state
          setLastClipboardContent(content);
          setLastSyncTime(new Date());
          
          // Add to history
          setSyncHistory(prev => [
            { text: content, timestamp: Date.now(), direction: 'sent' },
            ...prev.slice(0, 9) // Keep last 10 items
          ]);
        }
      } catch (error) {
        console.error('[CLIPBOARD ERROR]', error);
      }
    }, 1000); // Check every second

    return () => clearInterval(intervalId);
  }, [lastClipboardContent, isEnabled]);

  const connectWebSocket = () => {
    const ws = new WebSocket(SOCKET_URL);

    ws.onopen = () => {
      console.log('WebSocket connected for clipboard');
      setConnectionStatus('connected');
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        
        // Handle clipboard updates from server
        if (message.type === 'clipboard_update' && isEnabled) {
          const newContent = message.text;
          console.log('[CLIPBOARD RECEIVED]', newContent);
          
          // Update the clipboard
          Clipboard.setStringAsync(newContent);
          setLastClipboardContent(newContent);
          setLastSyncTime(new Date());
          
          // Add to history
          setSyncHistory(prev => [
            { text: newContent, timestamp: Date.now(), direction: 'received' },
            ...prev.slice(0, 9) // Keep last 10 items
          ]);
        }
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket Error:', error);
      setConnectionStatus('disconnected');
    };

    ws.onclose = () => {
      console.log('WebSocket connection closed');
      setConnectionStatus('disconnected');
      
      // Try to reconnect after a delay
      setTimeout(() => {
        if (isEnabled) {
          connectWebSocket();
        }
      }, 5000);
    };

    socketRef.current = ws;
  };

  const toggleSwitch = () => {
    const newValue = !isEnabled;
    setIsEnabled(newValue);
    
    if (!newValue && socketRef.current) {
      // If disabling, notify the server
      socketRef.current.send(JSON.stringify({
        type: 'client_setting',
        setting: 'clipboard_sync',
        value: false
      }));
    } else if (newValue && socketRef.current) {
      // If enabling, notify the server
      socketRef.current.send(JSON.stringify({
        type: 'client_setting',
        setting: 'clipboard_sync',
        value: true
      }));
    }
  };

  return (
    <ParallaxScrollView
      headerBackgroundColor={{ light: '#B8E6FF', dark: '#104E8B' }}
      headerImage={
        <Image
          source={require('@/assets/images/partial-react-logo.png')}
          style={styles.headerImage}
        />
      }
    >
      <ThemedView style={styles.container}>
        <ThemedView style={styles.titleContainer}>
          <IconSymbol 
            name="doc.on.clipboard" 
            size={28} 
            color={Colors[colorScheme].text} 
            style={styles.titleIcon} 
          />
          <ThemedText type="title">Clipboard Sync</ThemedText>
        </ThemedView>

        {/* Status Card */}
        <ThemedView style={styles.card}>
          <View style={styles.statusRow}>
            <ThemedText>Connection Status:</ThemedText>
            <View style={styles.statusIndicator}>
              <View style={[
                styles.statusDot, 
                { backgroundColor: connectionStatus === 'connected' ? '#4CD964' : '#FF3B30' }
              ]} />
              <ThemedText>{connectionStatus === 'connected' ? 'Connected' : 'Disconnected'}</ThemedText>
            </View>
          </View>

          <View style={styles.statusRow}>
            <ThemedText>Clipboard Sync:</ThemedText>
            <Switch
              trackColor={{ false: "#767577", true: "#81b0ff" }}
              thumbColor={isEnabled ? "#f5dd4b" : "#f4f3f4"}
              ios_backgroundColor="#3e3e3e"
              onValueChange={toggleSwitch}
              value={isEnabled}
            />
          </View>

          {lastSyncTime && (
            <View style={styles.statusRow}>
              <ThemedText>Last Sync:</ThemedText>
              <ThemedText>{lastSyncTime.toLocaleTimeString()}</ThemedText>
            </View>
          )}
        </ThemedView>

        {/* Current Clipboard */}
        <ThemedView style={styles.card}>
          <ThemedText type="subtitle">Current Clipboard</ThemedText>
          <ThemedView style={styles.clipboardContent}>
            <ScrollView style={styles.scrollView}>
              <ThemedText numberOfLines={10} ellipsizeMode="tail">
                {lastClipboardContent || 'No content'}
              </ThemedText>
            </ScrollView>
          </ThemedView>
        </ThemedView>

        {/* History */}
        <ThemedView style={styles.card}>
          <ThemedText type="subtitle">Sync History</ThemedText>
          <ScrollView style={styles.historyList}>
            {syncHistory.length > 0 ? (
              syncHistory.map((item, index) => (
                <ThemedView key={index} style={styles.historyItem}>
                  <View style={styles.historyDirection}>
                    <IconSymbol 
                      name={item.direction === 'sent' ? 'arrow.up.circle' : 'arrow.down.circle'} 
                      size={20} 
                      color={item.direction === 'sent' ? '#4CD964' : '#5AC8FA'} 
                    />
                    <ThemedText style={styles.historyTimestamp}>
                      {new Date(item.timestamp).toLocaleTimeString()}
                    </ThemedText>
                  </View>
                  <ThemedText numberOfLines={2} ellipsizeMode="tail" style={styles.historyText}>
                    {item.text}
                  </ThemedText>
                </ThemedView>
              ))
            ) : (
              <ThemedText style={styles.emptyHistory}>No sync history</ThemedText>
            )}
          </ScrollView>
        </ThemedView>
      </ThemedView>
    </ParallaxScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    gap: 16,
  },
  headerImage: {
    height: 178,
    width: 290,
    bottom: 0,
    left: 0,
    position: 'absolute',
  },
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  titleIcon: {
    marginRight: 8,
  },
  card: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    paddingVertical: 4,
  },
  statusIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 8,
  },
  clipboardContent: {
    marginTop: 8,
    borderRadius: 8,
    padding: 12,
    minHeight: 80,
    maxHeight: 120,
  },
  scrollView: {
    maxHeight: 100,
  },
  historyList: {
    maxHeight: 300,
  },
  historyItem: {
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  historyDirection: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  historyTimestamp: {
    fontSize: 12,
    marginLeft: 6,
  },
  historyText: {
    marginTop: 4,
  },
  emptyHistory: {
    textAlign: 'center',
    marginTop: 20,
    marginBottom: 20,
    fontStyle: 'italic',
  },
});