import { StyleSheet } from 'react-native';

// Current 03 screens override the older Nunito library with Noto Sans KR.
export const colors = {
  background: '#F5F6F8',
  white: '#FFFFFF',
  ink: '#171B23',
  body: '#59616D',
  muted: '#7B8492',
  blue: '#2563EB',
  border: '#DDE1E7',
  lightBlue: '#EFF6FF',
  photo: '#E8F0FE',
  error: '#B42318',
};
export const typography = StyleSheet.create({
  body: {
    fontFamily: 'NotoSansKR_400Regular',
    fontSize: 13,
    lineHeight: 20,
    letterSpacing: -0.15,
    color: colors.body,
  },
  label: {
    fontFamily: 'NotoSansKR_500Medium',
    fontSize: 13,
    lineHeight: 20,
    letterSpacing: -0.15,
    color: colors.ink,
  },
  action: {
    fontFamily: 'NotoSansKR_700Bold',
    fontSize: 14,
    lineHeight: 22,
    letterSpacing: -0.15,
    color: colors.ink,
  },
  heading: {
    fontFamily: 'NotoSansKR_700Bold',
    fontSize: 22,
    lineHeight: 32,
    letterSpacing: -0.15,
    color: colors.ink,
  },
});
