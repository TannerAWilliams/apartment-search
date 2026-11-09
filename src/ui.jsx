import React from 'react';
import { Linking, Pressable, Text, TextInput, View } from 'react-native';
import { colors, styles } from './styles.js';

export function Chip({ children, selected = false, onPress }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected }}
    onPress={onPress} style={({ pressed }) => [styles.chip, selected && styles.chipActive, pressed && styles.pressed]}>
    <Text style={[styles.chipText, selected && styles.chipTextActive]}>{children}</Text>
  </Pressable>;
}

export function Button({ children, onPress, secondary = false, disabled = false }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }}
    onPress={onPress} disabled={disabled}
    style={({ pressed }) => [styles.button, secondary && styles.buttonSecondary,
      (pressed || disabled) && styles.pressed]}>
    <Text style={[styles.buttonText, secondary && styles.buttonTextSecondary]}>{children}</Text>
  </Pressable>;
}

export function Link({ label, url, onError }) {
  return <Pressable accessibilityRole="link" onPress={() => {
    Linking.openURL(url).catch(() => onError('This link could not be opened on your device.'));
  }} style={({ pressed }) => [styles.link, pressed && styles.pressed]}>
    <Text style={styles.linkText}>{label} ↗</Text>
  </Pressable>;
}

export function SectionTitle({ index, children }) {
  return <View style={styles.sectionTitle}>
    <Text style={styles.sectionIndex}>{index}</Text>
    <Text accessibilityRole="header" style={styles.sectionHeading}>{children}</Text>
  </View>;
}

export function Field({ label, placeholder, value, onChangeText, keyboardType, maxLength, secureTextEntry }) {
  return <View style={styles.field}>
    <Text style={styles.fieldLabel}>{label}</Text>
    <TextInput accessibilityLabel={label} value={value} onChangeText={onChangeText}
      placeholder={placeholder} placeholderTextColor={colors.muted} style={styles.input}
      keyboardType={keyboardType} maxLength={maxLength} secureTextEntry={secureTextEntry}
      autoCapitalize={secureTextEntry ? 'none' : 'sentences'} autoCorrect={false} />
  </View>;
}

