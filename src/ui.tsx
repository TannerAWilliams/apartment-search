import React, { type ComponentType, type ReactNode } from 'react';
import type { TextInputProps, ViewProps } from 'react-native';
import { Linking, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { colors, styles } from './styles.ts';

export function Chip({ children, selected = false, onPress, label }: { children: ReactNode; selected?: boolean; onPress: () => void; label?: string }) {
  // aria-selected is what react-native-web exposes on the web; accessibilityState covers native.
  return <Pressable accessibilityRole="button" accessibilityState={{ selected }} aria-selected={selected}
    accessibilityLabel={label} aria-label={label}
    onPress={onPress} style={({ pressed }) => [styles.chip, selected && styles.chipActive, pressed && styles.pressed]}>
    <Text style={[styles.chipText, selected && styles.chipTextActive]}>{children}</Text>
  </Pressable>;
}

export function Button({ children, onPress, secondary = false, disabled = false }: { children: ReactNode; onPress: () => void; secondary?: boolean; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} aria-disabled={disabled}
    onPress={onPress} disabled={disabled}
    style={({ pressed }) => [styles.button, secondary && styles.buttonSecondary,
      (pressed || disabled) && styles.pressed]}>
    <Text style={[styles.buttonText, secondary && styles.buttonTextSecondary]}>{children}</Text>
  </Pressable>;
}

const WebLink = View as ComponentType<ViewProps & { href: string }>;

export function ExternalLink({ url, onError, children, style, ...props }: {
  url: string; onError?: (message: string) => void; children: ReactNode; style?: ViewProps['style'] | ((state: { pressed: boolean }) => ViewProps['style']); accessibilityLabel?: string;
}) {
  if (Platform.OS === 'web') {
    // Embedded browsers may ignore new tabs. Let the anchor navigate this tab.
    return <WebLink accessibilityRole="link" {...props} href={url}
      style={typeof style === 'function' ? style({ pressed: false }) : style}>{children}</WebLink>;
  }
  return <Pressable accessibilityRole="link" {...props} style={style}
    onPress={() => Linking.openURL(url).catch(() => onError?.('This link could not be opened on your device.'))}>
    {children}
  </Pressable>;
}

export function Link({ label, url, onError }: { label: string; url: string; onError?: (message: string) => void }) {
  return <ExternalLink url={url} onError={onError} style={({ pressed }) => [styles.link, pressed && styles.pressed]}>
    <Text style={styles.linkText}>{label} ↗</Text>
  </ExternalLink>;
}

export function SectionTitle({ index, children }: { index: string | number; children: ReactNode }) {
  return <View style={styles.sectionTitle}>
    <Text style={styles.sectionIndex}>{index}</Text>
    <Text accessibilityRole="header" style={styles.sectionHeading}>{children}</Text>
  </View>;
}

export function Field({ label, placeholder, value, onChangeText, keyboardType, maxLength, secureTextEntry }: Pick<TextInputProps, 'placeholder' | 'value' | 'onChangeText' | 'keyboardType' | 'maxLength' | 'secureTextEntry'> & { label: string }) {
  return <View style={styles.field}>
    <Text style={styles.fieldLabel}>{label}</Text>
    <TextInput accessibilityLabel={label} value={value} onChangeText={onChangeText}
      placeholder={placeholder} placeholderTextColor={colors.muted} style={styles.input}
      keyboardType={keyboardType} maxLength={maxLength} secureTextEntry={secureTextEntry}
      autoCapitalize={secureTextEntry ? 'none' : 'sentences'} autoCorrect={false} />
  </View>;
}

