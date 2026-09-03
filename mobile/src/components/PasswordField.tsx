import { useState } from 'react'
import { StyleSheet, Text, TextInput, TouchableOpacity, View, type TextInputProps } from 'react-native'

/**
 * A TextInput with a show/hide eye toggle - mirrors web's src/components/PasswordInput.tsx.
 * Renders a normal TextInput (every prop the caller passes - value/onChangeText, placeholder,
 * style, onFocus/onBlur, etc. - still works exactly as before), just with secureTextEntry driven
 * by the toggle instead of always being on. Uses an emoji glyph rather than an icon library -
 * @expo/vector-icons isn't a dependency of this project yet, and adding one would mean another
 * `npm install` + "Cannot find module" round for no real benefit here.
 */
export function PasswordField({ style, ...props }: TextInputProps) {
  const [visible, setVisible] = useState(false)
  return (
    <View style={styles.wrap}>
      <TextInput {...props} secureTextEntry={!visible} style={[style, styles.input]} />
      <TouchableOpacity
        onPress={() => setVisible((v) => !v)}
        style={styles.toggle}
        accessibilityLabel={visible ? 'Hide password' : 'Show password'}
      >
        <Text style={styles.toggleText}>{visible ? '🙈' : '👁️'}</Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { justifyContent: 'center' },
  input: { paddingRight: 42 },
  toggle: { position: 'absolute', right: 6, top: 0, bottom: 0, justifyContent: 'center', paddingHorizontal: 6 },
  toggleText: { fontSize: 17 },
})
