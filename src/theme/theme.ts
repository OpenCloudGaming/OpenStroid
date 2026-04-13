import { createTheme, type MantineColorsTuple } from '@mantine/core';

const brand: MantineColorsTuple = [
  '#e6fcff',
  '#b3f5ff',
  '#80eeff',
  '#4de7ff',
  '#1ae0ff',
  '#00d4f5',
  '#00a8c4',
  '#007c93',
  '#005062',
  '#002431',
];

const accent: MantineColorsTuple = [
  '#f0e6ff',
  '#d1b3ff',
  '#b380ff',
  '#944dff',
  '#761aff',
  '#6600f5',
  '#5200c4',
  '#3d0093',
  '#290062',
  '#140031',
];

export const theme = createTheme({
  primaryColor: 'brand',
  colors: {
    brand,
    accent,
    dark: [
      '#C1C2C5',
      '#A6A7AB',
      '#909296',
      '#5C5F66',
      '#373A40',
      '#2C2E33',
      '#25262B',
      '#1A1B1E',
      '#141517',
      '#101113',
    ],
  },
  fontFamily:
    'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  headings: {
    fontFamily:
      'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontWeight: '700',
  },
  radius: {
    xs: '4px',
    sm: '6px',
    md: '8px',
    lg: '12px',
    xl: '16px',
  },
  defaultRadius: 'md',
  components: {
    Button: {
      defaultProps: {
        radius: 'md',
      },
    },
    TextInput: {
      defaultProps: {
        radius: 'md',
      },
    },
    PasswordInput: {
      defaultProps: {
        radius: 'md',
      },
    },
    Card: {
      defaultProps: {
        radius: 'lg',
      },
    },
  },
});
