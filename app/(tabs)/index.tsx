import { useState,useRef, useEffect } from 'react';
import { Image, StyleSheet, TouchableOpacity } from 'react-native';
import { CameraView, useCameraPermissions, BarcodeScanningResult } from 'expo-camera';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import ParallaxScrollView from '@/components/ParallaxScrollView';
import * as Clipboard from 'expo-clipboard';
import { AppState, Platform } from 'react-native';
import BackgroundService from 'react-native-background-actions';

const SOCKET_URL = 'ws://192.168.1.74:8002/ws/my-phone'; // Updated to match backend

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
          types: 'clipboard_update',
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

export default function HomeScreen() {
  const [facing, setFacing] = useState<'front' | 'back'>('back');
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [socket, setSocket] = useState<WebSocket | null>(null);

  const [lastClipboardContent, setLastClipboardContent] = useState('');
  const socketRef = useRef<WebSocket | null>(null);
  const appState = useRef(AppState.currentState);

  useEffect(() => {
    requestPermission();
    const handleAppStateChange = async (nextAppState: string) => {
      if (nextAppState === 'background' && socketRef.current) {
        console.log('Starting background service...');
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
          linkingURI: 'your-app-scheme://', // For opening app when clicked
        });
      } else if (nextAppState === 'active') {
        await BackgroundService.stop();
      }
    };

    const sub = AppState.addEventListener('change', handleAppStateChange);
    return () => {
      sub.remove();
      BackgroundService.stop();
    };
  }, []);

  useEffect(() => {
    const intervalId = setInterval(async () => {
      try {
        const content = await Clipboard.getStringAsync();
        console.log('[CLIPBOARD CHECK]', content); // Always log clipboard content

        if (
          content &&
          content !== lastClipboardContent &&
          socketRef.current?.readyState === WebSocket.OPEN
        ) {
          console.log('[CLIPBOARD SEND]', content); // Log before sending
          socketRef.current.send(
            JSON.stringify({
              types: 'clipboard_update',
              text:content,
              timestamp: Date.now(),
            })
          );
          setLastClipboardContent(content);
        }
      } catch (error) {
        console.error('[CLIPBOARD ERROR]', error);
      }
    }, 1000); // Check every second

    return () => clearInterval(intervalId);
  }, [lastClipboardContent]);

  const handleBarCodeScanned = ({ data }: BarcodeScanningResult) => {
    setScanned(true);
    // Extract pairing code from QR data (assuming format: "sic://device-id/pairing-code")
    const code = data.split('/').pop();
    if (code) {
      setPairingCode(code);
      alert(`Pairing successful! Code: ${code}`);
      connectWebSocket(code); // Connect to WebSocket after scanning the pairing code
    } else {
      alert('Invalid QR code format');
    }
    setShowCamera(false);
  };

  const connectWebSocket = (pairingCode: string) => {
    // Create a WebSocket connection to the server
    const ws = new WebSocket(SOCKET_URL);

    ws.onopen = () => {
      console.log('WebSocket connected');
      ws.send(JSON.stringify({ type: 'pairing_request', code: pairingCode }));
    };

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === 'pairing_response') {
        if (message.success) {
          alert('Device paired successfully!');
        } else {
          alert('Pairing failed');
        }
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket Error:', error);
    };

    ws.onclose = () => {
      console.log('WebSocket connection closed');
    };

    setSocket(ws); // Save the WebSocket connection for future use
  };

  if (!permission?.granted) {
    return (
      <ThemedView style={styles.container}>
        <ThemedText>Camera permission is required to scan QR codes</ThemedText>
        <TouchableOpacity style={styles.button} onPress={requestPermission}>
          <ThemedText style={styles.buttonText}>Grant Permission</ThemedText>
        </TouchableOpacity>
      </ThemedView>
    );
  }

  if (showCamera) {
    return (
      <ThemedView style={styles.container}>
        <CameraView
          style={styles.camera}
          facing={facing}
          barcodeScannerSettings={{
            barcodeTypes: ['qr'],
          }}
          onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
        />
        <TouchableOpacity style={styles.button} onPress={() => setShowCamera(false)}>
          <ThemedText style={styles.buttonText}>Cancel</ThemedText>
        </TouchableOpacity>
      </ThemedView>
    );
  }

  return (
    <ParallaxScrollView
      headerBackgroundColor={{ light: '#A1CEDC', dark: '#1D3D47' }}
      headerImage={
        <Image
          source={require('@/assets/images/partial-react-logo.png')}
          style={styles.reactLogo}
        />
      }
    >
      <ThemedView style={styles.titleContainer}>
        <ThemedText type="title">Welcome!</ThemedText>
      </ThemedView>

      <ThemedView style={styles.stepContainer}>
        <ThemedText type="subtitle">Pair Your Device</ThemedText>
        <TouchableOpacity 
          style={styles.scanButton} 
          onPress={() => {
            setScanned(false);
            setShowCamera(true);
          }}
        >
          <ThemedText style={styles.buttonText}>Scan QR Code</ThemedText>
        </TouchableOpacity>
        {pairingCode && (
          <ThemedView style={styles.codeContainer}>
            <ThemedText>Pairing Code:</ThemedText>
            <ThemedText type="defaultSemiBold">{pairingCode}</ThemedText>
          </ThemedView>
        )}
      </ThemedView>

      <ThemedView style={styles.stepContainer}>
        <ThemedText type="subtitle">Manual Entry</ThemedText>
        <ThemedText>
          Or enter the code manually if you can't scan the QR code.
        </ThemedText>
      </ThemedView>
    </ParallaxScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  camera: {
    width: '100%',
    height: '70%',
  },
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 20,
  },
  stepContainer: {
    gap: 8,
    marginBottom: 20,
  },
  reactLogo: {
    height: 178,
    width: 290,
    bottom: 0,
    left: 0,
    position: 'absolute',
  },
  scanButton: {
    backgroundColor: '#007AFF',
    padding: 15,
    borderRadius: 5,
    marginTop: 10,
    alignItems: 'center',
  },
  button: {
    backgroundColor: '#FF3B30',
    padding: 15,
    borderRadius: 5,
    marginTop: 20,
    alignItems: 'center',
  },
  buttonText: {
    color: 'white',
    fontWeight: 'bold',
  },
  codeContainer: {
    marginTop: 20,
    padding: 15,
    backgroundColor: '#f0f0f0',
    borderRadius: 5,
    alignItems: 'center',
  },
});
