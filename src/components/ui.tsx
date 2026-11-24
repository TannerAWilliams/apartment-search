import { type ComponentType, type ReactNode, useState } from 'react';
import type { TextInputProps, ViewProps } from 'react-native';
import { Linking, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { colors, styles } from '../styles.ts';

/**
 * Props for a button that toggles on and off: aria-pressed on the web (aria-selected is not allowed on
 * buttons), the "selected" state on iOS and Android.
 */
export const toggleProps = (on: boolean) => (Platform.OS === 'web' ? { 'aria-pressed': on } : { accessibilityState: { selected: on } });

export function Chip({
  children,
  selected = false,
  onPress,
  label,
}: {
  children: ReactNode;
  selected?: boolean;
  onPress: () => void;
  label?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      {...toggleProps(selected)}
      accessibilityLabel={label}
      aria-label={label}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, selected && styles.chipActive, pressed && styles.pressed]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextActive]}>{children}</Text>
    </Pressable>
  );
}

export function Button({
  children,
  onPress,
  secondary = false,
  dark = false,
  disabled = false,
  label,
}: {
  children: ReactNode;
  onPress: () => void;
  secondary?: boolean;
  /** Near-black, for the button that shows results (the accent is kept for saving and the brand). */
  dark?: boolean;
  disabled?: boolean;
  /** The accessible name, when the visible text is shorter (Resync for Resync StreetEasy). */
  label?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      aria-label={label}
      accessibilityState={{ disabled }}
      aria-disabled={disabled}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        secondary && styles.buttonSecondary,
        dark && styles.buttonDark,
        (pressed || disabled) && styles.pressed,
      ]}
    >
      <Text style={[styles.buttonText, secondary && styles.buttonTextSecondary]}>{children}</Text>
    </Pressable>
  );
}

const WebLink = View as ComponentType<ViewProps & { href: string; hrefAttrs?: { target?: string; rel?: string } }>;

export function ExternalLink({
  url,
  onError,
  children,
  style,
  ...props
}: {
  url: string;
  onError?: (message: string) => void;
  children: ReactNode;
  style?: ViewProps['style'] | ((state: { pressed: boolean }) => ViewProps['style']);
  accessibilityLabel?: string;
}) {
  if (Platform.OS === 'web') {
    // Listings and other sites open in a new tab, so the app stays where it was. A real anchor, so a browser that
    // refuses new tabs still follows it.
    return (
      <WebLink
        accessibilityRole="link"
        {...props}
        href={url}
        hrefAttrs={{ target: '_blank', rel: 'noopener noreferrer' }}
        style={typeof style === 'function' ? style({ pressed: false }) : style}
      >
        {children}
      </WebLink>
    );
  }
  return (
    <Pressable
      accessibilityRole="link"
      {...props}
      style={style}
      onPress={() => Linking.openURL(url).catch(() => onError?.('This link could not be opened on your device.'))}
    >
      {children}
    </Pressable>
  );
}

export function Link({ label, url, onError }: { label: string; url: string; onError?: (message: string) => void }) {
  return (
    <ExternalLink url={url} onError={onError} style={({ pressed }) => [styles.link, pressed && styles.pressed]}>
      <Text style={styles.linkText}>{label} ↗</Text>
    </ExternalLink>
  );
}

export function Field({
  label,
  placeholder,
  value,
  onChangeText,
  keyboardType,
  maxLength,
  secureTextEntry,
}: Pick<TextInputProps, 'placeholder' | 'value' | 'onChangeText' | 'keyboardType' | 'maxLength' | 'secureTextEntry'> & { label: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        style={styles.input}
        keyboardType={keyboardType}
        maxLength={maxLength}
        secureTextEntry={secureTextEntry}
        autoCapitalize={secureTextEntry ? 'none' : 'sentences'}
        autoCorrect={false}
      />
    </View>
  );
}

/** A section that stays folded until asked for: its title, a chevron, and the content when open. */
export function Disclosure({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: 8 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded: open }}
        aria-expanded={open}
        onPress={() => setOpen(!open)}
        style={({ pressed }) => [
          { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 40 },
          pressed && styles.pressed,
        ]}
      >
        <Text style={styles.linkText}>{title}</Text>
        <Text style={[styles.linkText, { fontSize: 16 }]}>{open ? '▴' : '▾'}</Text>
      </Pressable>
      {open && children}
    </View>
  );
}
