import React, { type ReactNode } from 'react';
import { Platform, Text, View } from 'react-native';
import { Button } from './ui.tsx';
import { styles } from '../styles.ts';

/**
 * Keeps one rendering failure from blanking the whole app. Saved apartments live in device
 * storage, so reloading loses nothing.
 */
export class ErrorBoundary extends React.Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: { componentStack?: string | null }) {
    console.error('Walkup could not render:', error);
    // Sent to the server so a crash someone sees can be found and fixed; nothing about them is included.
    if (Platform.OS !== 'web') return;
    const failure = error instanceof Error ? error : new Error(String(error));
    fetch('/api/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: failure.message.slice(0, 300),
        stack: (failure.stack ?? '').slice(0, 1500),
        componentStack: (info.componentStack ?? '').slice(0, 1500),
        path: window.location.pathname.slice(0, 200),
      }),
    }).catch(() => {});
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <View accessibilityRole="alert" style={styles.filters}>
        <Text style={styles.sectionHeading}>Something went wrong</Text>
        <Text style={styles.smallMuted}>Walkup hit an unexpected problem. Your saved apartments are kept on this device.</Text>
        <Button
          onPress={() => {
            if (Platform.OS === 'web') window.location.reload();
            else this.setState({ failed: false });
          }}
        >
          Reload
        </Button>
      </View>
    );
  }
}
