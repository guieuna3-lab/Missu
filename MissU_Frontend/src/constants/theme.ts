import { StyleSheet } from 'react-native';

export const colors = {
  background: '#F5F6F8',
  white: '#FFFFFF',
  ink: '#171B23',
  body: '#59616D',
  muted: '#7B8492',
  blue: '#2563EB',
  lightBlue: '#EFF6FF',
  border: '#DDE1E7',
  line: '#F1F5F9',
  green: '#10B981',
  greenBg: '#F0FDF4',
  divider: '#CCD4DE',
  danger: '#DB2933',
  dangerBorder: '#E5393D',
  dangerBg: '#FFF8F8',
};

export const typography = StyleSheet.create({
  body: {
    fontFamily: 'NotoSansKR',
    fontSize: 13,
    lineHeight: 20,
    letterSpacing: -0.15,
    color: colors.body,
  },
  label: {
    fontFamily: 'NotoSansKR',
    fontSize: 13,
    lineHeight: 20,
    letterSpacing: -0.15,
    fontWeight: '500',
    color: colors.ink,
  },
  heading: {
    fontFamily: 'NotoSansKR',
    fontSize: 22,
    lineHeight: 32,
    letterSpacing: -0.15,
    fontWeight: '700',
    color: colors.ink,
  },
  action: {
    fontFamily: 'NotoSansKR',
    fontSize: 14,
    lineHeight: 22,
    letterSpacing: -0.15,
    fontWeight: '700',
    color: colors.white,
  },
});
