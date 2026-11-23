import React, { type ReactNode } from 'react';
import { Platform, Text, View } from 'react-native';
import { Button } from './ui.tsx';
import { styles } from './styles.ts';

/**
 * Keeps one rendering failure from blanking the whole app. Saved apartments live in device
 * storage, so reloading loses nothing.
 */
export class ErrorBoundary extends React.Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: unknown) {
    console.error('Apartment Search could not render:', error);
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <View accessibilityRole="alert" style={styles.filters}>
        <Text style={styles.sectionHeading}>Something went wrong</Text>
        <Text style={styles.smallMuted}>Apartment Search hit an unexpected problem. Your saved apartments are kept on this device.</Text>
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
