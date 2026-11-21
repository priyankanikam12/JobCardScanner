// mobile\src\components\KeyboardSafe.tsx
// 2026-11-21 ("fix Android UI automatically when the keyboard opens, all pages"): ONE global, reusable keyboard fix for the whole Android app.
//
// WHY the keyboard covered inputs: the app runs edge-to-edge (android/gradle.properties edgeToEdgeEnabled=true, Expo SDK 57 / React Native 0.86). In edge-to-edge mode Android no longer shrinks the window for
// android:windowSoftInputMode="adjustResize" (the screens' own KeyboardAvoidingView is deliberately a no-op on Android: behavior={Platform.OS === 'ios' ? 'padding' : undefined}), so the keyboard simply sits on top
// of the content. Only the 3 screens/modals that had their own handling were ever safe, and none of them did anything on Android.
//
// WHAT this file gives (no new native dependency, so it ships in a normal JS update / rebuild, and it changes no styling):
//   1. KeyboardSafeView           - wrap the whole app ONCE (App.tsx). Every screen of the navigator shrinks by the keyboard height while the keyboard is open and returns when it closes.
//   2. KeyboardSafeModal          - drop-in for react-native's <Modal> (same props). A Modal is its own window, so the root wrapper cannot reach it; this one lifts its own content above the keyboard.
//   3. KeyboardAwareScrollView    - drop-in for react-native's <ScrollView> (same props, same ref). After the keyboard opens it scrolls the focused input into view inside that ScrollView.
//   4. useKeyboardHeight          - the shared hook behind all of them.
//
// NO DUPLICATE INSETS: KeyboardSafeView / KeyboardSafeModal measure themselves. If Android (or a device / OS version) has already shrunk the window for the keyboard, the padding is reduced by exactly that amount,
// so the keyboard height is never applied twice. iOS is untouched (those screens keep their existing KeyboardAvoidingView) - every helper here is a pass-through off Android.
import {
  forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState,
  type ReactNode,
} from 'react'
import {
  findNodeHandle, Keyboard, Modal, Platform, ScrollView, TextInput, View,
  type LayoutChangeEvent, type ModalProps, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollViewProps, type StyleProp, type ViewStyle,
} from 'react-native'

const IS_ANDROID = Platform.OS === 'android'

/** Height in dp of the soft keyboard while it is open, 0 when closed. Always 0 off Android. */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0)
  useEffect(() => {
    if (!IS_ANDROID) return
    // a Modal / screen that mounts while the keyboard is already open must not start at 0
    try { if (Keyboard.isVisible()) setHeight(Keyboard.metrics()?.height ?? 0) } catch { /* older RN: events below still work */ }
    const show = Keyboard.addListener('keyboardDidShow', (e) => setHeight(e?.endCoordinates?.height ?? 0))
    const hide = Keyboard.addListener('keyboardDidHide', () => setHeight(0))
    return () => { show.remove(); hide.remove() }
  }, [])
  return height
}

/**
 * Keeps its content above the soft keyboard. Layout-neutral while the keyboard is closed (two flex:1 Views, no padding).
 * `outer` is measured, `inner` carries the padding, so the padding never changes the measurement.
 */
export function KeyboardSafeView({ style, children }: { style?: StyleProp<ViewStyle>; children?: ReactNode }) {
  const keyboard = useKeyboardHeight()
  const keyboardRef = useRef(0)
  keyboardRef.current = keyboard
  const baseline = useRef(0)            // height of this view while the keyboard is closed (re-measured on every layout with the keyboard closed: rotation, split screen, ...)
  const [outerHeight, setOuterHeight] = useState(0)

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height
    setOuterHeight(h)
    if (keyboardRef.current === 0) baseline.current = h
  }, [])

  // how much the window has ALREADY been shrunk by the system for this keyboard (0 in edge-to-edge mode) - never pad for that part twice
  const alreadyResized = keyboard > 0 && baseline.current > 0 && outerHeight > 0 ? Math.max(0, baseline.current - outerHeight) : 0
  const padding = keyboard > 0 ? Math.max(0, keyboard - alreadyResized) : 0

  return (
    <View style={[{ flex: 1 }, style]} onLayout={onLayout}>
      <View style={{ flex: 1, paddingBottom: padding }}>{children}</View>
    </View>
  )
}

/** Drop-in replacement for react-native's <Modal>: same props, plus the content stays above the keyboard. */
export function KeyboardSafeModal({ children, ...props }: ModalProps) {
  return (
    <Modal {...props}>
      <KeyboardSafeView>{children}</KeyboardSafeView>
    </Modal>
  )
}

/**
 * Drop-in replacement for react-native's <ScrollView> (same props, same ref methods such as scrollTo / scrollToEnd).
 * When the keyboard opens, the focused TextInput that lives inside this ScrollView is scrolled into the visible part - and only if it is not already fully visible, so there is no needless jump.
 */
const KeyboardAwareScrollViewImpl = forwardRef<ScrollView, ScrollViewProps>(function KeyboardAwareScrollView(props, forwardedRef) {
  const { onScroll, onLayout, scrollEventThrottle, ...rest } = props
  const inner = useRef<ScrollView>(null)
  useImperativeHandle(forwardedRef, () => inner.current as ScrollView)
  const keyboard = useKeyboardHeight()
  const offsetY = useRef(0)
  const viewHeight = useRef(0)

  useEffect(() => {
    if (!IS_ANDROID || keyboard <= 0 || props.horizontal) return
    // wait for the padding added by KeyboardSafeView / KeyboardSafeModal to be laid out, then check the focused field
    const timer = setTimeout(() => {
      const sv = inner.current
      const focused: any = (TextInput as any).State?.currentlyFocusedInput?.()
      const handle = sv ? findNodeHandle(sv) : null
      if (!sv || !focused || handle == null || typeof focused.measureLayout !== 'function') return
      focused.measureLayout(
        handle,
        (_x: number, y: number, _w: number, h: number) => {
          const visibleTop = offsetY.current
          const visibleBottom = offsetY.current + viewHeight.current
          const margin = 24
          if (viewHeight.current <= 0) return
          if (y + h + margin > visibleBottom) sv.scrollTo({ y: Math.max(0, y + h + margin - viewHeight.current), animated: true })
          else if (y - margin < visibleTop) sv.scrollTo({ y: Math.max(0, y - margin), animated: true })
        },
        () => { /* the focused input is not inside this ScrollView - nothing to do */ },
      )
    }, 150)
    return () => clearTimeout(timer)
  }, [keyboard, props.horizontal])

  return (
    <ScrollView
      {...rest}
      ref={inner}
      scrollEventThrottle={scrollEventThrottle ?? 16}
      onScroll={(e: NativeSyntheticEvent<NativeScrollEvent>) => { offsetY.current = e.nativeEvent.contentOffset.y; onScroll?.(e) }}
      onLayout={(e: LayoutChangeEvent) => { viewHeight.current = e.nativeEvent.layout.height; onLayout?.(e) }}
    />
  )
})

// value + type under one name so a screen can keep writing  useRef<ScrollView>(null)  after `import { KeyboardAwareScrollView as ScrollView }`
export const KeyboardAwareScrollView = KeyboardAwareScrollViewImpl
export type KeyboardAwareScrollView = ScrollView
